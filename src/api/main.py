"""
FastAPI backend for the Contact Volume Forecasting MLOps pipeline.

Exposes:
  - File upload endpoints that replace the raw source workbooks
  - A retrain endpoint that runs the full ETL -> benchmark -> register ->
    forecast pipeline in the background, with status polling
  - Read-only endpoints for series metadata/history, benchmark leaderboard,
    forecasts and the MLflow model registry

Run:
    uvicorn src.api.main:app --reload --port 8000
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import mlflow
import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from mlflow import MlflowClient

from . import pipeline
from .uploads import CONTACTS_PATH, ORDERS_EVENTS_PATH, save_upload

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
MLFLOW_URI = f"sqlite:///{PROJECT_ROOT / 'mlflow.db'}"

app = FastAPI(title="Contact Volume Forecasting API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _read_csv(name: str) -> pd.DataFrame:
    path = PROCESSED_DIR / name
    if not path.exists():
        raise HTTPException(404, f"{name} not found - run a retrain first")
    return pd.read_csv(path)


def _file_info(path: Path) -> dict:
    if not path.exists():
        return {"exists": False}
    stat = path.stat()
    return {
        "exists": True,
        "size_bytes": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
    }


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/files/status")
def files_status() -> dict:
    return {
        "raw": {
            "contacts_export.xlsx": _file_info(CONTACTS_PATH),
            "orders_events.xlsx": _file_info(ORDERS_EVENTS_PATH),
        },
        "processed": {
            name: _file_info(PROCESSED_DIR / name)
            for name in [
                "daily_contacts.csv",
                "daily_orders_events.csv",
                "master_dataset.csv",
                "benchmark_results.csv",
                "forecast_3_months.csv",
            ]
        },
    }


@app.post("/api/upload/contacts")
async def upload_contacts(file: UploadFile = File(...)) -> dict:
    if not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Expected an .xlsx file")
    info = save_upload(file, CONTACTS_PATH)
    return {"message": "Contacts export uploaded - click Retrain to rebuild the models", **info}


@app.post("/api/upload/orders")
async def upload_orders(file: UploadFile = File(...)) -> dict:
    if not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Expected an .xlsx file")
    info = save_upload(file, ORDERS_EVENTS_PATH)
    return {"message": "Orders & events workbook uploaded - click Retrain to rebuild the models", **info}


@app.post("/api/retrain")
def retrain() -> dict:
    started = pipeline.start_retrain()
    if not started:
        raise HTTPException(409, "A retrain job is already running")
    return {"message": "Retrain started", **pipeline.get_state()}


@app.get("/api/retrain/status")
def retrain_status() -> dict:
    return pipeline.get_state()


@app.get("/api/series")
def list_series() -> list[dict]:
    df = _read_csv("master_dataset.csv")
    df["Date"] = pd.to_datetime(df["Date"])
    summary = (
        df.groupby(["Series_ID", "Channel", "Country", "Language"])
        .agg(
            start_date=("Date", "min"),
            end_date=("Date", "max"),
            n_days=("Date", "count"),
            total_contacts=("Contacts", "sum"),
            avg_daily_contacts=("Contacts", "mean"),
        )
        .reset_index()
    )
    summary["start_date"] = summary["start_date"].dt.strftime("%Y-%m-%d")
    summary["end_date"] = summary["end_date"].dt.strftime("%Y-%m-%d")
    summary["avg_daily_contacts"] = summary["avg_daily_contacts"].round(1)
    return summary.sort_values("Series_ID").to_dict(orient="records")


@app.get("/api/series/history")
def series_history(series_id: str = Query(...), days: int = Query(120, ge=1, le=2000)) -> list[dict]:
    df = _read_csv("master_dataset.csv")
    df["Date"] = pd.to_datetime(df["Date"])
    sdf = df[df["Series_ID"] == series_id]
    if sdf.empty:
        raise HTTPException(404, f"Series '{series_id}' not found")
    sdf = sdf.sort_values("Date").tail(days)
    out = sdf[["Date", "Contacts", "Is_Holiday", "Is_Promotion"]].copy()
    out["Date"] = out["Date"].dt.strftime("%Y-%m-%d")
    return out.to_dict(orient="records")


@app.get("/api/benchmark")
def benchmark() -> list[dict]:
    df = _read_csv("benchmark_results.csv")
    return df.to_dict(orient="records")


@app.get("/api/forecast")
def forecast() -> list[dict]:
    df = _read_csv("forecast_3_months.csv")
    return df.to_dict(orient="records")


@app.get("/api/registry")
def registry() -> list[dict]:
    mlflow.set_tracking_uri(MLFLOW_URI)
    client = MlflowClient()

    models = []
    for rm in client.search_registered_models():
        if not rm.name.startswith("forecast_"):
            continue
        entry: dict = {
            "name": rm.name,
            "series_id": rm.name.removeprefix("forecast_").replace("_", " "),
        }
        try:
            mv = client.get_model_version_by_alias(rm.name, "champion")
            entry["version"] = mv.version
            entry["description"] = mv.description
            entry["last_updated"] = datetime.fromtimestamp(mv.last_updated_timestamp / 1000).isoformat()

            run = client.get_run(mv.run_id)
            entry["model_type"] = run.data.tags.get("model")
            entry["metrics"] = {
                "smape": run.data.metrics.get("backtest_avg_smape"),
                "mae": run.data.metrics.get("backtest_avg_mae"),
                "rmse": run.data.metrics.get("backtest_avg_rmse"),
            }
        except Exception as exc:  # no champion alias set yet, etc.
            entry["error"] = str(exc)
        models.append(entry)

    return sorted(models, key=lambda m: m["series_id"])


FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="frontend-assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str) -> FileResponse:
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
