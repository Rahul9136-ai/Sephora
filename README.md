# Saphtino — Contact Volume Forecasting MLOps Pipeline

End-to-end pipeline that turns raw Gladly contact-center exports + Sephora
order/events data into daily forecasts per **Channel / Country / Language**,
benchmarks several forecasting methods, and tracks every experiment in
MLflow with the best model per series promoted to the Model Registry.

## Series naming convention

Every time series is identified by a `Series_ID` of the form:

```
<CHANNEL> <COUNTRY> <LANGUAGE>
```

| Channel | Code |
|---------|------|
| Email   | `EM` |
| Voice   | `VO` |
| Chat    | `CH` |

Examples: `CH US EN` (Chat, US, English), `VO CA FR` (Voice, Canada, French),
`EM CA EN` (Email, Canada, English).

Active series (after the Aug-2025 → Oct-2025 routing change that started
splitting Chat by country):

```
CH CA EN, CH CA FR, CH US EN, EM CA EN, EM CA FR, EM US EN,
VO CA EN, VO CA FR, VO US EN, VO US SP
```

Un-routed chat rows from before the Oct-2025 routing change (raw "Country" =
`ALL`, which would map to a discontinued `CH ALL ALL` bucket) are dropped
during ETL (`build_contacts_daily.py`) and never appear in the dataset.

## Project layout

```
data/
  raw/
    contacts_export.xlsx       raw Gladly Email_Chat + Voice export (upload target)
    orders_events.xlsx         raw orders actuals/forecast + events workbook (upload target)
    backups/                    timestamped backups created on each re-upload
  processed/
    daily_contacts.csv        daily Contacts by Series_ID (from contacts_export.xlsx)
    daily_orders_events.csv   daily order volumes (US/CA, actual+forecast) + holidays/promos
    master_dataset.csv        merged, reindexed, calendar features added
    benchmark_results.csv     full model x series leaderboard
    forecast_3_months.csv     latest champion-model 3-month daily forecasts
src/
  etl/
    build_contacts_daily.py    contacts_export.xlsx (Email_Chat + Voice exports) -> daily_contacts.csv
    build_orders_events.py     orders_events.xlsx -> daily_orders_events.csv
    build_master_dataset.py    merges the two + calendar features -> master_dataset.csv
  forecasting/
    metrics.py        MAE / RMSE / sMAPE / MAPE
    models.py         Naive, SeasonalNaive7, MovingAverage7, HoltWinters, SARIMAX, LightGBM
    backtest.py        walk-forward (rolling-origin) backtest harness
    pyfunc_wrapper.py  generic MLflow pyfunc wrapper around any forecaster
    run_benchmark.py   benchmarks every model x series, logs to MLflow
  mlops/
    train_and_register.py  refits the per-series champion on full history
                            and registers it in the MLflow Model Registry
    generate_forecast.py   loads each champion and forecasts the next 3 months (daily)
  api/
    main.py     FastAPI app - upload, retrain, series/benchmark/forecast/registry endpoints
    pipeline.py  background job runner for the full retrain pipeline
    uploads.py   saves uploaded workbooks to data/raw/ (with backups)
frontend/        React + Vite + TypeScript + Tailwind UI (Dashboard, Data & Retrain pages)
mlflow.db / mlruns/   MLflow tracking store (SQLite) + artifact store
```

## Pipeline

```bash
# 1. ETL (re-run whenever contacts_export.xlsx or orders_events.xlsx is refreshed)
python -m src.etl.build_contacts_daily
python -m src.etl.build_orders_events
python -m src.etl.build_master_dataset

# 2. Benchmark every model against every series (walk-forward backtest)
python -m src.forecasting.run_benchmark

# 3. Promote the best model per series to the MLflow Model Registry
python -m src.mlops.train_and_register

# 4. Generate a 3-month daily forecast from the registered champion models
python -m src.mlops.generate_forecast

# Inspect experiments / registered models
mlflow ui --backend-store-uri sqlite:///mlflow.db
```

## Web UI

A FastAPI backend wraps the pipeline above, and a React (Vite + TypeScript +
Tailwind) frontend provides a Dashboard and a "Data & Retrain" page for
uploading refreshed source workbooks and re-running the pipeline.

```bash
# Terminal 1 - API (http://127.0.0.1:8000)
uvicorn src.api.main:app --reload --port 8000

# Terminal 2 - frontend (http://localhost:5173, proxies /api -> :8000)
cd frontend
npm install   # first time only
npm run dev
```

Open the frontend URL in a browser:

- **Dashboard** - series overview, history + 3-month daily forecast chart per
  series, benchmark leaderboard (best model per series), and MLflow registry
  champions table.
- **Data & Retrain** - upload a refreshed `contacts_export.xlsx` and/or
  `orders_events.xlsx` (replaces the current source file; a timestamped copy
  is kept in `data/raw/backups/`), then click **Run retrain** to re-run the
  full pipeline (ETL -> benchmark -> register champions -> forecast) and
  poll progress step by step.

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | liveness check |
| GET | `/api/files/status` | raw + processed file sizes/timestamps |
| POST | `/api/upload/contacts` | replace `data/raw/contacts_export.xlsx` |
| POST | `/api/upload/orders` | replace `data/raw/orders_events.xlsx` |
| POST | `/api/retrain` | start the full pipeline as a background job |
| GET | `/api/retrain/status` | poll job status / per-step log |
| GET | `/api/series` | per-series summary (date range, totals) |
| GET | `/api/series/history?series_id=...&days=120` | daily history for charting |
| GET | `/api/benchmark` | full benchmark leaderboard |
| GET | `/api/forecast` | 3-month daily forecast for every series |
| GET | `/api/registry` | MLflow registry champions + backtest metrics |

## Forecast generation (3-month horizon)

`generate_forecast.py` runs each series' champion model for the 92 days
following its last observed date. The known orders/events workbook
(`daily_orders_events.csv`) only extends a few weeks past that date, so
`extend_exog()` synthesizes `EXOG_COLS` for the remainder of the horizon:

- **`Dotcom_Orders_Forecast`**: weekly seasonal carry-forward - each future
  date repeats the value from the same weekday in the most recently known
  week.
- **`Is_Holiday` / `Is_Promotion`**: inferred by checking whether the same
  month/day occurred as a holiday/promotion in any prior year (catches
  fixed-date holidays like Canada Day and the 4th of July).
- Calendar features (`DayOfWeek`, `Month`, `IsWeekend`, `WeekOfYear`,
  `DayOfMonth`) are recomputed for every date via `add_calendar_features()`.

## Backtest design

- Walk-forward (rolling-origin), `horizon = 7` days, `n_folds = 4`,
  `min_train_size = 60` days.
- Exogenous features available for both history *and* the forecast horizon
  (so they're safe for any model): `Dotcom_Orders_Forecast`, `Is_Holiday`,
  `Is_Promotion`, `DayOfWeek`, `Month`, `IsWeekend`, `WeekOfYear`,
  `DayOfMonth`.
- LightGBM additionally uses lag (`1/7/14`) and rolling-mean (`7/14`)
  features, forecast recursively over the horizon.

## Benchmark results (latest run)

Best model per series by average sMAPE over 4 folds:

| Series   | Best model   | sMAPE  | MAE    | Notes |
|----------|-------------|-------:|-------:|-------|
| CH CA EN | SARIMAX      | 14.0%  | 130.9  | |
| CH US EN | LightGBM     | 11.6%  | 299.1  | |
| VO CA EN | LightGBM     | 16.0%  | 50.9   | |
| VO CA FR | LightGBM     | 21.8%  | 9.2    | |
| VO US EN | LightGBM     | 7.0%   | 102.4  | best result overall |
| VO US SP | LightGBM     | 12.6%  | 10.5   | |
| EM US EN | HoltWinters  | 22.0%  | 96.8   | |
| EM CA EN | Naive        | 33.9%  | 8.9    | very low volume (~14/day) |
| EM CA FR | HoltWinters  | 87.2%  | 1.2    | near-zero/intermittent (~1.8/day) |
| CH CA FR | Naive        | 42.9%  | 0.4    | near-zero/intermittent (~0.07/day) |

**Takeaways**

- For the high-volume, business-critical series (`VO US EN`, `CH US EN`,
  `VO CA EN`, `VO CA FR`, `VO US SP`), **LightGBM with lag/rolling/calendar/
  order-volume features wins clearly** — typically 30-55% lower sMAPE than
  the seasonal-naive baseline.
- `CH CA EN` is the one case SARIMAX edges out LightGBM (14.0% vs 14.8%), so
  per-series model selection (rather than one global method) is worth the
  extra complexity.
- For very low-volume / intermittent series (`EM CA FR`, `CH CA FR`,
  `EM CA EN`, all under ~14 contacts/day with many zero days), no model adds
  much value — sMAPE looks bad for everyone but absolute errors are tiny
  (MAE < 9). Simple Naive/HoltWinters baselines are picked because they don't
  overfit to noise.
- A naive "average sMAPE across all series" ranking is misleading: it makes
  LightGBM look mediocre overall because the near-zero series dominate the
  average. Per-series selection (what `train_and_register.py` does) is the
  correct approach.

## MLflow Model Registry

Each series has a registered model `forecast_<SERIES_ID>` (spaces -> `_`),
aliased `champion`, e.g.:

```python
import mlflow
mlflow.set_tracking_uri("sqlite:///mlflow.db")
model = mlflow.pyfunc.load_model("models:/forecast_VO_US_EN@champion")

# model_input: one row per future day with EXOG_COLS (+ optional Date)
forecast_df = model.predict(future_exog_df)
```

To refresh: re-run the full pipeline (steps 1-3). `train_and_register.py`
always refits on the latest full history and creates a new registry version,
re-pointing the `champion` alias.
