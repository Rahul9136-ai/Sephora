"""
ETL: build a clean daily dataset of order volumes (actuals + forecast)
and calendar events/promotions from
"data/Daily Orders_Actuals + Forecast.xlsx".

Output
------
data/processed/daily_orders_events.csv with columns:
    Date,
    US_Orders, CA_Orders, Dotcom_Orders,           (actuals; NaN if not yet reported)
    SDD_Orders, BOPIS_Orders,
    US_Orders_Forecast, CA_Orders_Forecast, Dotcom_Orders_Forecast,
    Is_Holiday, Is_Promotion, Num_Events,
    Holiday_Name, Promotion_Name, Event_Names
"""

from __future__ import annotations

from pathlib import Path

import openpyxl
import pandas as pd

SOURCE_PATH = Path(__file__).resolve().parents[2] / "data" / "raw" / "orders_events.xlsx"
OUTPUT_PATH = Path(__file__).resolve().parents[2] / "data" / "processed" / "daily_orders_events.csv"


def _read_sheet(path: Path, sheet: str) -> list[tuple]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    return rows


def load_order_actuals(path: Path) -> pd.DataFrame:
    rows = _read_sheet(path, "Order Actuals")
    data = [r[:6] for r in rows[1:] if r[0] is not None]
    df = pd.DataFrame(
        data,
        columns=["Date", "Dotcom_Orders", "US_Orders", "CA_Orders", "SDD_Orders", "BOPIS_Orders"],
    )
    df = df[["Date", "US_Orders", "CA_Orders", "Dotcom_Orders", "SDD_Orders", "BOPIS_Orders"]]
    df["Date"] = pd.to_datetime(df["Date"]).dt.normalize()
    return df


def load_order_forecasts(path: Path) -> pd.DataFrame:
    rows = _read_sheet(path, "Order Forecasts")
    data = [r[:4] for r in rows[1:] if r[0] is not None]
    df = pd.DataFrame(data, columns=["Date", "Dotcom_Orders_Forecast", "US_Orders_Forecast", "CA_Orders_Forecast"])
    df["Date"] = pd.to_datetime(df["Date"]).dt.normalize()
    return df


def load_events(path: Path) -> pd.DataFrame:
    rows = _read_sheet(path, "Events ")
    header = rows[0]
    data = [r for r in rows[1:] if r[1] is not None]
    df = pd.DataFrame(data, columns=header)
    df = df[["Date", "Event", "Event Category"]].rename(columns={"Event Category": "Event_Category"})
    df["Date"] = pd.to_datetime(df["Date"]).dt.normalize()

    def agg_group(g: pd.DataFrame) -> pd.Series:
        holidays = g.loc[g["Event_Category"] == "Holiday", "Event"]
        promos = g.loc[g["Event_Category"] == "Promotion", "Event"]
        return pd.Series(
            {
                "Is_Holiday": int(len(holidays) > 0),
                "Is_Promotion": int(len(promos) > 0),
                "Num_Events": len(g),
                "Holiday_Name": "; ".join(holidays.dropna().astype(str)) or None,
                "Promotion_Name": "; ".join(promos.dropna().astype(str)) or None,
                "Event_Names": "; ".join(g["Event"].dropna().astype(str)) or None,
            }
        )

    daily = df.groupby("Date").apply(agg_group, include_groups=False).reset_index()
    return daily


def build_daily_orders_events(source_path: Path = SOURCE_PATH) -> pd.DataFrame:
    print(f"Reading {source_path} ...")
    actuals = load_order_actuals(source_path)
    forecast = load_order_forecasts(source_path)
    events = load_events(source_path)

    print(f"  Actuals:  {len(actuals):,} rows ({actuals['Date'].min().date()} -> {actuals['Date'].max().date()})")
    print(f"  Forecast: {len(forecast):,} rows ({forecast['Date'].min().date()} -> {forecast['Date'].max().date()})")
    print(f"  Events:   {len(events):,} days with events")

    full_range = pd.date_range(
        start=min(actuals["Date"].min(), forecast["Date"].min()),
        end=max(actuals["Date"].max(), forecast["Date"].max()),
        freq="D",
    )
    df = pd.DataFrame({"Date": full_range})
    df = df.merge(actuals, on="Date", how="left")
    df = df.merge(forecast, on="Date", how="left")
    df = df.merge(events, on="Date", how="left")

    for col in ["Is_Holiday", "Is_Promotion", "Num_Events"]:
        df[col] = df[col].fillna(0).astype(int)

    return df


def main() -> None:
    df = build_daily_orders_events()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)
    print(f"\nWrote {len(df):,} rows to {OUTPUT_PATH}")
    print(df.tail(10).to_string(index=False))


if __name__ == "__main__":
    main()
