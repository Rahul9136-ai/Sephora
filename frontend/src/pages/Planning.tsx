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
import { api, type ForecastRow, type SeriesSummary } from '../lib/api'
import { downloadCSV } from '../lib/csv'
import { applyShrinkageAndConcurrency, erlangCAgents, requiredAgentsLinear } from '../lib/staffing'
import SectionHeading from '../components/SectionHeading'

function StatusBanner({ message, kind }: { message: string; kind: 'error' | 'info' }) {
  const cls = kind === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-600 border-slate-200'
  return <div className={`rounded-xl border px-4 py-3 text-sm shadow-sm ${cls}`}>{message}</div>
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

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-400"
      />
    </label>
  )
}

type ErlangParams = {
  ahtSeconds: number
  targetSL: number
  targetAnswerSeconds: number
  shrinkagePct: number
  operatingHours: number
  concurrency: number
}

type LinearParams = {
  ahtSeconds: number
  operatingHours: number
  shrinkagePct: number
}

const ERLANG_DEFAULTS: Record<'VO' | 'CH', ErlangParams> = {
  VO: { ahtSeconds: 300, targetSL: 80, targetAnswerSeconds: 20, shrinkagePct: 30, operatingHours: 24, concurrency: 1 },
  CH: { ahtSeconds: 600, targetSL: 80, targetAnswerSeconds: 60, shrinkagePct: 30, operatingHours: 24, concurrency: 2 },
}

const LINEAR_DEFAULTS: LinearParams = { ahtSeconds: 900, operatingHours: 8, shrinkagePct: 30 }

export default function Planning() {
  const [series, setSeries] = useState<SeriesSummary[] | null>(null)
  const [forecast, setForecast] = useState<ForecastRow[] | null>(null)
  const [selectedSeries, setSelectedSeries] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const [erlangParams, setErlangParams] = useState<ErlangParams>(ERLANG_DEFAULTS.VO)
  const [linearParams, setLinearParams] = useState<LinearParams>(LINEAR_DEFAULTS)

  useEffect(() => {
    Promise.all([api.series(), api.forecast()])
      .then(([s, f]) => {
        setSeries(s)
        setForecast(f)
        if (s.length > 0) setSelectedSeries(s[0].Series_ID)
      })
      .catch((err) => setError(String(err)))
  }, [])

  const selected = useMemo(() => series?.find((s) => s.Series_ID === selectedSeries) ?? null, [series, selectedSeries])
  const isErlang = selected?.Channel === 'VO' || selected?.Channel === 'CH'

  useEffect(() => {
    if (selected?.Channel === 'VO' || selected?.Channel === 'CH') {
      setErlangParams(ERLANG_DEFAULTS[selected.Channel])
    }
  }, [selected?.Channel])

  const forecastForSelected = useMemo(
    () => (forecast ?? []).filter((f) => f.Series_ID === selectedSeries).sort((a, b) => a.Date.localeCompare(b.Date)),
    [forecast, selectedSeries],
  )

  const plan = useMemo(() => {
    return forecastForSelected.map((row) => {
      if (isErlang) {
        const result = erlangCAgents({
          volumePerDay: row.forecast,
          ahtSeconds: erlangParams.ahtSeconds,
          operatingHours: erlangParams.operatingHours,
          targetSL: erlangParams.targetSL,
          targetAnswerSeconds: erlangParams.targetAnswerSeconds,
        })
        const agents = applyShrinkageAndConcurrency(result.agents, erlangParams.shrinkagePct, erlangParams.concurrency)
        return { date: row.Date, volume: row.forecast, agents, serviceLevel: result.serviceLevel }
      }
      const raw = requiredAgentsLinear({
        volumePerDay: row.forecast,
        ahtSeconds: linearParams.ahtSeconds,
        operatingHours: linearParams.operatingHours,
      })
      const agents = applyShrinkageAndConcurrency(raw, linearParams.shrinkagePct)
      return { date: row.Date, volume: row.forecast, agents, serviceLevel: undefined as number | undefined }
    })
  }, [forecastForSelected, isErlang, erlangParams, linearParams])

  const stats = useMemo(() => {
    if (plan.length === 0) return null
    const total = plan.reduce((sum, p) => sum + p.agents, 0)
    const peak = Math.max(...plan.map((p) => p.agents))
    return { avg: total / plan.length, peak }
  }, [plan])

  if (error) {
    return <StatusBanner kind="error" message={`Failed to load planning data: ${error}. Make sure the API server is running and the pipeline has been run at least once.`} />
  }

  if (!series || !forecast) {
    return <StatusBanner kind="info" message="Loading planning data..." />
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionHeading>Series</SectionHeading>
        <div className="flex flex-wrap gap-2">
          {series.map((s) => (
            <button
              key={s.Series_ID}
              onClick={() => setSelectedSeries(s.Series_ID)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                selectedSeries === s.Series_ID
                  ? 'bg-rose-600 text-white shadow-sm shadow-rose-900/30'
                  : 'border border-slate-300 bg-white text-slate-700 hover:border-rose-300 hover:bg-rose-50'
              }`}
            >
              {s.Series_ID}
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading>
          Staffing inputs &mdash;{' '}
          <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
            {isErlang ? 'Erlang C (real-time queue)' : 'Linear (workload model)'}
          </span>
        </SectionHeading>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {isErlang ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <NumberField label="AHT (sec)" value={erlangParams.ahtSeconds} onChange={(v) => setErlangParams({ ...erlangParams, ahtSeconds: v })} />
              <NumberField label="Target service level (%)" value={erlangParams.targetSL} onChange={(v) => setErlangParams({ ...erlangParams, targetSL: v })} />
              <NumberField label="Target answer time (sec)" value={erlangParams.targetAnswerSeconds} onChange={(v) => setErlangParams({ ...erlangParams, targetAnswerSeconds: v })} />
              <NumberField label="Shrinkage (%)" value={erlangParams.shrinkagePct} onChange={(v) => setErlangParams({ ...erlangParams, shrinkagePct: v })} />
              <NumberField label="Operating hours/day" value={erlangParams.operatingHours} onChange={(v) => setErlangParams({ ...erlangParams, operatingHours: v })} />
              {selected?.Channel === 'CH' && (
                <NumberField label="Concurrency" value={erlangParams.concurrency} onChange={(v) => setErlangParams({ ...erlangParams, concurrency: v })} min={1} />
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <NumberField label="AHT (sec)" value={linearParams.ahtSeconds} onChange={(v) => setLinearParams({ ...linearParams, ahtSeconds: v })} />
              <NumberField label="Operating hours/day (per agent)" value={linearParams.operatingHours} onChange={(v) => setLinearParams({ ...linearParams, operatingHours: v })} />
              <NumberField label="Shrinkage (%)" value={linearParams.shrinkagePct} onChange={(v) => setLinearParams({ ...linearParams, shrinkagePct: v })} />
            </div>
          )}
        </div>
      </section>

      {stats && (
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Avg agents required" value={stats.avg.toFixed(1)} sublabel={`across ${plan.length}-day forecast`} />
          <StatCard label="Peak agents required" value={stats.peak.toFixed(1)} />
          <StatCard label="Model" value={isErlang ? 'Erlang C' : 'Linear'} />
          <StatCard label="Series" value={selectedSeries} />
        </section>
      )}

      <section>
        <SectionHeading
          action={
            <button
              type="button"
              onClick={() => downloadCSV(`staffing_plan_${selectedSeries.replace(/ /g, '_')}.csv`, plan)}
              className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
            >
              Download staffing plan (CSV)
            </button>
          }
        >
          Required agents over forecast horizon
        </SectionHeading>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" style={{ height: 380 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={plan}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={20} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }} />
              <Legend />
              <Line type="monotone" dataKey="agents" name="Required agents" stroke="#e11d48" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <SectionHeading>Daily staffing plan</SectionHeading>
        <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Forecast volume</th>
                <th className="px-4 py-3 text-right">Required agents</th>
                {isErlang && <th className="px-4 py-3 text-right">Service level</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {plan.map((row) => (
                <tr key={row.date}>
                  <td className="px-4 py-2.5 text-slate-700">{row.date}</td>
                  <td className="px-4 py-2.5 text-right">{row.volume.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-900">{Math.ceil(row.agents)}</td>
                  {isErlang && (
                    <td className="px-4 py-2.5 text-right">{row.serviceLevel != null ? `${(row.serviceLevel * 100).toFixed(1)}%` : '—'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
