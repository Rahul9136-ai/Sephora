"""Forecast accuracy metrics."""

from __future__ import annotations

import numpy as np


def mae(actual: np.ndarray, pred: np.ndarray) -> float:
    return float(np.mean(np.abs(actual - pred)))


def rmse(actual: np.ndarray, pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((actual - pred) ** 2)))


def smape(actual: np.ndarray, pred: np.ndarray, eps: float = 1e-9) -> float:
    """Symmetric MAPE (%) - well-behaved for series containing zeros."""
    denom = np.abs(actual) + np.abs(pred) + eps
    return float(np.mean(2.0 * np.abs(actual - pred) / denom) * 100.0)


def mape(actual: np.ndarray, pred: np.ndarray) -> float | None:
    """Classic MAPE (%) computed only over non-zero actuals; None if all zero."""
    mask = actual != 0
    if not mask.any():
        return None
    return float(np.mean(np.abs((actual[mask] - pred[mask]) / actual[mask])) * 100.0)


def all_metrics(actual: np.ndarray, pred: np.ndarray) -> dict[str, float]:
    pred = np.clip(pred, a_min=0, a_max=None)  # contact volumes can't be negative
    out = {
        "mae": mae(actual, pred),
        "rmse": rmse(actual, pred),
        "smape": smape(actual, pred),
    }
    m = mape(actual, pred)
    if m is not None:
        out["mape"] = m
    return out
