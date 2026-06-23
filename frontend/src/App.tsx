import { useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import DataPipeline from './pages/DataPipeline'
import Planning from './pages/Planning'

function App() {
  const [logoFailed, setLogoFailed] = useState(false)

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded-full text-sm font-medium transition-colors ${
      isActive ? 'bg-rose-600 text-white shadow-sm shadow-rose-900/30' : 'text-slate-300 hover:bg-white/10 hover:text-white'
    }`

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 bg-slate-950 shadow-md shadow-black/10">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            {logoFailed ? (
              <span className="text-lg font-bold tracking-[0.2em] text-white">SEPHORA</span>
            ) : (
              <img
                src="/sephora-logo.svg"
                alt="Sephora"
                className="h-7 w-auto"
                onError={() => setLogoFailed(true)}
              />
            )}
            <div className="h-8 w-px bg-white/15" />
            <div>
              <h1 className="text-lg font-semibold text-white tracking-tight">Contact Volume Forecasting</h1>
              <p className="text-xs text-slate-400">ETL &middot; Benchmark &middot; MLflow Model Registry</p>
            </div>
          </div>
          <nav className="flex gap-2">
            <NavLink to="/" className={navClass} end>
              Dashboard
            </NavLink>
            <NavLink to="/planning" className={navClass}>
              Planning
            </NavLink>
            <NavLink to="/data" className={navClass}>
              Data &amp; Retrain
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/planning" element={<Planning />} />
          <Route path="/data" element={<DataPipeline />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
