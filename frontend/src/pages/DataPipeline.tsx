import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type FilesStatus, type RetrainStatus } from '../lib/api'

function formatBytes(bytes?: number): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

const STEP_ICON: Record<string, string> = {
  pending: '⏳',
  running: '⏳',
  success: '✅',
  error: '❌',
}

function UploadCard({
  title,
  description,
  kind,
  info,
  onUploaded,
}: {
  title: string
  description: string
  kind: 'contacts' | 'orders'
  info?: { exists: boolean; size_bytes?: number; modified_at?: string }
  onUploaded: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true)
      setError(null)
      setMessage(null)
      try {
        const result = await api.uploadFile(kind, file)
        setMessage(result.message)
        onUploaded()
      } catch (err) {
        setError(String(err))
      } finally {
        setBusy(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [kind, onUploaded],
  )

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3">
      <div>
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500">{description}</p>
      </div>

      <div className="text-xs text-slate-500 bg-slate-50 rounded-md px-3 py-2">
        <div>Current file: {info?.exists ? `${formatBytes(info.size_bytes)}, updated ${formatDate(info.modified_at)}` : 'not uploaded yet'}</div>
      </div>

      <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 cursor-pointer hover:border-indigo-400 hover:text-indigo-600 transition-colors">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />
        {busy ? 'Uploading…' : 'Click to choose an .xlsx file, or drag it here'}
      </label>

      {message && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">{message}</div>}
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>}
    </div>
  )
}

export default function DataPipeline() {
  const [files, setFiles] = useState<FilesStatus | null>(null)
  const [status, setStatus] = useState<RetrainStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)

  const refreshFiles = useCallback(() => {
    api.filesStatus().then(setFiles).catch((err) => setError(String(err)))
  }, [])

  const refreshStatus = useCallback(() => {
    api
      .retrainStatus()
      .then((s) => {
        setStatus(s)
        if (s.status !== 'running' && pollRef.current) {
          window.clearInterval(pollRef.current)
          pollRef.current = null
          refreshFiles()
        }
      })
      .catch((err) => setError(String(err)))
  }, [refreshFiles])

  useEffect(() => {
    refreshFiles()
    refreshStatus()
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [refreshFiles, refreshStatus])

  const startRetrain = useCallback(async () => {
    setError(null)
    try {
      const s = await api.retrain()
      setStatus(s)
      if (!pollRef.current) {
        pollRef.current = window.setInterval(refreshStatus, 2000)
      }
    } catch (err) {
      setError(String(err))
    }
  }, [refreshStatus])

  const isRunning = status?.status === 'running'

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">1. Inject new data</h2>
        <p className="text-sm text-slate-500 mb-3">
          Uploading a file <strong>replaces</strong> the current source workbook (a timestamped backup is kept in{' '}
          <code className="bg-slate-100 px-1 rounded">data/raw/backups/</code>). Run a retrain afterwards to rebuild the
          dataset and models on the refreshed history.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UploadCard
            title="Contacts export (Ss.xlsx)"
            description="Gladly Email/Chat + Voice export sheets used to build daily_contacts.csv."
            kind="contacts"
            info={files?.raw['contacts_export.xlsx']}
            onUploaded={refreshFiles}
          />
          <UploadCard
            title="Orders &amp; events workbook"
            description="Daily Orders Actuals + Forecast, plus the Events/Holidays sheet."
            kind="orders"
            info={files?.raw['orders_events.xlsx']}
            onUploaded={refreshFiles}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">2. Retrain</h2>
        <p className="text-sm text-slate-500 mb-3">
          Re-runs the full pipeline: ETL (contacts, orders &amp; events, master dataset) &rarr; benchmark every model x
          series (walk-forward backtest) &rarr; refit &amp; register the per-series champion in the MLflow Model
          Registry &rarr; generate the next 7-day forecast. This can take several minutes.
        </p>
        <button
          onClick={startRetrain}
          disabled={isRunning}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRunning ? 'Retrain running…' : 'Run retrain'}
        </button>

        {error && <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>}

        {status && status.status !== 'idle' && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-700">
                Status: <span className="capitalize">{status.status}</span>
              </span>
              {status.started_at && <span className="text-xs text-slate-400">started {formatDate(status.started_at)}</span>}
            </div>

            <ol className="flex flex-col gap-2">
              {status.steps.map((step) => (
                <li key={step.id} className="flex items-center gap-2 text-sm">
                  <span>{STEP_ICON[step.status]}</span>
                  <span className={step.status === 'running' ? 'font-medium text-indigo-600' : 'text-slate-700'}>{step.label}</span>
                </li>
              ))}
            </ol>

            {status.error && (
              <pre className="mt-3 whitespace-pre-wrap text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{status.error}</pre>
            )}

            {status.log.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-slate-500">Show step output</summary>
                <div className="mt-2 flex flex-col gap-2">
                  {status.log.map((entry) => (
                    <div key={entry.step}>
                      <div className="text-xs font-medium text-slate-600">{entry.label}</div>
                      <pre className="whitespace-pre-wrap text-xs bg-slate-50 border border-slate-200 rounded-md px-3 py-2 max-h-64 overflow-auto">{entry.output}</pre>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Processed dataset files</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium text-right">Size</th>
                <th className="px-3 py-2 font-medium">Last updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {files &&
                Object.entries(files.processed).map(([name, info]) => (
                  <tr key={name}>
                    <td className="px-3 py-2 font-mono text-xs text-slate-700">{name}</td>
                    <td className="px-3 py-2 text-right">{formatBytes(info.size_bytes)}</td>
                    <td className="px-3 py-2 text-slate-500">{formatDate(info.modified_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
