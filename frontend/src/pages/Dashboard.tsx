import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, type BenchmarkRow, type ForecastRow, type HistoryPoint, type RegistryEntry, type SeriesSummary } from '../lib/api'

function StatusBanner({ message, kind }: { message: string; kind: 'error' | 'info' }) {
  const cls = kind === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-600 border-slate-200'
  return <div className={`rounded-md border px-4 py-3 text-sm ${cls}`}>{message}</div>
}

function downloadCSV(filename: string, rows: ForecastRow[]) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0]) as (keyof ForecastRow)[]
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => String(row[h])).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function DownloadButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      {label}
    </button>
  )
}

export default function Dashboard() {
  const [series, setSeries] = useState<SeriesSummary[] | null>(null)
  const [benchmark, setBenchmark] = useState<BenchmarkRow[] | null>(null)
  const [forecast, setForecast] = useState<ForecastRow[] | null>(null)
  const [registry, setRegistry] = useState<RegistryEntry[] | null>(null)
  const [selectedSeries, setSelectedSeries] = useState<string>('')
  const [history, setHistory] = useState<HistoryPoint[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.series(), api.benchmark(), api.forecast(), api.registry()])
      .then(([s, b, f, r]) => {
        setSeries(s)
        setBenchmark(b)
        setForecast(f)
        setRegistry(r)
        if (s.length > 0) setSelectedSeries(s[0].Series_ID)
      })
      .catch((err) => setError(String(err)))
  }, [])

  useEffect(() => {
    if (!selectedSeries) return
    api.seriesHistory(selectedSeries, 180).then(setHistory).catch((err) => setError(String(err)))
  }, [selectedSeries])

  const forecastForSelected = useMemo(
    () => (forecast ?? []).filter((f) => f.Series_ID === selectedSeries),
    [forecast, selectedSeries],
  )

  const chartData = useMemo(() => {
    if (!history) return []
    const rows: { date: string; actual?: number; forecast?: number; isHoliday?: boolean }[] = history.map((h) => ({
      date: h.Date,
      actual: h.Contacts,
      isHoliday: h.Is_Holiday === 1,
    }))
    for (const f of forecastForSelected) {
      rows.push({ date: f.Date, forecast: f.forecast })
    }
    return rows
  }, [history, forecastForSelected])

  const bestModels = useMemo(() => {
    if (!benchmark) return []
    const bySeries = new Map<string, BenchmarkRow>()
    for (const row of benchmark) {
      const existing = bySeries.get(row.series_id)
      if (!existing || row.avg_smape < existing.avg_smape) {
        bySeries.set(row.series_id, row)
      }
    }
    return Array.from(bySeries.values()).sort((a, b) => a.series_id.localeCompare(b.series_id))
  }, [benchmark])

  if (error) {
    return <StatusBanner kind="error" message={`Failed to load dashboard data: ${error}. Make sure the API server is running and the pipeline has been run at least once.`} />
  }

  if (!series || !benchmark || !forecast || !registry) {
    return <StatusBanner kind="info" message="Loading dashboard..." />
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Series overview</h2>
          <DownloadButton
            label="Download full 3-month forecast (CSV)"
            onClick={() => downloadCSV('forecast_3_months.csv', forecast ?? [])}
          />
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Series</th>
                <th className="px-3 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 font-medium">Country</th>
                <th className="px-3 py-2 font-medium">Language</th>
                <th className="px-3 py-2 font-medium">Date range</th>
                <th className="px-3 py-2 font-medium text-right">Days</th>
                <th className="px-3 py-2 font-medium text-right">Avg / day</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {series.map((s) => (
                <tr
                  key={s.Series_ID}
                  className={`cursor-pointer hover:bg-indigo-50 ${selectedSeries === s.Series_ID ? 'bg-indigo-50' : ''}`}
                  onClick={() => setSelectedSeries(s.Series_ID)}
                >
                  <td className="px-3 py-2 font-medium text-slate-900">{s.Series_ID}</td>
                  <td className="px-3 py-2">{s.Channel}</td>
                  <td className="px-3 py-2">{s.Country}</td>
                  <td className="px-3 py-2">{s.Language}</td>
                  <td className="px-3 py-2 text-slate-500">{s.start_date} &rarr; {s.end_date}</td>
                  <td className="px-3 py-2 text-right">{s.n_days}</td>
                  <td className="px-3 py-2 text-right">{s.avg_daily_contacts.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            History &amp; 3-month forecast &mdash; <span className="text-indigo-600">{selectedSeries}</span>
          </h2>
          <DownloadButton
            label={`Download ${selectedSeries} forecast (CSV)`}
            onClick={() => downloadCSV(`forecast_3_months_${selectedSeries.replace(/ /g, '_')}.csv`, forecastForSelected)}
          />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4" style={{ height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={20} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="actual" name="Actual contacts" stroke="#4f46e5" dot={false} strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="forecast" name="Forecast (champion model)" stroke="#f97316" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Benchmark leaderboard &mdash; best model per series</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Series</th>
                <th className="px-3 py-2 font-medium">Best model</th>
                <th className="px-3 py-2 font-medium text-right">sMAPE</th>
                <th className="px-3 py-2 font-medium text-right">MAE</th>
                <th className="px-3 py-2 font-medium text-right">RMSE</th>
                <th className="px-3 py-2 font-medium text-right">Folds</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bestModels.map((row) => (
                <tr key={row.series_id} className={selectedSeries === row.series_id ? 'bg-indigo-50' : ''}>
                  <td className="px-3 py-2 font-medium text-slate-900">{row.series_id}</td>
                  <td className="px-3 py-2">
                    <span className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{row.model}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{row.avg_smape.toFixed(2)}%</td>
                  <td className="px-3 py-2 text-right">{row.avg_mae.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{row.avg_rmse.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{row.n_folds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">MLflow Model Registry &mdash; champions</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Registered model</th>
                <th className="px-3 py-2 font-medium">Series</th>
                <th className="px-3 py-2 font-medium">Model type</th>
                <th className="px-3 py-2 font-medium text-right">Version</th>
                <th className="px-3 py-2 font-medium text-right">Backtest sMAPE</th>
                <th className="px-3 py-2 font-medium">Last updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {registry.map((entry) => (
                <tr key={entry.name} className={selectedSeries === entry.series_id ? 'bg-indigo-50' : ''}>
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{entry.name}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{entry.series_id}</td>
                  <td className="px-3 py-2">{entry.model_type ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{entry.version ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{entry.metrics?.smape != null ? `${entry.metrics.smape.toFixed(2)}%` : '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{entry.last_updated ? new Date(entry.last_updated).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
