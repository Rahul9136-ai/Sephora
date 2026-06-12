"""Generic MLflow pyfunc wrapper around any BaseForecaster."""

from __future__ import annotations

import pandas as pd

import mlflow.pyfunc


class ForecastModel(mlflow.pyfunc.PythonModel):
    """Wraps a fitted forecaster behind the standard pyfunc predict interface.

    model_input must be a DataFrame with one row per day to be forecast and
    columns matching src.forecasting.models.EXOG_COLS (Dotcom_Orders_Forecast,
    Is_Holiday, Is_Promotion, DayOfWeek, Month, IsWeekend, WeekOfYear,
    DayOfMonth) - i.e. the future calendar/order-volume context for the
    forecast horizon. Returns a DataFrame with Date (if provided), Series_ID
    and forecast columns.
    """

    def __init__(self, forecaster, series_id: str):
        self.forecaster = forecaster
        self.series_id = series_id

    def predict(self, context, model_input: pd.DataFrame, params=None) -> pd.DataFrame:
        model_input = model_input.reset_index(drop=True)
        horizon = len(model_input)
        preds = self.forecaster.predict(horizon, model_input)
        out = pd.DataFrame({"Series_ID": self.series_id, "forecast": preds})
        if "Date" in model_input.columns:
            out.insert(0, "Date", model_input["Date"].values)
        return out
