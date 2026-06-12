"""Walk-forward (rolling-origin) backtesting for daily forecasting models."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .metrics import all_metrics
from .models import EXOG_COLS


@dataclass
class FoldResult:
    fold: int
    train_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp
    metrics: dict[str, float]
    actual: np.ndarray
    predicted: np.ndarray


def make_folds(df: pd.DataFrame, horizon: int, n_folds: int, min_train_size: int):
    """Yield (train_df, test_df) pairs, walking forward from oldest to newest fold."""
    n = len(df)
    folds = []
    for fold in range(n_folds):
        test_end = n - fold * horizon
        test_start = test_end - horizon
        train_end = test_start
        if train_end < min_train_size or test_start < 0:
            break
        folds.append((train_end, test_start, test_end))
    folds.reverse()  # chronological order
    for fold_idx, (train_end, test_start, test_end) in enumerate(folds):
        yield fold_idx, df.iloc[:train_end].copy(), df.iloc[test_start:test_end].copy()


def run_backtest(
    df: pd.DataFrame,
    model_factory,
    horizon: int = 7,
    n_folds: int = 4,
    min_train_size: int = 60,
) -> list[FoldResult]:
    """Run a walk-forward backtest for one (series, model) pair.

    df must be sorted by Date and contain 'Contacts' + EXOG_COLS columns.
    model_factory is a zero-arg callable returning a fresh, unfitted model.
    """
    results: list[FoldResult] = []
    for fold_idx, train, test in make_folds(df, horizon, n_folds, min_train_size):
        model = model_factory()
        model.fit(train)
        future_exog = test[EXOG_COLS].reset_index(drop=True)
        preds = model.predict(len(test), future_exog)
        actual = test["Contacts"].to_numpy(dtype=float)
        results.append(
            FoldResult(
                fold=fold_idx,
                train_end=train["Date"].iloc[-1],
                test_start=test["Date"].iloc[0],
                test_end=test["Date"].iloc[-1],
                metrics=all_metrics(actual, preds),
                actual=actual,
                predicted=preds,
            )
        )
    return results


def summarize_folds(fold_results: list[FoldResult]) -> dict[str, float]:
    """Average metrics across folds."""
    if not fold_results:
        return {}
    keys = set()
    for fr in fold_results:
        keys.update(fr.metrics.keys())
    summary = {}
    for k in keys:
        vals = [fr.metrics[k] for fr in fold_results if k in fr.metrics]
        if vals:
            summary[k] = float(np.mean(vals))
    summary["n_folds"] = len(fold_results)
    return summary
