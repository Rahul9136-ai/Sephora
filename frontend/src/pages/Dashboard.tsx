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
import { downloadCSV } from '../lib/csv'
import SectionHeading from '../components/SectionHeading'

function StatusBanner({ message, kind }: { message: string; kind: 'error' | 'info' }) {
  const cls = kind === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-600 border-slate-200'
  return <div className={`rounded-xl border px-4 py-3 text-sm shadow-sm ${cls}`}>{message}</div>
}

function DownloadButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
    >
      {label}
    </button>
  )
}

function StatCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {sublabel && <p className="mt-1 text-xs text-slate-500">{sublabel}</p>}
    </div>
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

  const stats = useMemo(() => {
    if (!series || !forecast || !registry) return null
    return {
      seriesCount: series.length,
      combinedAvgDaily: series.reduce((sum, s) => sum + s.avg_daily_contacts, 0),
      forecastDays: new Set(forecast.map((f) => f.Date)).size,
      championsCount: registry.length,
    }
  }, [series, forecast, registry])

  if (error) {
    return <StatusBanner kind="error" message={`Failed to load dashboard data: ${error}. Make sure the API server is running and the pipeline has been run at least once.`} />
  }

  if (!series || !benchmark || !forecast || !registry) {
    return <StatusBanner kind="info" message="Loading dashboard..." />
  }

  return (
    <div className="flex flex-col gap-6">
      {stats && (
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Active series" value={String(stats.seriesCount)} />
          <StatCard
            label="Combined avg / day"
            value={Math.round(stats.combinedAvgDaily).toLocaleString()}
            sublabel="contacts across all series"
          />
          <StatCard label="Forecast horizon" value={`${stats.forecastDays} days`} />
          <StatCard label="Registered champions" value={String(stats.championsCount)} />
        </section>
      )}

      <section>
        <SectionHeading
          action={
            <DownloadButton
              label="Download full 3-month forecast (CSV)"
              onClick={() => downloadCSV('forecast_3_months.csv', forecast ?? [])}
            />
          }
        >
          Series overview
        </SectionHeading>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Series</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Country</th>
                <th className="px-4 py-3">Language</th>
                <th className="px-4 py-3">Date range</th>
                <th className="px-4 py-3 text-right">Days</th>
                <th className="px-4 py-3 text-right">Avg / day</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {series.map((s) => (
                <tr
                  key={s.Series_ID}
                  className={`cursor-pointer transition-colors hover:bg-rose-50 ${selectedSeries === s.Series_ID ? 'bg-rose-50' : ''}`}
                  onClick={() => setSelectedSeries(s.Series_ID)}
                >
                  <td className="px-4 py-2.5 font-medium text-slate-900">{s.Series_ID}</td>
                  <td className="px-4 py-2.5">{s.Channel}</td>
                  <td className="px-4 py-2.5">{s.Country}</td>
                  <td className="px-4 py-2.5">{s.Language}</td>
                  <td className="px-4 py-2.5 text-slate-500">{s.start_date} &rarr; {s.end_date}</td>
                  <td className="px-4 py-2.5 text-right">{s.n_days}</td>
                  <td className="px-4 py-2.5 text-right">{s.avg_daily_contacts.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionHeading
          action={
            <DownloadButton
              label={`Download ${selectedSeries} forecast (CSV)`}
              onClick={() => downloadCSV(`forecast_3_months_${selectedSeries.replace(/ /g, '_')}.csv`, forecastForSelected)}
            />
          }
        >
          History &amp; 3-month forecast &mdash;{' '}
          <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
            {selectedSeries}
          </span>
        </SectionHeading>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" style={{ height: 380 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={20} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
              <Legend />
              <Line type="monotone" dataKey="actual" name="Actual contacts" stroke="#1e293b" dot={false} strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="forecast" name="Forecast (champion model)" stroke="#e11d48" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <SectionHeading>Benchmark leaderboard &mdash; best model per series</SectionHeading>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Series</th>
                <th className="px-4 py-3">Best model</th>
                <th className="px-4 py-3 text-right">sMAPE</th>
                <th className="px-4 py-3 text-right">MAE</th>
                <th className="px-4 py-3 text-right">RMSE</th>
                <th className="px-4 py-3 text-right">Folds</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bestModels.map((row) => (
                <tr key={row.series_id} className={`transition-colors ${selectedSeries === row.series_id ? 'bg-rose-50' : ''}`}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{row.series_id}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-block rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">{row.model}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">{row.avg_smape.toFixed(2)}%</td>
                  <td className="px-4 py-2.5 text-right">{row.avg_mae.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right">{row.avg_rmse.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right">{row.n_folds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionHeading>MLflow Model Registry &mdash; champions</SectionHeading>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Registered model</th>
                <th className="px-4 py-3">Series</th>
                <th className="px-4 py-3">Model type</th>
                <th className="px-4 py-3 text-right">Version</th>
                <th className="px-4 py-3 text-right">Backtest sMAPE</th>
                <th className="px-4 py-3">Last updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {registry.map((entry) => (
                <tr key={entry.name} className={`transition-colors ${selectedSeries === entry.series_id ? 'bg-rose-50' : ''}`}>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{entry.name}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{entry.series_id}</td>
                  <td className="px-4 py-2.5">{entry.model_type ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">{entry.version ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">{entry.metrics?.smape != null ? `${entry.metrics.smape.toFixed(2)}%` : '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{entry.last_updated ? new Date(entry.last_updated).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
