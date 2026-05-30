import { useState, useEffect, useRef } from 'react'
import Navbar from './Navbar'

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

const TABS = [
  { key: 'npm', label: '📦 npm', placeholder: 'react, vue, lodash...', unit: '/wk', defaultQ: '' },
  { key: 'docker', label: '🐳 Docker', placeholder: 'nginx, postgres...', unit: ' pulls', defaultQ: '' },
  { key: 'huggingface', label: '🤗 HF Models', placeholder: 'llama, mistral, gemma...', unit: ' dl', defaultQ: '' },
  { key: 'stackoverflow', label: '📚 Stack Overflow', placeholder: 'react hooks, rust async...', unit: ' votes', defaultQ: '' },
  { key: 'topics', label: '🏷️ Topics', placeholder: 'machine-learning, cli, web...', unit: ' ★', defaultQ: '' },
  { key: 'languages', label: '🔤 Languages', placeholder: 'GitHub+SO weighted ranking', unit: ' %', defaultQ: '' },
  { key: 'developers', label: '👤 Developers', placeholder: 'location:china, language:rust...', unit: ' followers', defaultQ: 'type:user+followers:>1000' },
] as const

type TabKey = typeof TABS[number]['key']

export default function RankingsPage({ navigate }: { navigate: (p: string) => void }) {
  const [tab, setTab] = useState<TabKey>('npm')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 10
  const fetchingRef = useRef(false)

  const doSearch = async (p?: number) => {
    if (fetchingRef.current) return
    fetchingRef.current = true; setLoading(true)
    try {
      const tabCfg = TABS.find(t => t.key === tab)!
      const q = query.trim() || tabCfg.defaultQ || tabCfg.placeholder.split(',')[0]
      const url = `/api/ecosystem/${tab}?q=${encodeURIComponent(q)}`
      const res = await fetch(url)
      const data = await res.json()
      setResults(Array.isArray(data) ? data : [])
    } catch { setResults([]) }
    setLoading(false); fetchingRef.current = false
  }

  useEffect(() => { doSearch(); setPage(0) }, [tab]) // eslint-disable-line

  const search = () => doSearch()

  useEffect(() => { doSearch() }, [tab]) // eslint-disable-line

  const activeTab = TABS.find(t => t.key === tab)!

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 32px 20px' }}>
      <Navbar active="rankings" navigate={navigate} />

      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Platform Rankings</h2>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Cross-platform popularity: packages, containers, AI models, and tech topics.</p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => { if (tab !== t.key) { setTab(t.key); setResults([]); setQuery(''); setPage(0) } }}
            className={`filter-chip ${tab === t.key ? 'active' : ''}`}
            style={{ fontSize: 13, padding: '7px 14px' }}>{t.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder={activeTab.placeholder}
          style={{ flex: 1, padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border)',
            background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit', outline: 'none' }} />
        <button onClick={() => doSearch()} disabled={loading}
          style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: 'var(--accent-violet)',
            color: '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer',
            opacity: loading ? 0.6 : 1, fontFamily: 'inherit' }}>{loading ? '...' : 'Search'}</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((pkg: any, i: number) => {
          const val = pkg.downloads || pkg.stars || pkg.share || 0
          const maxVal = results.length > 0 ? Math.max(...results.map((r: any) => r.downloads || r.stars || r.share || 0), 1) : 1
          const isDev = tab === 'developers'
          return (
            <a key={i} href={pkg.url} target="_blank" rel="noopener"
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
                borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                background: 'var(--bg-card)', textDecoration: 'none', color: 'inherit',
                cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
              className="eco-card">
              {isDev && pkg.avatar && <img src={pkg.avatar} alt="" style={{ width: 36, height: 36, borderRadius: '50%' }} />}
              {!isDev && <span style={{ width: 36, textAlign: 'center', fontSize: 14, fontWeight: 700,
                color: i < 3 ? 'var(--accent-violet)' : 'var(--text-muted)' }}>{i + 1}</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {pkg.name}
                  {pkg.version ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>v{pkg.version}</span> : null}
                  {pkg.stars > 0 ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>★ {fmt(pkg.stars)}</span> : null}
                  {pkg.language ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(124,58,237,0.08)', color: 'var(--accent-violet)' }}>{pkg.language}</span> : null}
                </div>
                {pkg.description && <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pkg.description}</p>}
                {tab === 'languages' && pkg.ghRepos > 0 && (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>GH: {fmt(pkg.ghRepos)} repos · SO: {fmt(pkg.soQuestions)} qs</p>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent-cyan)' }}>{val > 0 ? fmt(val) : '...'}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{activeTab.unit}</div>
              </div>
              <div style={{ position: 'absolute', bottom: 0, left: 0, height: 2,
                background: 'linear-gradient(to right, var(--accent-violet), var(--accent-cyan))',
                borderRadius: '0 2px 0 0', width: `${Math.round((val / maxVal) * 100)}%` }} />
            </a>
          )
        })}
      </div>

      {results.length > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="page-btn">← Prev</button>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 12px' }}>
            {page + 1}/{Math.ceil(results.length / PAGE_SIZE)}
          </span>
          <button onClick={() => setPage(p => Math.min(Math.floor((results.length - 1) / PAGE_SIZE), p + 1))}
            disabled={(page + 1) * PAGE_SIZE >= results.length}
            className="page-btn">Next →</button>
        </div>
      )}
    </div>
  )
}
