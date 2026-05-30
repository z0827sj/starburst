import { useState, useEffect, useRef, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import './App.css'
import HistoryPage from './History'
import RepoDetail from './RepoDetail'
import RankingsPage from './Ecosystem'
import Navbar from './Navbar'

/* ===== Types ===== */

interface Stats {
  total_events: number; total_repos: number; bursts_today: number; active_now: number
}

interface Burst {
  id: number; hot_score?: number; repo_name: string; repo_url: string
  star_count: number; window_minutes: number; baseline_avg: number
  timestamp: number; description: string; source?: string
}

interface DailyPoint {
  date: string; events: number; repos: number; bursts: number; active: number
}

interface GrowthRepo {
  repo_name: string; repo_url: string; total_stars: number
  chart: { time: string; count: number; total: number }[]
}

interface ServerStatus {
  simulate: boolean; pollIntervalSec: number; uptime: number; lastPoll: number | null
}

/* ===== Utils ===== */

function velocity(b: { star_count: number; window_minutes: number }): number { return b.star_count / b.window_minutes }
function hotScore(burst: Burst): number { if (burst.hot_score !== undefined) return burst.hot_score; const v = velocity(burst); const ageMin = (Date.now() - burst.timestamp) / 60000; return v / Math.pow((ageMin / 30) + 1, 1.2) }
function fmt(n: number): string { if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'; if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'; return n.toLocaleString() }
function fmtV(d: number): string { return d.toFixed(1) }
function timeAgo(ts: number): string { const diff = Date.now() - ts; const sec = Math.floor(diff / 1000); if (sec < 10) return 'just now'; if (sec < 60) return sec + 's ago'; const min = Math.floor(sec / 60); if (min < 60) return min + 'm ago'; const hr = Math.floor(min / 60); if (hr < 24) return hr + 'h ago'; return Math.floor(hr / 24) + 'd ago' }
function byHotScore(a: Burst, b: Burst): number { return hotScore(b) - hotScore(a) }
function intensityLevel(d: number): 'high' | 'medium' | 'low' { if (d >= 10) return 'high'; if (d >= 4) return 'medium'; return 'low' }
function intensityLabel(d: number): string { if (d >= 10) return 'Explosive'; if (d >= 4) return 'Surging'; return 'Rising' }
function ageClass(ts: number): string { const m = (Date.now() - ts) / 60000; if (m < 10) return ''; if (m < 60) return ' aged-1'; return ' aged-2' }

/* ===== Radar Chart Data ===== */

function buildRadarData(
  repo: GrowthRepo,
  bursts: Burst[],
  allGrowth: GrowthRepo[]
): { axis: string; value: number; fullMark: number }[] {
  const repoBursts = bursts.filter(b => b.repo_name === repo.repo_name)
  const maxStars = Math.max(...allGrowth.map(r => r.total_stars), 1)
  const maxVel = Math.max(...bursts.map(b => velocity(b)), 1)
  const maxCount = Math.max(...allGrowth.map(() => 1), 1)
  const maxHot = Math.max(...bursts.map(b => hotScore(b)), 1)

  const peakV = repoBursts.length > 0 ? Math.max(...repoBursts.map(b => velocity(b))) : 0
  const burstCount = repoBursts.length
  const latestHot = repoBursts.length > 0 ? hotScore(repoBursts.reduce((a, b) => a.timestamp > b.timestamp ? a : b)) : 0
  const lastTs = repoBursts.length > 0 ? Math.max(...repoBursts.map(b => b.timestamp)) : 0
  const recencyScore = lastTs > 0 ? Math.max(0, 100 - ((Date.now() - lastTs) / 3600000) * 10) : 0

  const actualMaxCount = Math.max(...allGrowth.map(() => bursts.filter(b => b.repo_name === repo.repo_name).length), 1)

  return [
    { axis: 'Total Stars', value: Math.round((repo.total_stars / maxStars) * 100), fullMark: 100 },
    { axis: 'Peak Velocity', value: Math.round((peakV / maxVel) * 100), fullMark: 100 },
    { axis: 'Burst Count', value: Math.round((burstCount / actualMaxCount) * 100), fullMark: 100 },
    { axis: 'Hot Score', value: Math.round((latestHot / maxHot) * 100), fullMark: 100 },
    { axis: 'Recency', value: Math.round(recencyScore), fullMark: 100 },
  ]
}

/* ===== Stat Modal ===== */

function StatModal({ metric, data, onClose }: { metric: string; data: DailyPoint[]; onClose: () => void }) {
  const titles: Record<string, string> = {
    events: 'Events Tracked', repos: 'Repos Monitored', bursts: 'Bursts Detected', active: 'Active Repos'
  }
  const colors: Record<string, string> = { events: '#7c3aed', repos: '#0891b2', bursts: '#dc2626', active: '#d97706' }
  const key = metric as keyof typeof titles
  const color = colors[key] || '#7c3aed'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{titles[key]} — Last {data.length} days</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, left: 0, right: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#a3a3a3' }} tickLine={false} axisLine={false}
                tickFormatter={(v: string) => { const d = new Date(v + 'T00:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }} />
              <YAxis tick={{ fontSize: 10, fill: '#a3a3a3' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#fff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10, fontSize: 13 }} />
              <Bar dataKey={key} fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

/* ===== Burst Card ===== */

function BurstCard({ burst, isNew, maxV }: { burst: Burst; isNew: boolean; maxV: number }) {
  const d = velocity(burst); const lvl = intensityLevel(d); const barPct = maxV > 0 ? Math.round((d / maxV) * 100) : 100
  const owner = burst.repo_name.split('/')[0]
  const avatar = `https://github.com/${owner}.png`
  return (
    <div className={`burst-card intensity-${lvl}${ageClass(burst.timestamp)} ${isNew ? 'is-new' : ''}`}
      style={{ '--bar': barPct + '%' } as React.CSSProperties} onClick={() => { window.location.hash = `#/repo/${burst.repo_name}` }}>
      <div className="burst-header">
        <img src={avatar} alt="" className="burst-avatar" loading="lazy"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        <a className="burst-repo" href={burst.repo_url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>
          {burst.repo_name}
        </a>
        <span className="burst-time">{timeAgo(burst.timestamp)}</span>
      </div>
      <div className="burst-stats">
        <span className="burst-count">+{burst.star_count}</span>
        <span className="burst-velocity">{fmtV(d)} ⭐/min</span>
        <span className={`burst-tag ${lvl}`}>{intensityLabel(d)}</span>
      </div>
      <div className="burst-detail">{burst.star_count} stars in {burst.window_minutes}min · hot {hotScore(burst).toFixed(1)}{burst.baseline_avg > 0 && <> · {(d / Math.max(burst.baseline_avg, 0.01)).toFixed(1)}x vs baseline</>}{burst.source && <span className="burst-source"> · {burst.source}</span>}</div>
    </div>
  )
}

/* ===== Main App ===== */

export default function App() {
  const getPage = () => {
    const h = window.location.hash
    if (h.startsWith('#/repo/')) return 'repo'
    if (h === '#/history') return 'history'
    if (h === '#/rankings') return 'rankings'
    return 'dashboard'
  }
  const [page, setPage] = useState<'dashboard' | 'history' | 'repo' | 'rankings'>(getPage())
  const [repoOwner, setRepoOwner] = useState('')
  const [repoName, setRepoName] = useState('')
  const navigate = useCallback((p: string) => {
    if (p === 'dashboard') window.location.hash = '#/'
    else if (p === 'history') window.location.hash = '#/history'
    else if (p === 'rankings') window.location.hash = '#/rankings'
    else window.location.hash = p
    setPage(getPage())
  }, [])
  useEffect(() => { const h = () => { setPage(getPage()); const hash = window.location.hash; if (hash.startsWith('#/repo/')) { const parts = hash.replace('#/repo/', '').split('/'); setRepoOwner(parts[0]); setRepoName(parts.slice(1).join('/')) } }; window.addEventListener('hashchange', h); if (window.location.hash.startsWith('#/repo/')) h(); return () => window.removeEventListener('hashchange', h) }, [])

  const [stats, setStats] = useState<Stats>({ total_events: 0, total_repos: 0, bursts_today: 0, active_now: 0 })
  const [bursts, setBursts] = useState<Burst[]>([])
  const [connected, setConnected] = useState(false)
  const [newIds, setNewIds] = useState<Set<number>>(new Set())
  const [status, setStatus] = useState<ServerStatus>({ simulate: false, pollIntervalSec: 30, uptime: 0, lastPoll: null })
  const [growthRepos, setGrowthRepos] = useState<GrowthRepo[]>([])
  const [selectedRepo, setSelectedRepo] = useState<string>('')
  const [dailyStats, setDailyStats] = useState<DailyPoint[]>([])
  const [modalMetric, setModalMetric] = useState<string | null>(null)
  const [notifyEnabled, setNotifyEnabled] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme')
    return saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  // Sync theme to DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  const toggleTheme = () => setDark(d => !d)
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Request notification permission
  const toggleNotify = useCallback(() => {
    if (!('Notification' in window)) return
    if (Notification.permission === 'granted') {
      setNotifyEnabled(v => !v)
    } else {
      Notification.requestPermission().then(p => {
        if (p === 'granted') setNotifyEnabled(true)
      })
    }
  }, [])

  // Toast helper
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(null), 5000)
  }, [])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef(0)
  const notifyEnabledRef = useRef(false)

  // Sync notifyEnabled ref
  useEffect(() => { notifyEnabledRef.current = notifyEnabled }, [notifyEnabled])

  const connect = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${location.host}/ws`); wsRef.current = ws
    ws.onopen = () => { setConnected(true); reconnectRef.current = 0 }
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'new_burst') {
          const burst = msg.data as Burst
          setBursts(prev => { const next = [burst, ...prev].slice(0, 50); next.sort(byHotScore); return next })
          setNewIds(prev => new Set(prev).add(burst.id!))
          setTimeout(() => setNewIds(prev => { const n = new Set(prev); n.delete(burst.id!); return n }), 3000)

          // Desktop notification
          if (notifyEnabledRef.current && Notification.permission === 'granted') {
            const v = velocity(burst)
            new Notification(`🔥 ${burst.repo_name}`, {
              body: `+${burst.star_count}⭐ in ${burst.window_minutes}min (${v.toFixed(1)}/min)`,
              icon: '/favicon.svg',
              tag: burst.repo_name,
            })
          }

          // Toast alert for high-velocity bursts
          if (velocity(burst) >= 5) {
            showToast(`🔥 ${burst.repo_name} +${burst.star_count}⭐ in ${burst.window_minutes}min`)
          }
        }
        if (msg.type === 'burst_attribution') {
          setBursts(prev => prev.map(b => b.id === msg.data.id ? { ...b, source: msg.data.source } : b))
        }
        if (msg.type === 'ai_attribution') {
          setBursts(prev => prev.map(b => b.id === msg.data.id
            ? { ...b, source: b.source ? `${b.source} · ${msg.data.summary}` : msg.data.summary } : b))
        }
        if (msg.type === 'stats_update') setStats(msg.data)
      } catch {}
    }
    ws.onclose = () => { setConnected(false); const delay = Math.min(1000 * Math.pow(2, reconnectRef.current), 30000); reconnectRef.current++; setTimeout(connect, delay) }
    ws.onerror = () => ws.close()
  }, [])

  const fetchDashboard = useCallback(async () => {
    try {
      const [sr, br, gr, ds] = await Promise.all([
        fetch('/api/stats').then(r => r.json()).catch(() => null),
        fetch('/api/bursts?limit=50').then(r => r.json()).catch(() => null),
        fetch('/api/repos/growth?limit=8&hours=24').then(r => r.json()).catch(() => null),
        fetch('/api/stats/daily?days=30').then(r => r.json()).catch(() => null),
        fetch('/api/status').then(r => r.json()).catch(() => null),
      ])
      if (sr?.total_events !== undefined) setStats(sr)
      if (br?.length) { const s = (br as Burst[]).sort(byHotScore); setBursts(s) }
      if (gr?.length) { setGrowthRepos(gr); if (!selectedRepo) setSelectedRepo(gr[0].repo_name) }
      if (ds?.length) setDailyStats(ds)
    } catch {}
  }, [selectedRepo])

  useEffect(() => { connect(); return () => { wsRef.current?.close() } }, [connect])
  useEffect(() => { fetchDashboard(); const i = setInterval(fetchDashboard, 30000); return () => clearInterval(i) }, [fetchDashboard])

  // Keyboard shortcut
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); navigate('history')
      }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [navigate])

  // Scroll-to-top
  useEffect(() => {
    const h = () => setShowScrollTop(window.scrollY > 400)
    window.addEventListener('scroll', h, { passive: true }); return () => window.removeEventListener('scroll', h)
  }, [])

  // Dynamic favicon + title
  useEffect(() => {
    const active = bursts.filter(b => (Date.now() - b.timestamp) < 600000).length
    document.title = active > 0 ? `(${active}) StarBurst` : 'StarBurst'
    if (active > 0) {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#7c3aed'; ctx.beginPath(); ctx.arc(16, 16, 14, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(String(Math.min(active, 99)), 16, 21)
      const link = document.querySelector('link[rel="icon"]') as HTMLLinkElement
      if (link) link.href = canvas.toDataURL()
    }
  }, [bursts])

  const maxV = Math.max(...bursts.map(b => velocity(b)), 1)
  const selectedGrowth = growthRepos.find(r => r.repo_name === selectedRepo)

  if (page === 'history') return <HistoryPage navigate={navigate} />
  if (page === 'rankings') return <RankingsPage navigate={navigate} />
  if (page === 'repo' && repoOwner && repoName) return <RepoDetail owner={repoOwner} name={repoName} navigate={navigate} />

  return (
    <div className="app">
      {/* Header */}
      <Navbar active="dashboard" navigate={navigate}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="status-badge">
            <span className={`status-dot ${connected ? '' : 'error'}`} />{connected ? 'Live' : 'Connecting...'}{status.simulate && <span style={{ marginLeft: 4, opacity: 0.6 }}>· SIM</span>}
          </div>
          <button className="notify-toggle" onClick={toggleTheme}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
            {dark ? '☀️' : '🌙'}
          </button>
          {'Notification' in window && (
            <button className={`notify-toggle ${notifyEnabled ? 'active' : ''}`}
              onClick={toggleNotify}
              title={notifyEnabled ? 'Disable desktop alerts' : 'Enable desktop alerts'}
            >{notifyEnabled ? '🔔' : '🔕'}</button>
          )}
        </div>
      </Navbar>

      {/* Stats Row */}
      <div className="stats-row">
        {[
          { icon: '📊', label: 'Events Tracked', value: stats.total_events, metric: 'events' },
          { icon: '📦', label: 'Repos Monitored', value: stats.total_repos, metric: 'repos' },
          { icon: '🔥', label: 'Bursts Today', value: stats.bursts_today, metric: 'bursts' },
          { icon: '⚡', label: 'Active Now', value: stats.active_now, metric: 'active' },
        ].map(s => (
          <div key={s.metric} className="stat-card clickable" onClick={() => setModalMetric(s.metric)}>
            <div className="stat-icon">{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{fmt(s.value)}</div>
          </div>
        ))}
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Left: Burst Feed */}
        <div className="panel burst-feed">
          <div className="panel-header"><span className="icon">🌋</span> Live Burst Feed · sorted by hot score</div>
          <div className="panel-body">
            {bursts.length === 0 ? (
              <div className="empty-state"><div className="icon">🛰️</div><p>Monitoring GitHub for star bursts. Detected anomalies will appear here in real-time.</p></div>
            ) : bursts.map(b => <BurstCard key={b.id} burst={b} isNew={newIds.has(b.id!)} maxV={maxV} />)}
          </div>
        </div>

        {/* Right: Hot Right Now */}
        <div className="panel hot-panel">
          <div className="panel-header"><span className="icon">🔥</span> Hot Right Now · by velocity</div>
          <div className="panel-body">
            {bursts.length === 0 ? (
              <div className="empty-state" style={{ padding: 40 }}><div className="icon">🛰️</div><p>Waiting for burst data...</p></div>
            ) : (
              <div className="hot-list">
                {(() => {
                  const repoVels = new Map<string, { name: string; maxV: number; latestStars: number; latestWin: number; ts: number }>()
                  bursts.forEach(b => {
                    const v = velocity(b)
                    const existing = repoVels.get(b.repo_name)
                    if (!existing || v > existing.maxV) {
                      repoVels.set(b.repo_name, { name: b.repo_name, maxV: v, latestStars: b.star_count, latestWin: b.window_minutes, ts: b.timestamp })
                    }
                  })
                  const top = Array.from(repoVels.values()).sort((a, b) => b.maxV - a.maxV).slice(0, 8)
                  const globalMaxV = top.length > 0 ? top[0].maxV : 1
                  return top.map((r, i) => {
                    const barW = Math.round((r.maxV / globalMaxV) * 100)
                    const lvl = intensityLevel(r.maxV)
                    const hotOwner = r.name.split('/')[0]
                    const hotAvatar = `https://github.com/${hotOwner}.png`
                    return (
                      <div key={r.name} className="hot-row"
                        onClick={() => { window.location.hash = `#/repo/${r.name}` }}>
                        <span className="hot-rank">{i + 1}</span>
                        <img src={hotAvatar} alt="" className="hot-avatar"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        <div className="hot-body">
                          <span className="hot-name">{r.name}</span>
                          <span className="hot-meta">{r.latestStars}⭐ in {r.latestWin}min · {timeAgo(r.ts)}</span>
                        </div>
                        <div className="hot-right">
                          <span className="hot-vel">{fmtV(r.maxV)}<span className="hot-unit">/min</span></span>
                          <span className={`hot-badge ${lvl}`}>{intensityLabel(r.maxV)}</span>
                        </div>
                        <div className="hot-bar-track">
                          <div className={`hot-bar-fill ${lvl}`} style={{ width: barW + '%' }} />
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}

      {/* Scroll to top */}
      {showScrollTop && (
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="scroll-top-btn" title="Scroll to top">↑</button>
      )}

      {/* Footer */}
      <footer className="footer">
        <div className="footer-item"><span style={{ color: connected ? 'var(--accent-green)' : 'var(--text-muted)' }}>●</span>{connected ? 'Connected' : 'Disconnected'}</div>
        <div className="footer-item">{status.simulate ? '🎭 Simulation mode' : '🌐 Live GitHub API'}<span style={{ margin: '0 8px', opacity: 0.3 }}>·</span>Polling every {status.pollIntervalSec}s</div>
        <div className="footer-item">Uptime {Math.floor(status.uptime / 60)}m {Math.floor(status.uptime % 60)}s</div>
      </footer>

      {/* Stat Modal */}
      {modalMetric && dailyStats.length > 0 && (
        <StatModal metric={modalMetric} data={dailyStats} onClose={() => setModalMetric(null)} />
      )}
    </div>
  )
}