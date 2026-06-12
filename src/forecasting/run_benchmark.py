"""
Benchmark multiple forecasting methods (Naive, Seasonal Naive, Moving Average,
Holt-Winters, SARIMAX, LightGBM) against every contact-volume series in
data/processed/master_dataset.csv using walk-forward backtesting, and log
every (series, model) experiment to MLflow.

Run:
    python -m src.forecasting.run_benchmark
"""

from __future__ import annotations

import time
import warnings
from pathlib import Path

import mlflow
import pandas as pd

from .backtest import run_backtest, summarize_folds
from .models import get_model_factory

warnings.filterwarnings("ignore")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MASTER_DATASET = PROJECT_ROOT / "data" / "processed" / "master_dataset.csv"
RESULTS_PATH = PROJECT_ROOT / "data" / "processed" / "benchmark_results.csv"

HORIZON = 7
N_FOLDS = 4
MIN_TRAIN_SIZE = 60


def main() -> None:
    mlflow.set_tracking_uri(f"sqlite:///{PROJECT_ROOT / 'mlflow.db'}")
    mlflow.set_experiment("contact_volume_forecasting")

    df = pd.read_csv(MASTER_DATASET, parse_dates=["Date"])
    series_ids = sorted(df["Series_ID"].unique())
    model_factory = get_model_factory()

    print(f"Series to benchmark: {series_ids}")
    print(f"Models: {list(model_factory)}")
    print(f"Config: horizon={HORIZON}, n_folds={N_FOLDS}, min_train_size={MIN_TRAIN_SIZE}\n")

    leaderboard = []
    for series_id in series_ids:
        sdf = df[df["Series_ID"] == series_id].sort_values("Date").reset_index(drop=True)
        meta = sdf.iloc[0]

        for model_name, factory in model_factory.items():
            t0 = time.time()
            run_name = f"{series_id} | {model_name}"
            with mlflow.start_run(run_name=run_name):
                mlflow.set_tags(
                    {
                        "series_id": series_id,
                        "channel": meta["Channel"],
                        "country": meta["Country"],
                        "language": meta["Language"],
                        "model": model_name,
                        "stage": "benchmark",
                    }
                )
                mlflow.log_params(
                    {
                        "horizon": HORIZON,
                        "n_folds": N_FOLDS,
                        "min_train_size": MIN_TRAIN_SIZE,
                        "n_obs": len(sdf),
                    }
                )
                model_params = factory().params
                mlflow.log_params({f"model_{k}": v for k, v in model_params.items()})

                fold_results = run_backtest(
                    sdf, factory, horizon=HORIZON, n_folds=N_FOLDS, min_train_size=MIN_TRAIN_SIZE
                )
                for fr in fold_results:
                    for k, v in fr.metrics.items():
                        mlflow.log_metric(f"fold_{k}", v, step=fr.fold)

                summary = summarize_folds(fold_results)
                for k, v in summary.items():
                    if k != "n_folds":
                        mlflow.log_metric(f"avg_{k}", v)
                mlflow.log_metric("n_folds", summary.get("n_folds", 0))

                elapsed = time.time() - t0
                mlflow.log_metric("fit_seconds", elapsed)

                row = {
                    "series_id": series_id,
                    "channel": meta["Channel"],
                    "country": meta["Country"],
                    "language": meta["Language"],
                    "model": model_name,
                    "n_obs": len(sdf),
                    **{f"avg_{k}": v for k, v in summary.items() if k != "n_folds"},
                    "n_folds": summary.get("n_folds", 0),
                    "fit_seconds": elapsed,
                    "run_id": mlflow.active_run().info.run_id,
                }
                leaderboard.append(row)
                print(
                    f"  {series_id:12s} {model_name:15s} "
                    f"smape={row.get('avg_smape', float('nan')):7.2f}  "
                    f"mae={row.get('avg_mae', float('nan')):8.2f}  "
                    f"({elapsed:.1f}s)"
                )

    lb_df = pd.DataFrame(leaderboard)
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    lb_df.to_csv(RESULTS_PATH, index=False)
    print(f"\nWrote leaderboard to {RESULTS_PATH}")

    print("\n=== Best model per series (by avg sMAPE) ===")
    best = lb_df.loc[lb_df.groupby("series_id")["avg_smape"].idxmin()].sort_values("series_id")
    cols = ["series_id", "model", "avg_mae", "avg_rmse", "avg_smape", "avg_mape"]
    print(best[cols].to_string(index=False))

    print("\n=== Overall model ranking (mean sMAPE across series) ===")
    overall = lb_df.groupby("model")["avg_smape"].mean().sort_values()
    print(overall.to_string())


if __name__ == "__main__":
    main()
