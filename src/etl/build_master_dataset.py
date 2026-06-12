"""
ETL: merge the daily contact-volume series (data/processed/daily_contacts.csv)
with order volumes / events (data/processed/daily_orders_events.csv) and add
calendar features, producing one tidy "long" table ready for forecasting.

Each Series_ID (e.g. "VO US EN", "CH US EN", "EM CA FR") is reindexed to a
continuous daily date range (missing days -> 0 contacts) so every model sees
a regular time series.

Output
------
data/processed/master_dataset.csv with columns:
    Date, Series_ID, Channel, Country, Language, Contacts,
    US_Orders, CA_Orders, Dotcom_Orders, SDD_Orders, BOPIS_Orders,
    US_Orders_Forecast, CA_Orders_Forecast, Dotcom_Orders_Forecast,
    Is_Holiday, Is_Promotion, Num_Events,
    DayOfWeek, Month, WeekOfYear, DayOfMonth, IsWeekend
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "processed"
CONTACTS_PATH = DATA_DIR / "daily_contacts.csv"
ORDERS_EVENTS_PATH = DATA_DIR / "daily_orders_events.csv"
OUTPUT_PATH = DATA_DIR / "master_dataset.csv"


def reindex_series(group: pd.DataFrame) -> pd.DataFrame:
    full_range = pd.date_range(group["Date"].min(), group["Date"].max(), freq="D")
    out = group.set_index("Date").reindex(full_range)
    out.index.name = "Date"
    out["Contacts"] = out["Contacts"].fillna(0)
    for col in ["Series_ID", "Channel", "Country", "Language"]:
        out[col] = out[col].ffill().bfill()
    return out.reset_index()


def add_calendar_features(df: pd.DataFrame) -> pd.DataFrame:
    df["DayOfWeek"] = df["Date"].dt.dayofweek  # Monday=0
    df["Month"] = df["Date"].dt.month
    df["WeekOfYear"] = df["Date"].dt.isocalendar().week.astype(int)
    df["DayOfMonth"] = df["Date"].dt.day
    df["IsWeekend"] = (df["DayOfWeek"] >= 5).astype(int)
    return df


def build_master_dataset() -> pd.DataFrame:
    contacts = pd.read_csv(CONTACTS_PATH, parse_dates=["Date"])
    orders_events = pd.read_csv(ORDERS_EVENTS_PATH, parse_dates=["Date"])

    contacts = pd.concat(
        [reindex_series(group) for _, group in contacts.groupby("Series_ID")],
        ignore_index=True,
    )

    df = contacts.merge(orders_events, on="Date", how="left")
    df = add_calendar_features(df)

    df = df.sort_values(["Series_ID", "Date"]).reset_index(drop=True)
    return df


def main() -> None:
    df = build_master_dataset()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)
    print(f"Wrote {len(df):,} rows to {OUTPUT_PATH}")

    print("\nSeries lengths after reindexing:")
    print(df.groupby("Series_ID")["Date"].agg(["min", "max", "count"]))

    print("\nNull counts (exogenous features):")
    print(df.isna().sum()[df.isna().sum() > 0])


if __name__ == "__main__":
    main()
