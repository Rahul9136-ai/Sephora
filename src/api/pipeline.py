"""
Background job runner for the full ETL -> benchmark -> register -> forecast
pipeline, so the API can kick it off and the frontend can poll its progress.
"""

from __future__ import annotations

import contextlib
import copy
import io
import threading
import traceback
from datetime import datetime, timezone

from ..etl import build_contacts_daily, build_master_dataset, build_orders_events
from ..forecasting import run_benchmark
from ..mlops import generate_forecast, train_and_register

STEPS: list[tuple[str, str, callable]] = [
    ("etl_contacts", "ETL: daily contacts (Email/Chat/Voice)", build_contacts_daily.main),
    ("etl_orders_events", "ETL: orders & events", build_orders_events.main),
    ("etl_master_dataset", "ETL: master dataset", build_master_dataset.main),
    ("benchmark", "Benchmark all models (walk-forward backtest)", run_benchmark.main),
    ("register", "Register champion models", train_and_register.main),
    ("forecast", "Generate 3-month forecast", generate_forecast.main),
]

_lock = threading.Lock()
_state: dict = {
    "status": "idle",  # idle | running | success | error
    "current_step": None,
    "steps": [{"id": sid, "label": label, "status": "pending"} for sid, label, _ in STEPS],
    "log": [],
    "started_at": None,
    "finished_at": None,
    "error": None,
}


def get_state() -> dict:
    with _lock:
        return copy.deepcopy(_state)


def _run() -> None:
    with _lock:
        _state["status"] = "running"
        _state["started_at"] = datetime.now(timezone.utc).isoformat()
        _state["finished_at"] = None
        _state["error"] = None
        _state["log"] = []
        for step in _state["steps"]:
            step["status"] = "pending"

    for sid, label, func in STEPS:
        with _lock:
            _state["current_step"] = sid
            for step in _state["steps"]:
                if step["id"] == sid:
                    step["status"] = "running"

        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                func()
            with _lock:
                _state["log"].append({"step": sid, "label": label, "output": buf.getvalue()})
                for step in _state["steps"]:
                    if step["id"] == sid:
                        step["status"] = "success"
        except Exception as exc:
            with _lock:
                _state["log"].append({"step": sid, "label": label, "output": buf.getvalue()})
                _state["error"] = f"{label} failed: {exc}\n{traceback.format_exc()}"
                for step in _state["steps"]:
                    if step["id"] == sid:
                        step["status"] = "error"
                _state["status"] = "error"
                _state["current_step"] = None
                _state["finished_at"] = datetime.now(timezone.utc).isoformat()
            return

    with _lock:
        _state["status"] = "success"
        _state["current_step"] = None
        _state["finished_at"] = datetime.now(timezone.utc).isoformat()


def start_retrain() -> bool:
    """Kick off the pipeline in a background thread. Returns False if already running."""
    with _lock:
        if _state["status"] == "running":
            return False
    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    return True
