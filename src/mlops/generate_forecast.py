"""
Load each series' "champion" model from the MLflow Model Registry and
produce a daily forecast for the 3 months immediately following the last
observed date in master_dataset.csv.

The known orders/events workbook only covers a few weeks past the last
observed contact date, so exogenous features (EXOG_COLS) are extended for
the remainder of the horizon:
  - Dotcom_Orders_Forecast: repeats the same weekday's value from the most
    recently known week (weekly seasonal carry-forward).
  - Is_Holiday / Is_Promotion: inferred from whether the same month/day was
    a holiday/promotion in any prior year of history.

Run:
    python -m src.mlops.generate_forecast
"""

from __future__ import annotations

from pathlib import Path

import mlflow
import pandas as pd

from ..etl.build_master_dataset import add_calendar_features
from ..forecasting.models import EXOG_COLS

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MASTER_DATASET = PROJECT_ROOT / "data" / "processed" / "master_dataset.csv"
ORDERS_EVENTS = PROJECT_ROOT / "data" / "processed" / "daily_orders_events.csv"
OUTPUT_PATH = PROJECT_ROOT / "data" / "processed" / "forecast_3_months.csv"

HORIZON_MONTHS = 3


def extend_exog(orders_events: pd.DataFrame, start_date: pd.Timestamp, horizon: int) -> pd.DataFrame:
    """Build EXOG_COLS for `horizon` days starting at `start_date`.

    Dates covered by `orders_events` use its actual values. Beyond its last
    known date, Dotcom_Orders_Forecast repeats the same weekday from the
    most recent known week, and Is_Holiday/Is_Promotion are inferred from
    whether the same month/day occurred as a holiday/promotion in any prior
    year (catches fixed-date holidays like Canada Day, 4th of July, etc.).
    """
    full_range = pd.date_range(start_date, periods=horizon, freq="D")
    oe = orders_events.set_index("Date")
    last_known = oe.index.max()

    orders_lookup = oe["Dotcom_Orders_Forecast"]
    holiday_md = set(oe.index[oe["Is_Holiday"] == 1].strftime("%m-%d"))
    promo_md = set(oe.index[oe["Is_Promotion"] == 1].strftime("%m-%d"))

    rows = []
    for d in full_range:
        if d <= last_known:
            orders_fc = orders_lookup.loc[d]
            is_holiday = int(oe.loc[d, "Is_Holiday"])
            is_promo = int(oe.loc[d, "Is_Promotion"])
        else:
            weeks_back = -(-(d - last_known).days // 7)  # ceil division
            lookback = d - pd.Timedelta(days=7 * weeks_back)
            orders_fc = orders_lookup.loc[lookback]
            is_holiday = int(d.strftime("%m-%d") in holiday_md)
            is_promo = int(d.strftime("%m-%d") in promo_md)
        rows.append(
            {"Date": d, "Dotcom_Orders_Forecast": orders_fc, "Is_Holiday": is_holiday, "Is_Promotion": is_promo}
        )

    df = pd.DataFrame(rows)
    df = add_calendar_features(df)
    return df[["Date"] + EXOG_COLS]


def main() -> None:
    mlflow.set_tracking_uri(f"sqlite:///{PROJECT_ROOT / 'mlflow.db'}")

    master = pd.read_csv(MASTER_DATASET, parse_dates=["Date"])
    orders_events = pd.read_csv(ORDERS_EVENTS, parse_dates=["Date"])

    series_ids = sorted(master["Series_ID"].unique())

    all_forecasts = []
    for series_id in series_ids:
        sdf = master[master["Series_ID"] == series_id]
        last_date = sdf["Date"].max()
        horizon_end = last_date + pd.DateOffset(months=HORIZON_MONTHS)
        horizon = (horizon_end - last_date).days

        future_exog = extend_exog(orders_events, last_date + pd.Timedelta(days=1), horizon)

        registered_name = f"forecast_{series_id.replace(' ', '_')}"
        model = mlflow.pyfunc.load_model(f"models:/{registered_name}@champion")

        forecast = model.predict(future_exog)
        all_forecasts.append(forecast)
        print(
            f"\n{series_id} ({registered_name}@champion): {horizon} days "
            f"({future_exog['Date'].min().date()} -> {future_exog['Date'].max().date()})"
        )
        print(forecast.head(5).to_string(index=False))
        print(f"... ({len(forecast)} rows total)")

    result = pd.concat(all_forecasts, ignore_index=True)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(OUTPUT_PATH, index=False)
    print(f"\nWrote {len(result):,} rows to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
