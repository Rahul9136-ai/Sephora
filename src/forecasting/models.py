"""
Forecasting model wrappers exposing a common fit/predict interface so they
can be benchmarked interchangeably in src/forecasting/backtest.py.

All models forecast the daily 'Contacts' volume for a single Series_ID.
Exogenous features (order-volume signal, calendar, holiday/promo flags) are
known for both history and the forecast horizon, so they can be used freely
by any model that supports them.
"""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

EXOG_COLS = [
    "Dotcom_Orders_Forecast",
    "Is_Holiday",
    "Is_Promotion",
    "DayOfWeek",
    "Month",
    "IsWeekend",
    "WeekOfYear",
    "DayOfMonth",
]

LAG_FEATURES = [1, 7, 14]
ROLLING_WINDOWS = [7, 14]


class BaseForecaster:
    name: str = "Base"
    params: dict = {}

    def fit(self, history: pd.DataFrame) -> "BaseForecaster":
        raise NotImplementedError

    def predict(self, horizon: int, future_exog: pd.DataFrame) -> np.ndarray:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Naive baselines
# ---------------------------------------------------------------------------

class NaiveForecaster(BaseForecaster):
    name = "Naive"
    params = {}

    def fit(self, history: pd.DataFrame) -> "NaiveForecaster":
        self.last_value = history["Contacts"].iloc[-1]
        return self

    def predict(self, horizon: int, future_exog: pd.DataFrame) -> np.ndarray:
        return np.full(horizon, self.last_value, dtype=float)


class SeasonalNaiveForecaster(BaseForecaster):
    name = "SeasonalNaive7"

    def __init__(self, period: int = 7):
        self.period = period
        self.params = {"period": period}

    def fit(self, history: pd.DataFrame) -> "SeasonalNaiveForecaster":
        self.last_season = history["Contacts"].iloc[-self.period:].to_numpy()
        return self

    def predict(self, horizon: int, future_exog: pd.DataFrame) -> np.ndarray:
        return np.array([self.last_season[h % self.period] for h in range(horizon)], dtype=float)


class MovingAverageForecaster(BaseForecaster):
    name = "MovingAverage7"

    def __init__(self, window: int = 7):
        self.window = window
        self.params = {"window": window}

    def fit(self, history: pd.DataFrame) -> "MovingAverageForecaster":
        self.value = history["Contacts"].iloc[-self.window:].mean()
        return self

    def predict(self, horizon: int, future_exog: pd.DataFrame) -> np.ndarray:
        return np.full(horizon, self.value, dtype=float)


# ---------------------------------------------------------------------------
# Statistical models
# ---------------------------------------------------------------------------

class HoltWintersForecaster(BaseForecaster):
    name = "HoltWinters"

    def __init__(self, seasonal_periods: int = 7):
        self.seasonal_periods = seasonal_periods
        self.params = {"trend": "add", "seasonal": "add", "seasonal_periods": seasonal_periods}

    def fit(self, history: pd.DataFrame) -> "HoltWintersForecaster":
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        y = history["Contacts"].astype(float)
        self._fallback = None
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                self.model = ExponentialSmoothing(
                    y,
                    trend="add",
                    seasonal="add",
                    seasonal_periods=self.seasonal_periods,
                    initialization_method="estimated",
                ).fit()
        except Exception:
            self._fallback = SeasonalNaiveForecaster(self.seasonal_periods).fit(history)
        return self

    def predict(self, horizon: int, future_exog: pd.DataFrame) -> np.ndarray:
        if self._fallback is not None:
            return self._fallback.predict(horizon, future_exog)
        return np.asarray(self.model.forecast(horizon))


class SARIMAXForecaster(BaseForecaster):
    name = "SARIMAX"

    def __init__(self, order=(1, 1, 1), seasonal_order=(1, 1, 1, 7), use_exog: bool = True):
        self.order = order
        self.seasonal_order = seasonal_order
        self.use_exog = use_exog
        self.params = {"order": order, "seasonal_order": seasonal_order, "use_exog": use_exog}
        self._exog_cols = ["Dotcom_Orders_Forecast", "Is_Holiday", "Is_Promotion"]

    def fit(self, history: pd.DataFrame) -> "SARIMAXForecaster":
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        y = history["Contacts"].astype(float)
        exog = history[self._exog_cols].astype(float) if self.use_exog else None
        self._fallback = None
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                self.model = SARIMAX(
                    y,
                    exog=exog,
                    order=self.order,
                    seasonal_order=self.seasonal_order,
                    enforce_stationarity=False,
                    enforce_invertibility=False,
                ).fit(disp=False, maxiter=50)
        except Exception:
            self._fallback = SeasonalNaiveForecaster(self.seasonal_order[-1]).fit(history)
        return self

    def predict(self, horizon: int, future_exog: pd.DataFrame) -> np.ndarray:
        if self._fallback is not None:
            return self._fallback.predict(horizon, future_exog)
        exog = future_exog[self._exog_cols].astype(float) if self.use_exog else None
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fc = self.model.get_forecast(steps=horizon, exog=exog).predicted_mean
        return np.asarray(fc)


# ---------------------------------------------------------------------------
# Machine-learning model with lag/rolling/calendar/exogenous features
# ---------------------------------------------------------------------------

class LightGBMForecaster(BaseForecaster):
    name = "LightGBM"

    def __init__(self, **lgbm_params):
        self.lgbm_params = {
            "n_estimators": 200,
            "max_depth": 4,
            "learning_rate": 0.05,
            "num_leaves": 15,
            "min_child_samples": 5,
            "verbosity": -1,
            "random_state": 42,
            **lgbm_params,
        }
        self.params = self.lgbm_params

    @staticmethod
    def _make_features(series: pd.Series, exog: pd.DataFrame) -> pd.DataFrame:
        df = exog.copy()
        for lag in LAG_FEATURES:
            df[f"lag_{lag}"] = series.shift(lag)
        for win in ROLLING_WINDOWS:
            df[f"rollmean_{win}"] = series.shift(1).rolling(win).mean()
        return df

    def fit(self, history: pd.DataFrame) -> "LightGBMForecaster":
        from lightgbm import LGBMRegressor

        y = history["Contacts"].astype(float).reset_index(drop=True)
        exog = history[EXOG_COLS].reset_index(drop=True)
        feats = self._make_features(y, exog)
        feats["y"] = y
        feats = feats.dropna().reset_index(drop=True)

        self.model = LGBMRegressor(**self.lgbm_params)
        self.model.fit(feats.drop(columns="y"), feats["y"])
        self.feature_cols = [c for c in feats.columns if c != "y"]

        # keep the trailing window of actuals to seed recursive lag features
        max_window = max(LAG_FEATURES + ROLLING_WINDOWS)
        self._history_values = list(y.iloc[-max_window:])
        return self

    def predict(self, horizon: int, future_exog: pd.DataFrame) -> np.ndarray:
        history = list(self._history_values)
        preds = []
        future_exog = future_exog.reset_index(drop=True)
        for h in range(horizon):
            row = {col: future_exog.loc[h, col] for col in EXOG_COLS}
            for lag in LAG_FEATURES:
                row[f"lag_{lag}"] = history[-lag]
            for win in ROLLING_WINDOWS:
                row[f"rollmean_{win}"] = np.mean(history[-win:])
            x = pd.DataFrame([row])[self.feature_cols]
            yhat = float(self.model.predict(x)[0])
            yhat = max(yhat, 0.0)
            preds.append(yhat)
            history.append(yhat)
        return np.array(preds, dtype=float)


def get_model_factory() -> dict[str, callable]:
    """Return {model_name: zero-arg constructor} for every model in the benchmark."""
    return {
        "Naive": NaiveForecaster,
        "SeasonalNaive7": SeasonalNaiveForecaster,
        "MovingAverage7": MovingAverageForecaster,
        "HoltWinters": HoltWintersForecaster,
        "SARIMAX": SARIMAXForecaster,
        "LightGBM": LightGBMForecaster,
    }
