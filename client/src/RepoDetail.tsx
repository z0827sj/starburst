import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts'
import './RepoDetail.css'

/* ===== Types ===== */

interface RepoInfo {
  full_name: string; html_url: string; description: string
  stars: number; forks: number; language: string; topics: string[]
  open_issues: number; created_at: string; owner_avatar: string; subscribers: number
}

interface BurstEvent {
  id: number; star_count: number; window_minutes: number; baseline_avg: number
  timestamp: number; description: string; hot_score?: number; source?: string
}

interface GrowthPoint { time: string; count: number; total: number }

interface HNMention { title: string; points: number; comments: number; date: string; url: string }

interface ReleaseInfo { tag: string; name: string; published: string; body: string }

interface Insights {
  hn_mentions: HNMention[]
  releases: ReleaseInfo[]
  contributors: number
}

/* ===== Utils ===== */

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return sec + 's ago'
  const min = Math.floor(sec / 60)
  if (min < 60) return min + 'm ago'
  const hr = Math.floor(min / 60)
  if (hr < 24) return hr + 'h ago'
  return Math.floor(hr / 24) + 'd ago'
}

function dateFmt(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function velocity(b: { star_count: number; window_minutes: number }) {
  return b.star_count / b.window_minutes
}

/* ===== Main ===== */

export default function RepoDetail({ owner, name, navigate }: {
  owner: string; name: string; navigate: (p: string) => void
}) {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [bursts, setBursts] = useState<BurstEvent[]>([])
  const [growth, setGrowth] = useState<GrowthPoint[]>([])
  const [insights, setInsights] = useState<Insights | null>(null)
  const [eco, setEco] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [ghError, setGhError] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setGhError('')
      try {
        const [repoRes, burstRes, insRes, ecoRes] = await Promise.all([
          fetch(`/api/github/repo/${owner}/${name}`).then(r => r.json()),
          fetch(`/api/repo/${owner}/${name}/bursts`).then(r => r.json()),
          fetch(`/api/repo/${owner}/${name}/insights`).then(r => r.json().catch(() => null)),
          fetch(`/api/repo/${owner}/${name}/ecosystem`).then(r => r.json().catch(() => null)),
        ])
        if (repoRes.error) {
          setGhError(repoRes.error)
        } else {
          setRepo(repoRes)
        }
        setBursts(burstRes.bursts || [])
        setGrowth(burstRes.growth || [])
        setInsights(insRes || null)
        setEco(ecoRes || null)
      } catch (e: any) {
        setGhError(e.message)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [owner, name])

  if (loading) {
    return (
      <div className="repo-detail">
        <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-muted)' }}>
          <p>Loading repository data...</p>
        </div>
      </div>
    )
  }

  const fullName = `${owner}/${name}`
  const maxV = Math.max(...bursts.map(b => velocity(b)), 1)
  const maxBurst = Math.max(...bursts.map(b => b.star_count), 1)
  const totalLocalStars = growth.length > 0 ? growth[growth.length - 1].total : 0
  const hasLocalData = bursts.length > 0 || growth.length > 1

  const logScale = (val: number, max: number) => {
    if (val <= 0) return 0
    return Math.min(100, (Math.log10(val) / Math.log10(max)) * 100)
  }

  const radarData = repo ? [
    { axis: 'Stars', value: logScale(repo.stars, 500000), fullMark: 100 },
    { axis: 'Forks', value: logScale(repo.forks, 100000), fullMark: 100 },
    { axis: 'Issues', value: logScale(repo.open_issues, 5000), fullMark: 100 },
    { axis: 'Watchers', value: logScale(repo.subscribers, 10000), fullMark: 100 },
    { axis: 'Contributors', value: logScale(insights?.contributors || 1, 5000), fullMark: 100 },
  ] : [
    { axis: 'Bursts', value: logScale(bursts.length, 20), fullMark: 100 },
    { axis: 'Velocity', value: logScale(maxV, 30), fullMark: 100 },
    { axis: 'Events', value: logScale(totalLocalStars, 500), fullMark: 100 },
    { axis: 'Peak', value: logScale(maxBurst, 100), fullMark: 100 },
    { axis: 'Activity', value: 0, fullMark: 100 },
  ]

  return (
    <div className="repo-detail">
      {/* Back nav */}
      <div style={{ marginBottom: 20 }}>
        <button className="nav-tab" onClick={() => navigate('history')}
          style={{ fontSize: 13 }}>← Back</button>
      </div>

      {/* ================================================================ */}
      {/* Repo Header */}
      {/* ================================================================ */}
      <div className="rd-header">
        {repo ? (
          <>
            <img src={repo.owner_avatar} alt="" className="rd-avatar" />
            <div style={{ flex: 1 }}>
              <h1 className="rd-name">
                <a href={repo.html_url} target="_blank" rel="noopener">{repo.full_name}</a>
              </h1>
              {repo.description && <p className="rd-desc">{repo.description}</p>}
              <div className="rd-meta">
                <span className="rd-stat">★ {fmt(repo.stars)} stars</span>
                <span className="rd-stat">⑂ {fmt(repo.forks)} forks</span>
                <span className="rd-stat">● {fmt(repo.open_issues)} issues</span>
                <span className="rd-stat">👁 {fmt(repo.subscribers)} watchers</span>
                {insights?.contributors
                  ? <span className="rd-stat">👥 {fmt(insights.contributors)} contributors</span>
                  : null}
                {repo.language && repo.language !== 'N/A'
                  ? <span className="ranking-lang">{repo.language}</span>
                  : null}
              </div>
              <div className="rd-meta" style={{ marginTop: 6 }}>
                {repo.topics.slice(0, 10).map(t => (
                  <span key={t} className="ranking-topic">{t}</span>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1 }}>
            <h1 className="rd-name">
              <a href={`https://github.com/${fullName}`} target="_blank" rel="noopener">{fullName}</a>
            </h1>
            {ghError && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                GitHub metadata unavailable. Showing cached data.
              </p>
            )}
            <div className="rd-meta" style={{ marginTop: 8 }}>
              <span className="rd-stat">🌋 {bursts.length} bursts detected locally</span>
              {totalLocalStars > 0
                ? <span className="rd-stat">📊 {totalLocalStars} local events (24h)</span>
                : null}
            </div>
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* Two-column: Radar + Quick Stats */}
      {/* ================================================================ */}
      <div className="rd-charts">
        <div className="rd-chart-card">
          <h3 className="rd-chart-title">🎯 Repository Overview</h3>
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="68%">
              <PolarGrid stroke="#cccccc" strokeDasharray="6 4" />
              <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: '#555555' }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name={fullName} dataKey="value" stroke="#7c3aed"
                fill="#7c3aed" fillOpacity={0.12} strokeWidth={2.5} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Quick stats */}
        <div className="rd-chart-card">
          <h3 className="rd-chart-title">📊 Quick Stats</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {repo && [
              { label: 'Stars', value: fmt(repo.stars) },
              { label: 'Forks', value: fmt(repo.forks) },
              { label: 'Issues', value: fmt(repo.open_issues) },
              { label: 'Watchers', value: fmt(repo.subscribers) },
              { label: 'Contributors', value: fmt(insights?.contributors || 0) },
              { label: 'Language', value: repo.language || 'N/A' },
              { label: 'Bursts', value: String(bursts.length) },
              { label: 'Local Events', value: fmt(totalLocalStars) },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center', padding: '10px 8px',
                background: 'var(--bg-secondary)', borderRadius: 8 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-violet)' }}>{s.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* Ecosystem Health Score */}
      {/* Two-column: Releases + HN (only if data exists) */}
      {((insights?.releases?.length ?? 0) > 0 || (insights?.hn_mentions?.length ?? 0) > 0) && (
        <div className="rd-charts">
          {/* Recent Releases */}
          {insights?.releases?.length ? (
            <div className="rd-chart-card">
              <h3 className="rd-chart-title">📦 Recent Releases</h3>
              <div className="rd-insight-list">
                {insights.releases.map((r, i) => (
                  <div key={i} className="rd-insight-row">
                    <div className="rd-insight-head">
                      <a href={`https://github.com/${fullName}/releases/tag/${encodeURIComponent(r.tag)}`}
                        target="_blank" rel="noopener" className="rd-release-tag">
                        {r.tag}
                      </a>
                      <span className="rd-insight-date">{dateFmt(r.published)}</span>
                    </div>
                    {r.name !== r.tag && <p className="rd-insight-text">{r.name}</p>}
                    {r.body && <p className="rd-insight-text rd-insight-body">{r.body}</p>}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* HN Mentions */}
          {insights?.hn_mentions?.length ? (
            <div className="rd-chart-card">
              <h3 className="rd-chart-title">🔶 Hacker News Mentions</h3>
              <div className="rd-insight-list">
                {insights.hn_mentions.map((h, i) => (
                  <a key={i} href={h.url} target="_blank" rel="noopener"
                    className="rd-insight-row rd-insight-link">
                    <div className="rd-insight-head">
                      <span className="rd-hn-title">{h.title}</span>
                      <span className="rd-insight-date">{dateFmt(h.date)}</span>
                    </div>
                    <div className="rd-meta" style={{ gap: 10 }}>
                      <span className="rd-stat">▲ {h.points} pts</span>
                      <span className="rd-stat">💬 {h.comments} comments</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : (
            insights?.releases?.length ? (
              <div className="rd-chart-card">
                <h3 className="rd-chart-title">🔶 External Buzz</h3>
                <div className="rd-empty">
                  <p>HN mentions not found for this repo.</p>
                  <p style={{ fontSize: 12, marginTop: 4 }}>Monitoring HN, Reddit, and other channels.</p>
                </div>
              </div>
            ) : null
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* Local data section (only when available) */}
      {/* ================================================================ */}
      {hasLocalData && (
        <div className="rd-charts" style={{ marginTop: 16 }}>
          {/* 24h Growth */}
          <div className="rd-chart-card">
            <h3 className="rd-chart-title">📈 24h Star Activity (local monitoring)</h3>
            {growth.length > 1 ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={growth} margin={{ top: 4, left: 0, right: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rdGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#a3a3a3' }} tickLine={false}
                    axisLine={false} tickFormatter={(v: string) => v.split('T')[1] || v} />
                  <YAxis tick={{ fontSize: 10, fill: '#a3a3a3' }} axisLine={false}
                    tickLine={false} tickFormatter={fmt} />
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid rgba(0,0,0,0.1)',
                    borderRadius: 10 }} />
                  <Area type="monotone" dataKey="total" stroke="#7c3aed" strokeWidth={2}
                    fill="url(#rdGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="rd-empty"><p>No growth data yet.</p></div>
            )}
          </div>

          {/* Local Burst Timeline */}
          <div className="rd-chart-card">
            <h3 className="rd-chart-title">🌋 Burst Timeline (local)</h3>
            {bursts.length > 0 ? (
              <div className="rd-burst-scroll">
                {bursts.map(b => {
                  const v = velocity(b)
                  const barW = Math.round((b.star_count / maxBurst) * 100)
                  return (
                    <div key={b.id} className="rd-burst-row">
                      <span className="rd-burst-time">{timeAgo(b.timestamp)}</span>
                      <span className="rd-burst-stars">+{b.star_count}⭐</span>
                      <span className="rd-burst-vel">{v.toFixed(1)}/min</span>
                      <span className="rd-burst-window">{b.window_minutes}min</span>
                      {b.source && (
                        <span className="rd-burst-source" title={b.source}>{b.source}</span>
                      )}
                      <div className="rd-burst-bar-track">
                        <div className="rd-burst-bar-fill" style={{ width: barW + '%' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rd-empty"><p>No bursts detected for this repo.</p></div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* Attribution Signal Banner */}
      {/* ================================================================ */}
      {((insights?.hn_mentions?.length ?? 0) > 0 || (insights?.releases?.length ?? 0) > 0) && (
        <div className="rd-signal-banner">
          <span style={{ fontSize: 14, fontWeight: 600, color: '#0891b2' }}>
            🔍 Burst Attribution
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 8 }}>
            {(insights!.hn_mentions.length > 0 && insights!.hn_mentions[0].points >= 10)
              ? `HN front-page with ${insights!.hn_mentions[0].points} pts — likely drove star growth. `
              : (insights!.hn_mentions.length > 0
                ? `Found ${insights!.hn_mentions.length} HN mention(s). ` : '')}
            {insights!.releases.length > 0
              ? `Latest release: ${insights!.releases[0].tag} (${dateFmt(insights!.releases[0].published)}).`
              : ''}
          </span>
        </div>
      )}
    </div>
  )
}
