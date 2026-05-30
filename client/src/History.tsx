import { useState, useEffect, useCallback, useRef } from 'react'
import './History.css'
import Navbar from './Navbar'

interface GitHubRepo {
  rank: number
  full_name: string
  html_url: string
  description: string
  stars: number
  forks: number
  language: string
  topics: string[]
  owner_avatar: string
  growth?: number
}

interface RankingResult {
  repos: GitHubRepo[]
  total: number
}

/* ===== Utils ===== */

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

const LANGS = [
  { k: '', label: 'All' },
  { k: 'JavaScript', label: 'JavaScript' },
  { k: 'TypeScript', label: 'TypeScript' },
  { k: 'Python', label: 'Python' },
  { k: 'Java', label: 'Java' },
  { k: 'Go', label: 'Go' },
  { k: 'Rust', label: 'Rust' },
  { k: 'C++', label: 'C++' },
  { k: 'C', label: 'C' },
  { k: 'C#', label: 'C#' },
  { k: 'Ruby', label: 'Ruby' },
  { k: 'Swift', label: 'Swift' },
  { k: 'Kotlin', label: 'Kotlin' },
  { k: 'PHP', label: 'PHP' },
  { k: 'R', label: 'R' },
  { k: 'Dart', label: 'Dart' },
  { k: 'Scala', label: 'Scala' },
  { k: 'Elixir', label: 'Elixir' },
  { k: 'Clojure', label: 'Clojure' },
  { k: 'Haskell', label: 'Haskell' },
  { k: 'Lua', label: 'Lua' },
  { k: 'Zig', label: 'Zig' },
  { k: 'Julia', label: 'Julia' },
  { k: 'Erlang', label: 'Erlang' },
  { k: 'OCaml', label: 'OCaml' },
  { k: 'Groovy', label: 'Groovy' },
  { k: 'Objective-C', label: 'Objective-C' },
  { k: 'Perl', label: 'Perl' },
  { k: 'MATLAB', label: 'MATLAB' },
  { k: 'Shell', label: 'Shell' },
  { k: 'PowerShell', label: 'PowerShell' },
  { k: 'Vue', label: 'Vue' },
  { k: 'Svelte', label: 'Svelte' },
  { k: 'Astro', label: 'Astro' },
  { k: 'Solidity', label: 'Solidity' },
  { k: 'Nim', label: 'Nim' },
  { k: 'Crystal', label: 'Crystal' },
  { k: 'F#', label: 'F#' },
  { k: 'Assembly', label: 'Assembly' },
  { k: 'Vim Script', label: 'Vim Script' },
  { k: 'Emacs Lisp', label: 'Emacs Lisp' },
  { k: 'Nix', label: 'Nix' },
  { k: 'Dockerfile', label: 'Dockerfile' },
]

const TOPICS = [
  { k: '', label: 'All Topics' },
  { k: 'react', label: 'React' },
  { k: 'vue', label: 'Vue' },
  { k: 'machine-learning', label: 'ML/AI' },
  { k: 'llm', label: 'LLM' },
  { k: 'chatgpt', label: 'ChatGPT' },
  { k: 'langchain', label: 'LangChain' },
  { k: 'ai-agent', label: 'AI Agent' },
  { k: 'rag', label: 'RAG' },
  { k: 'anthropic', label: 'Anthropic' },
  { k: 'openai', label: 'OpenAI' },
  { k: 'claude-code', label: 'Claude Code' },
  { k: 'copilot', label: 'Copilot' },
  { k: 'gpt', label: 'GPT' },
  { k: 'deepseek', label: 'DeepSeek' },
  { k: 'transformer', label: 'Transformer' },
  { k: 'stable-diffusion', label: 'Stable Diffusion' },
  { k: 'cli', label: 'CLI' },
  { k: 'api', label: 'API' },
  { k: 'web', label: 'Web' },
  { k: 'database', label: 'Database' },
  { k: 'devops', label: 'DevOps' },
  { k: 'security', label: 'Security' },
  { k: 'skills', label: 'Skills' },
  { k: 'game', label: 'Game' },
  { k: 'ios', label: 'iOS' },
  { k: 'android', label: 'Android' },
]
const PAGE_SIZE = 30

function RankNum({ rank }: { rank: number }) {
  if (rank === 1) return <span className="rank-num gold">#1</span>
  if (rank === 2) return <span className="rank-num silver">#2</span>
  if (rank === 3) return <span className="rank-num bronze">#3</span>
  return <span className="rank-num muted">#{rank}</span>
}

/* ===== Main ===== */

export default function HistoryPage({ navigate }: { navigate: (p: string) => void }) {
  const [ranking, setRanking] = useState<RankingResult | null>(null)
  const [lang, setLang] = useState('')
  const [topic, setTopic] = useState('')
  const [period, setPeriod] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const totalPages = ranking ? Math.min(Math.ceil(ranking.total / PAGE_SIZE), 1000 / PAGE_SIZE) : 1

  const fetchRanking = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Use growth API for month/week/today: real star data from local events table
      if (period === 'month' || period === 'week' || period === 'today') {
        const hours = period === 'month' ? 720 : period === 'week' ? 168 : 24
        const res = await fetch(`/api/github/growth?hours=${hours}&limit=${PAGE_SIZE}`)
        if (!res.ok) throw new Error('Failed to fetch growth data')
        const data = await res.json()
        setRanking({ repos: data || [], total: (data || []).length })
        setLoading(false)
        return
      }
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page) })
      if (lang) params.set('lang', lang)
      if (topic) params.set('topic', topic)
      if (period) params.set('period', period)
      const res = await fetch(`/api/github/ranking?${params}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || err.error || 'Failed to fetch')
      }
      const json = await res.json()
      setRanking(json)
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }, [lang, period, topic, page])

  useEffect(() => { fetchRanking() }, [fetchRanking])

  useEffect(() => { setPage(1) }, [lang, period, topic])

  return (
    <div className="history-page">
      {/* Top bar */}
      <Navbar active="history" navigate={navigate} />

      {/* Title */}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          GitHub Star Ranking
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          Top {ranking?.total ? fmt(ranking.total) : '...'} repositories
          {period === 'today' ? ' · stars gained today' : period === 'week' ? ' · stars gained this week' : period === 'month' ? ' · stars gained this month' : ' · by total stars'}
          {topic ? ` · topic: ${topic}` : lang ? ` · ${lang}` : ''}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {[
            { k: '', label: 'All Time' },
            { k: 'month', label: 'This Month' },
            { k: 'week', label: 'This Week' },
            { k: 'today', label: 'Today' },
          ].map(t => (
            <button key={t.k} className={`filter-chip ${period === t.k ? 'active' : ''}`}
              onClick={() => setPeriod(t.k)}>{t.label}</button>
          ))}
        </div>
        {/* Language tabs */}
        <div className="lang-tabs">
          {LANGS.map(l => (
            <button key={l.k} className={`lang-tab ${lang === l.k && !topic ? 'active' : ''}`}
              onClick={() => { setLang(l.k); setTopic('') }}>{l.label}</button>
          ))}
        </div>
        {/* Topic tabs */}
        <div className="lang-tabs">
          {TOPICS.map(t => (
            <button key={t.k} className={`lang-tab ${topic === t.k ? 'active' : ''}`}
              onClick={() => { setTopic(t.k); if (t.k) setLang('') }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
          padding: '14px 18px', marginBottom: 16, fontSize: 13, color: '#991b1b'
        }}>
          {error}. Make sure GITHUB_TOKEN is set in .env.
        </div>
      )}

      {/* Loading */}
      {loading && !ranking && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔄</div>
          <p>Fetching GitHub ranking...</p>
        </div>
      )}

      {/* Ranking cards */}
      <div className="ranking-list">
        {ranking?.repos.map(repo => (
          <div key={repo.full_name} className="ranking-card"
            onClick={() => navigate(`#/repo/${repo.full_name}`)}>
            {/* Avatar */}
            <img src={repo.owner_avatar} alt="" className="ranking-avatar"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            {/* Rank */}
            <div className="ranking-rank"><RankNum rank={repo.rank} /></div>
            {/* Body */}
            <div className="ranking-body">
              <div className="ranking-header">
                <a href={repo.html_url} target="_blank" rel="noopener"
                  className="ranking-name" onClick={e => e.stopPropagation()}>
                  {repo.full_name}
                </a>
                {period ? (
                  <span className="ranking-stars" style={{ color: 'var(--accent-green)' }}>+{fmt(repo.growth || 0)}</span>
                ) : (
                  <span className="ranking-stars">★ {repo.stars >= 0 ? fmt(repo.stars) : '—'}</span>
                )}
              </div>
              {repo.description && (
                <p className="ranking-desc">{repo.description}</p>
              )}
              <div className="ranking-meta">
                {repo.language && repo.language !== 'N/A' && (
                  <span className="ranking-lang">{repo.language}</span>
                )}
                {period && repo.stars >= 0 && <span className="ranking-forks">★ {fmt(repo.stars)} total</span>}
                <span className="ranking-forks">{repo.forks > 0 ? fmt(repo.forks) + ' forks' : ''}</span>
                {repo.topics.slice(0, 4).map(t => (
                  <span key={t} className="ranking-topic">{t}</span>
                ))}
              </div>
            </div>
            {/* Star bar */}
            <div className="ranking-bar-wrap">
              <div className="ranking-bar-fill" style={{
                width: ranking.repos.length > 0
                  ? Math.round((repo.stars / ranking.repos[0].stars) * 100) + '%'
                  : '0%'
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {ranking && totalPages > 1 && (
        <div className="pagination">
          <button className="page-btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
            ← Prev
          </button>
          <div className="page-info">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let p: number
              if (totalPages <= 7) {
                p = i + 1
              } else if (page <= 4) {
                p = i + 1
              } else if (page >= totalPages - 3) {
                p = totalPages - 6 + i
              } else {
                p = page - 3 + i
              }
              return (
                <button key={p} className={`page-num ${p === page ? 'active' : ''}`}
                  onClick={() => setPage(p)}>{p}</button>
              )
            })}
          </div>
          <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
            Next →
          </button>
        </div>
      )}

      {/* Footer info */}
      {ranking && (
        <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, ranking.total)} of {fmt(ranking.total)} repos · Data from GitHub Search API
        </div>
      )}
    </div>
  )
}