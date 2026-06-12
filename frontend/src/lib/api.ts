export interface FileInfo {
  exists: boolean
  size_bytes?: number
  modified_at?: string
}

export interface FilesStatus {
  raw: Record<string, FileInfo>
  processed: Record<string, FileInfo>
}

export interface SeriesSummary {
  Series_ID: string
  Channel: string
  Country: string
  Language: string
  start_date: string
  end_date: string
  n_days: number
  total_contacts: number
  avg_daily_contacts: number
}

export interface HistoryPoint {
  Date: string
  Contacts: number
  Is_Holiday: number
  Is_Promotion: number
}

export interface BenchmarkRow {
  series_id: string
  channel: string
  country: string
  language: string
  model: string
  n_obs: number
  avg_mae: number
  avg_rmse: number
  avg_smape: number
  avg_mape?: number
  n_folds: number
  fit_seconds: number
  run_id: string
}

export interface ForecastRow {
  Date: string
  Series_ID: string
  forecast: number
}

export interface RegistryEntry {
  name: string
  series_id: string
  version?: number
  description?: string
  last_updated?: string
  model_type?: string
  metrics?: {
    smape?: number
    mae?: number
    rmse?: number
  }
  error?: string
}

export interface PipelineStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'success' | 'error'
}

export interface RetrainStatus {
  status: 'idle' | 'running' | 'success' | 'error'
  current_step: string | null
  steps: PipelineStep[]
  log: { step: string; label: string; output: string }[]
  started_at: string | null
  finished_at: string | null
  error: string | null
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => getJSON<{ status: string }>('/api/health'),
  filesStatus: () => getJSON<FilesStatus>('/api/files/status'),
  series: () => getJSON<SeriesSummary[]>('/api/series'),
  seriesHistory: (seriesId: string, days = 120) =>
    getJSON<HistoryPoint[]>(`/api/series/history?series_id=${encodeURIComponent(seriesId)}&days=${days}`),
  benchmark: () => getJSON<BenchmarkRow[]>('/api/benchmark'),
  forecast: () => getJSON<ForecastRow[]>('/api/forecast'),
  registry: () => getJSON<RegistryEntry[]>('/api/registry'),
  retrainStatus: () => getJSON<RetrainStatus>('/api/retrain/status'),

  async retrain(): Promise<RetrainStatus> {
    const res = await fetch('/api/retrain', { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? `retrain -> ${res.status}`)
    }
    return res.json()
  },

  async uploadFile(kind: 'contacts' | 'orders', file: File): Promise<{ message: string; filename: string; size_bytes: number; saved_at: string }> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/upload/${kind}`, { method: 'POST', body: form })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? `upload/${kind} -> ${res.status}`)
    }
    return res.json()
  },
}
