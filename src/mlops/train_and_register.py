"""
Pick the best-performing model per series (from data/processed/benchmark_results.csv),
refit it on the FULL history, and register it in the MLflow Model Registry as
"forecast_<SERIES_ID>" (e.g. "forecast_VO_US_EN"), aliased "champion".

Run:
    python -m src.mlops.train_and_register
"""

from __future__ import annotations

import warnings
from pathlib import Path

import mlflow
import pandas as pd
from mlflow import MlflowClient

from ..forecasting.models import EXOG_COLS, get_model_factory
from ..forecasting.pyfunc_wrapper import ForecastModel

warnings.filterwarnings("ignore")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MASTER_DATASET = PROJECT_ROOT / "data" / "processed" / "master_dataset.csv"
RESULTS_PATH = PROJECT_ROOT / "data" / "processed" / "benchmark_results.csv"

HORIZON = 7


def main() -> None:
    mlflow.set_tracking_uri(f"sqlite:///{PROJECT_ROOT / 'mlflow.db'}")
    mlflow.set_experiment("contact_volume_forecasting")
    client = MlflowClient()

    df = pd.read_csv(MASTER_DATASET, parse_dates=["Date"])
    results = pd.read_csv(RESULTS_PATH)
    best = results.loc[results.groupby("series_id")["avg_smape"].idxmin()]
    model_factory = get_model_factory()

    for _, row in best.iterrows():
        series_id = row["series_id"]
        model_name = row["model"]
        sdf = df[df["Series_ID"] == series_id].sort_values("Date").reset_index(drop=True)

        forecaster = model_factory[model_name]()
        forecaster.fit(sdf)

        registered_name = f"forecast_{series_id.replace(' ', '_')}"
        input_example = sdf[["Date"] + EXOG_COLS].tail(HORIZON).reset_index(drop=True)

        with mlflow.start_run(run_name=f"{series_id} | {model_name} | champion"):
            mlflow.set_tags(
                {
                    "series_id": series_id,
                    "channel": row["channel"],
                    "country": row["country"],
                    "language": row["language"],
                    "model": model_name,
                    "stage": "champion_candidate",
                }
            )
            mlflow.log_params(
                {
                    "model_name": model_name,
                    "n_obs": len(sdf),
                    "horizon": HORIZON,
                    **{f"model_{k}": v for k, v in forecaster.params.items()},
                }
            )
            mlflow.log_metrics(
                {
                    "backtest_avg_mae": row["avg_mae"],
                    "backtest_avg_rmse": row["avg_rmse"],
                    "backtest_avg_smape": row["avg_smape"],
                    "backtest_avg_mape": row.get("avg_mape", float("nan")),
                }
            )

            model_info = mlflow.pyfunc.log_model(
                name="model",
                python_model=ForecastModel(forecaster, series_id),
                registered_model_name=registered_name,
                input_example=input_example,
            )

        version = model_info.registered_model_version
        client.set_registered_model_alias(registered_name, "champion", version)
        client.update_model_version(
            name=registered_name,
            version=version,
            description=(
                f"{model_name} forecaster for series '{series_id}' "
                f"(channel={row['channel']}, country={row['country']}, language={row['language']}). "
                f"Backtest avg sMAPE={row['avg_smape']:.2f}%, MAE={row['avg_mae']:.2f}."
            ),
        )

        print(
            f"Registered {registered_name} v{version} (alias='champion') "
            f"-> {model_name} (sMAPE={row['avg_smape']:.2f}%, MAE={row['avg_mae']:.2f})"
        )


if __name__ == "__main__":
    main()
