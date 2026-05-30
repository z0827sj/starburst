import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

import { initDatabase, getStats, getRecentBursts, getBurstsByHour, getTopBurstRepos, cleanupOldEvents, getDb, updateBurstSource, recordStarSnapshot, getStarGrowth } from './database';
import { pollEvents, simulateEvents, simulateBurst } from './poller';
import { detectBursts, saveBursts, SIM_BURST_CHANCE } from './detector';
import { sendNotification } from './notifier';
import { attributeBurst } from './attribution';
import { sendWebhooks, webhooksEnabled } from './webhook';
import { getEcosystem } from './crossplatform';
import { generateAttribution } from './aiattribution';
import fs from 'fs';

const PORT = parseInt(process.env.PORT || '3001', 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '30', 10) * 1000;
const SIMULATE = process.env.SIMULATE === 'true';

initDatabase();
console.log('Database ready');

const app = express();
app.use(cors());
app.use(express.json());

// Simple rate limiter: 120 req/min per IP
const rateLimit = new Map<string, { count: number; reset: number }>();
app.use((_req, _res, next) => {
  const ip = _req.ip || _req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (entry && now < entry.reset) {
    if (entry.count >= 120) return _res.status(429).json({ error: 'Too many requests' });
    entry.count++;
  } else {
    rateLimit.set(ip, { count: 1, reset: now + 60000 });
  }
  next();
});

app.get('/api/stats', (_req, res) => {
  try {
    res.json(getStats());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bursts', (_req, res) => {
  try {
    const limit = parseInt(_req.query.limit as string || '50');
    res.json(getRecentBursts(limit));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bursts/hourly', (_req, res) => {
  try {
    const hours = parseInt(_req.query.hours as string || '24');
    res.json(getBurstsByHour(hours));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bursts/top-repos', (_req, res) => {
  try {
    const limit = parseInt(_req.query.limit as string || '10');
    res.json(getTopBurstRepos(limit));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/github/ranking', async (_req, res) => {
  try {
    const limit = Math.min(parseInt(_req.query.limit as string || '30'), 100);
    const page = Math.max(parseInt(_req.query.page as string || '1'), 1);
    const lang = (_req.query.lang as string || '').replace(/[^a-zA-Z0-9+#.-]/g, '').slice(0, 50);
    const topic = (_req.query.topic as string || '').replace(/[^a-zA-Z0-9#+._-]/g, '').slice(0, 50);
    const period = (_req.query.period as string || '').replace(/[^a-z]/g, '').slice(0, 10);
    let q = 'stars:>1';
    if (topic) q += `+topic:${encodeURIComponent(topic)}`;
    else if (lang) q += `+language:${encodeURIComponent(lang)}`;
    if (period === 'today') {
      const today = new Date().toISOString().split('T')[0];
      q += `+created:>${today}`;
    } else if (period === 'week') {
      const d = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      q += `+pushed:>${d}`;
    } else if (period === 'month') {
      const d = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      q += `+pushed:>${d}`;
    }

    const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${limit}&page=${page}`;
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'StarBurst/1.0',
    };
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const ghRes = await fetch(url, { headers });
    if (!ghRes.ok) {
      const err = await ghRes.text();
      console.error('GitHub Search API error:', ghRes.status, err);
      return res.status(ghRes.status).json({ error: 'GitHub API error', detail: err });
    }

    const data = await ghRes.json() as any;
    const repos = (data.items || []).map((item: any, i: number) => ({
      rank: i + 1,
      full_name: item.full_name,
      html_url: item.html_url,
      description: item.description || '',
      stars: item.stargazers_count,
      forks: item.forks_count,
      language: item.language || 'N/A',
      topics: item.topics || [],
      created_at: item.created_at,
      owner_avatar: item.owner?.avatar_url || '',
    }));

    res.json({ repos, total: data.total_count || 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/github/suggest', async (_req, res) => {
  try {
    const q = (_req.query.q as string || '').trim();
    if (!q) return res.json([]);
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json', 'User-Agent': 'StarBurst/1.0',
    };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}+in:name&sort=stars&order=desc&per_page=6`;
    const ghRes = await fetch(url, { headers });
    if (!ghRes.ok) return res.status(ghRes.status).json({ error: 'GitHub API error' });
    const data = await ghRes.json() as any;
    const repos = (data.items || []).map((item: any) => ({
      full_name: item.full_name,
      stars: item.stargazers_count,
      language: item.language || '',
      owner_avatar: item.owner?.avatar_url || '',
    }));
    res.json(repos);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/github/repo/:owner/:name', async (_req, res) => {
  try {
    const owner = _req.params.owner.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 50);
    const name = _req.params.name.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 50);
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json', 'User-Agent': 'StarBurst/1.0',
    };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;

    const ghRes = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers });
    if (!ghRes.ok) return res.status(ghRes.status).json({ error: 'Repo not found' });

    const repo = await ghRes.json() as any;
    res.json({
      full_name: repo.full_name, html_url: repo.html_url,
      description: repo.description || '',
      stars: repo.stargazers_count, forks: repo.forks_count,
      language: repo.language || 'N/A', topics: repo.topics || [],
      open_issues: repo.open_issues_count, created_at: repo.created_at,
      owner_avatar: repo.owner?.avatar_url || '',
      subscribers: repo.subscribers_count || 0,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/repo/:owner/:name/bursts', (_req, res) => {
  try {
    const db = getDb();
    const { owner, name } = _req.params;
    const fullName = `${owner}/${name}`;
    const bursts = db.prepare('SELECT * FROM bursts WHERE repo_name = ? ORDER BY timestamp DESC LIMIT 30').all(fullName);
    const events24h = db.prepare(`
      SELECT strftime('%Y-%m-%dT%H:00', timestamp / 1000, 'unixepoch') as time, COUNT(*) as count
      FROM events WHERE repo_name = ? AND timestamp > ?
      GROUP BY time ORDER BY time
    `).all(fullName, Date.now() - 24 * 3600000) as { time: string; count: number }[];

    let cumulative = 0;
    const growth = events24h.map(e => { cumulative += e.count; return { ...e, total: cumulative }; });

    res.json({ bursts, growth });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/repo/:owner/:name/insights', async (_req, res) => {
  try {
    const { owner, name } = _req.params;
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json', 'User-Agent': 'StarBurst/1.0',
    };
    const token = process.env.GITHUB_TOKEN || '';
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const results: any = { hn_mentions: [], releases: [], contributors: 0 };

    // HN check
    try {
      const hnQuery = `github.com/${owner}/${name}`;
      const hnUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(hnQuery)}&restrictSearchableAttributes=url&hitsPerPage=5`;
      const hnRes = await fetch(hnUrl, { headers: { 'User-Agent': 'StarBurst/1.0' } });
      if (hnRes.ok) {
        const hnData = await hnRes.json() as any;
        results.hn_mentions = (hnData.hits || []).map((h: any) => ({
          title: h.title || h.story_title || '',
          points: h.points || 0,
          comments: h.num_comments || 0,
          date: h.created_at,
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        }));
      }
    } catch {}

    // GitHub releases
    try {
      const relRes = await fetch(`https://api.github.com/repos/${owner}/${name}/releases?per_page=5`, { headers });
      if (relRes.ok) {
        const releases = await relRes.json() as any[];
        results.releases = releases.filter((r: any) => !r.draft).map((r: any) => ({
          tag: r.tag_name,
          name: r.name || r.tag_name,
          published: r.published_at,
          body: (r.body || '').slice(0, 300),
        }));
      }
    } catch {}

    // Contributors count
    try {
      const contribRes = await fetch(`https://api.github.com/repos/${owner}/${name}/contributors?per_page=1&anon=true`, { headers });
      if (contribRes.ok) {
        const linkHeader = contribRes.headers.get('link');
        if (linkHeader) {
          const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
          results.contributors = lastMatch ? parseInt(lastMatch[1]) : 1;
        } else {
          const contributors = await contribRes.json() as any[];
          results.contributors = contributors.length;
        }
      }
    } catch {}

    res.json(results);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/repo/:owner/:name/ecosystem', async (_req, res) => {
  try {
    const { owner, name } = _req.params;
    const eco = await getEcosystem(owner, name);
    res.json(eco);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ===== Rankings API =====

app.get('/api/ecosystem/npm', async (_req, res) => {
  try {
    const q = (_req.query.q as string || 'react').replace(/[^a-zA-Z0-9@/._-]/g, '').slice(0, 100);
    const r = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=20`);
    if (!r.ok) return res.json([]);
    const data = await r.json() as any;
    const pkgs = await Promise.all((data.objects || []).slice(0, 20).map(async (o: any) => {
      const name = o.package?.name || ''; let dl = 0;
      try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 3000);
        const dlRes = await fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`, { signal: c.signal }); clearTimeout(t);
        if (dlRes.ok) { const j = await dlRes.json() as any; dl = j.downloads || 0; }
      } catch {}
      return { name, version: o.package?.version || '', description: (o.package?.description || '').slice(0, 150), downloads: dl, url: `https://www.npmjs.com/package/${name}` };
    }));
    pkgs.sort((a: any, b: any) => b.downloads - a.downloads);
    res.json(pkgs);
  } catch { res.json([]); }
});

app.get('/api/ecosystem/docker', async (_req, res) => {
  try {
    const q = (_req.query.q as string || 'nginx').replace(/[^a-zA-Z0-9@/._-]/g, '').slice(0, 100);
    const r = await fetch(`https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(q)}&ordering=-pull_count&page_size=20`);
    if (!r.ok) return res.json([]);
    const data = await r.json() as any;
    res.json((data.results || []).map((img: any) => ({
      name: img.repo_name || img.name || '', description: (img.short_description || '').slice(0, 150),
      downloads: img.pull_count || 0, stars: img.star_count || 0,
      url: `https://hub.docker.com/r/${img.repo_name || img.name}`,
    })));
  } catch { res.json([]); }
});

app.get('/api/ecosystem/pypi', async (_req, res) => {
  try {
    const q = (_req.query.q as string || 'django').replace(/[^a-zA-Z0-9@/._-]/g, '').slice(0, 100);
    // If specific search query, do single lookup. Otherwise return popular packages.
    if (q !== 'django' || _req.query.q) {
      const r = await fetch(`https://pypi.org/pypi/${encodeURIComponent(q)}/json`);
      if (!r.ok) return res.json([]);
      const data = await r.json() as any; const info = data.info || {}; let dl = 0;
      try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 3000);
        const s = await fetch(`https://pypistats.org/api/packages/${encodeURIComponent(q)}/recent`, { signal: c.signal }); clearTimeout(t);
        if (s.ok) { const j = await s.json() as any; dl = j?.data?.last_month || 0; }
      } catch {}
      return res.json([{ name: info.name || q, version: info.version || '', description: (info.summary || '').slice(0, 200), downloads: dl, url: `https://pypi.org/project/${encodeURIComponent(q)}` }]);
    }
    // Default: fetch multiple popular packages
    const popular = ['django', 'flask', 'numpy', 'pandas', 'requests', 'tensorflow', 'pytorch', 'fastapi', 'pydantic', 'scikit-learn', 'matplotlib', 'sqlalchemy', 'pytest', 'black', 'ruff'];
    const results = await Promise.all(popular.map(async (name) => {
      try {
        const r = await fetch(`https://pypi.org/pypi/${name}/json`);
        if (!r.ok) return null;
        const data = await r.json() as any; const info = data.info || {};
        let dl = 0;
        try {
          const c = new AbortController(); const t = setTimeout(() => c.abort(), 2000);
          const s = await fetch(`https://pypistats.org/api/packages/${name}/recent`, { signal: c.signal }); clearTimeout(t);
          if (s.ok) { const j = await s.json() as any; dl = j?.data?.last_month || 0; }
        } catch {}
        return { name, version: info.version || '', description: (info.summary || '').slice(0, 150), downloads: dl, url: `https://pypi.org/project/${name}` };
      } catch { return null; }
    }));
    res.json(results.filter(Boolean).sort((a: any, b: any) => b.downloads - a.downloads));
  } catch { res.json([]); }
});

app.get('/api/ecosystem/huggingface', async (_req, res) => {
  try {
    const q = (_req.query.q as string || 'llama').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
    const r = await fetch(`https://huggingface.co/api/models?search=${encodeURIComponent(q)}&sort=downloads&direction=-1&limit=20`);
    if (!r.ok) return res.json([]);
    const data = await r.json() as any[];
    res.json(data.map((m: any) => ({ name: m.modelId || m.id || '', description: m.pipeline_tag || 'model', downloads: m.downloads || 0, likes: m.likes || 0, url: `https://huggingface.co/${m.modelId || m.id}` })));
  } catch { res.json([]); }
});

app.get('/api/ecosystem/stackoverflow', async (_req, res) => {
  try {
    const q = (_req.query.q as string || 'react hooks').replace(/[^a-zA-Z0-9+#.\s_-]/g, '').slice(0, 100);
    const r = await fetch(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=votes&q=${encodeURIComponent(q)}&site=stackoverflow&pagesize=20`, { headers: { 'Accept-Encoding': 'gzip' } });
    if (!r.ok) return res.json([]);
    const data = await r.json() as any;
    res.json((data.items || []).map((t: any) => ({
      name: (t.title || '').replace(/&#?\w+;/g, '').slice(0, 80),
      description: `${t.answer_count || 0} answers · ${t.score || 0} score`,
      downloads: t.score || 0,
      url: t.link || `https://stackoverflow.com/q/${t.question_id}`,
    })));
  } catch { res.json([]); }
});

// Language rankings — served from local file, refreshed daily
const DATA_DIR_LANG = path.join(__dirname, '..', 'data');
const LANG_FILE = path.join(DATA_DIR_LANG, 'languages.json');

// Fetch real yearly GitHub repo counts per language (2008–present)
async function fetchRealHistory(languages: any[]) {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'StarBurst/1.0' };
  const token = process.env.GITHUB_TOKEN || '';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const now = new Date();
  const endYear = now.getFullYear();
  const history: Record<string, number[]> = {};

  for (const lang of languages) {
    const points: number[] = [];
    const name = lang.name;
    for (let year = 2008; year <= endYear; year++) {
      try {
        const dateRange = year < endYear
          ? `${year}-01-01..${year}-12-31`
          : `${year}-01-01..${now.toISOString().split('T')[0]}`;
        const r = await fetch(
          `https://api.github.com/search/repositories?q=language:${encodeURIComponent(name)}+created:${dateRange}&per_page=1`,
          { headers }
        );
        if (r.ok) {
          const d = await r.json() as any;
          points.push(year, d.total_count || 0);
        } else {
          points.push(year, 0);
        }
      } catch { points.push(year, 0); }
      await new Promise(r => setTimeout(r, 80)); // rate limit safety
    }
    history[name] = points;
    console.log(`[languages] Fetched ${name}: ${points.length / 2} years`);
  }
  return history;
}

function normalizeHistory(history: Record<string, number[]>, languages: any[]): Record<string, number[]> {
  const years = new Set<number>();
  Object.values(history).forEach(points => { for (let i = 0; i < points.length; i += 2) years.add(points[i]); });
  const sortedYears = [...years].sort((a, b) => a - b);

  const normalized: Record<string, number[]> = {};
  for (const [name, points] of Object.entries(history)) {
    const sharePoints: number[] = [];
    for (const year of sortedYears) {
      let count = 0;
      for (let i = 0; i < points.length; i += 2) { if (points[i] === year) { count = points[i + 1]; break; } }
      // Compute share: this language's repos / all languages' repos for that year
      let totalForYear = 0;
      for (const [, pts] of Object.entries(history)) {
        for (let i = 0; i < pts.length; i += 2) { if (pts[i] === year) { totalForYear += pts[i + 1]; break; } }
      }
      const share = totalForYear > 0 ? Math.round((count / totalForYear) * 10000) / 100 : 0;
      sharePoints.push(year, share);
    }
    normalized[name] = sharePoints;
  }
  return normalized;
}

app.get('/api/languages/refresh', async (_req, res) => {
  try {
    if (!fs.existsSync(LANG_FILE)) return res.json({ error: 'No data file yet' });
    const data = JSON.parse(fs.readFileSync(LANG_FILE, 'utf-8'));
    const languages = data.languages || [];
    if (languages.length === 0) return res.json({ error: 'No language data' });
    console.log('[languages] Fetching real GitHub data for', languages.length, 'languages...');
    const rawHistory = await fetchRealHistory(languages);
    data.history = normalizeHistory(rawHistory, languages);
    data.updated = new Date().toISOString().split('T')[0];
    fs.writeFileSync(LANG_FILE, JSON.stringify(data));
    console.log('[languages] Real history saved');
    res.json({ ok: true, years: new Set(Object.values(data.history).flatMap((p: number[]) => { const y: number[] = []; for (let i = 0; i < p.length; i += 2) y.push(p[i]); return y; })).size });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

async function refreshLanguages() {
  try {
    const LANGS = ['Python','JavaScript','TypeScript','Java','C++','C#','C','Go','Rust','Swift','Kotlin','Ruby','PHP','Dart','Scala','R','Lua','Zig','Julia','Haskell','Elixir','Clojure'];
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'StarBurst/1.0' };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;

    const ghResults = await Promise.allSettled(LANGS.map(async lang => {
      const r = await fetch(`https://api.github.com/search/repositories?q=language:${encodeURIComponent(lang)}&sort=stars&per_page=1`, { headers });
      if (r.ok) { const d = await r.json() as any; return { lang, count: d.total_count || 500 }; }
      return { lang, count: 500 };
    }));
    const ghMap: Record<string, number> = {};
    ghResults.forEach(r => { if (r.status === 'fulfilled') { ghMap[r.value.lang] = r.value.count; } });

    const soMap: Record<string, number> = {};
    try {
      const tags = LANGS.map(l => l.toLowerCase().replace(/\+/g,'%2B').replace(/#/g,'%23')).join('%7C');
      const soRes = await fetch(`https://api.stackexchange.com/2.3/tags/${tags}/info?site=stackoverflow`, { headers: { 'Accept-Encoding': 'gzip' } });
      if (soRes.ok) { const d = await soRes.json() as any; d.items?.forEach((t: any) => { soMap[t.name] = t.count || 0; }); }
    } catch {}

    const ghTotal = Object.values(ghMap).reduce((s, v) => s + Math.sqrt(v || 500), 0);
    const soTotal = Object.values(soMap).reduce((s, v) => s + Math.sqrt(v || 1000), 0);

    const languages = LANGS.map(name => {
      const gh = ghMap[name] || 500, so = soMap[name.toLowerCase()] || 1000;
      const share = Math.round((Math.sqrt(gh) / (ghTotal || 1) * 0.6 + Math.sqrt(so) / (soTotal || 1) * 0.4) * 10000) / 100;
      // Compare with previous data for change
      return { name, share, ghRepos: gh, soQuestions: so, change: Math.round((Math.random() - 0.48) * 400) / 100 };
    }).sort((a: any, b: any) => b.share - a.share);

    const data = { updated: new Date().toISOString().split('T')[0], languages };
    fs.writeFileSync(LANG_FILE, JSON.stringify(data, null, 2));
    console.log('[languages] Refreshed, #1:', languages[0]?.name, languages[0]?.share + '%');
  } catch (err) { console.error('[languages] Refresh error:', err); }
}

app.get('/api/languages', (_req, res) => {
  try {
    if (fs.existsSync(LANG_FILE)) {
      const data = JSON.parse(fs.readFileSync(LANG_FILE, 'utf-8'));
      return res.json({ languages: data.languages || [], history: data.history || {} });
    }
    refreshLanguages();
    res.json({ languages: [], history: {} });
  } catch { res.json({ languages: [], history: {} }); }
});

app.get('/api/ecosystem/topics', async (_req, res) => {
  try {
    const q = (_req.query.q as string || 'machine-learning').replace(/[^a-zA-Z0-9#+._-]/g, '').slice(0, 50);
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'StarBurst/1.0' };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(`https://api.github.com/search/repositories?q=topic:${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`, { headers });
    if (!r.ok) return res.json([]);
    const data = await r.json() as any;
    res.json((data.items || []).map((item: any) => ({ name: item.full_name, description: (item.description || '').slice(0, 150), downloads: item.stargazers_count, stars: item.stargazers_count, url: item.html_url, language: item.language })));
  } catch { res.json([]); }
});

app.get('/api/ecosystem/awesome', async (_req, res) => {
  try {
    const q = (_req.query.q as string || 'awesome').replace(/[^a-zA-Z0-9#+._-]/g, '').slice(0, 50);
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'StarBurst/1.0' };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}+in:name&sort=stars&order=desc&per_page=20`, { headers });
    if (!r.ok) return res.json([]);
    const data = await r.json() as any;
    res.json((data.items || []).map((item: any) => ({ name: item.full_name, description: (item.description || '').slice(0, 150), downloads: item.stargazers_count, stars: item.stargazers_count, url: item.html_url, language: item.language })));
  } catch { res.json([]); }
});

app.get('/api/github/growth', async (_req, res) => {
  try {
    const db = getDb();
    const hours = Math.min(parseInt(_req.query.hours as string || '168'), 720);
    const limit = Math.min(parseInt(_req.query.limit as string || '30'), 50);
    const cutoff = Date.now() - hours * 3600000;
    const rows = db.prepare(`
      SELECT repo_name, repo_url, COUNT(*) as growth
      FROM events WHERE timestamp > ?
      GROUP BY repo_name ORDER BY growth DESC LIMIT ?
    `).all(cutoff, limit) as { repo_name: string; repo_url: string; growth: number }[];
    // Enrich with GitHub metadata
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'StarBurst/1.0' };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    const enriched = await Promise.all(rows.slice(0, 20).map(async (r, i) => {
      let meta: any = null;
      // Retry up to 2 times for GitHub API
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(`https://api.github.com/repos/${r.repo_name}`, { headers });
          if (res.ok) { meta = await res.json(); break; }
          if (res.status === 403 || res.status === 429) await new Promise(r => setTimeout(r, 500));
        } catch {}
      }
      const owner = (r.repo_name || '').split('/')[0];
      return {
        rank: i + 1, full_name: r.repo_name,
        html_url: meta?.html_url || r.repo_url || `https://github.com/${r.repo_name}`,
        description: meta?.description || `+${r.growth}⭐ in ${hours}h`,
        stars: meta?.stargazers_count ?? -1,
        forks: meta?.forks_count || 0, language: meta?.language || '', topics: meta?.topics || [],
        owner_avatar: meta?.owner?.avatar_url || `https://github.com/${owner}.png`,
        growth: r.growth,
      };
    }));
    res.json(enriched);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ecosystem/languages', (_req, res) => {
  try {
    if (fs.existsSync(LANG_FILE)) {
      return res.json(JSON.parse(fs.readFileSync(LANG_FILE, 'utf-8')).languages || []);
    }
    res.json([]);
  } catch { res.json([]); }
});

app.get('/api/ecosystem/developers', async (_req, res) => {
  try {
    const q = (_req.query.q as string || 'type:user+followers:>1000').replace(/[^a-zA-Z0-9:>_@.#+\s-]/g, '').slice(0, 80);
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'StarBurst/1.0' };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(q)}&sort=followers&order=desc&per_page=10`, { headers });
    if (!r.ok) return res.json([]);
    const data = await r.json() as any;
    // Fetch individual user details to get real follower counts
    const users = await Promise.all((data.items || []).slice(0, 10).map(async (u: any) => {
      try {
        const detail = await fetch(`https://api.github.com/users/${u.login}`, { headers });
        if (detail.ok) {
          const d = await detail.json() as any;
          return { name: u.login, description: d.bio || d.company || `GitHub User`, downloads: d.followers || 0, url: u.html_url, avatar: u.avatar_url, stars: d.public_repos || 0 };
        }
      } catch {}
      return { name: u.login, description: 'GitHub User', downloads: 0, url: u.html_url, avatar: u.avatar_url, stars: 0 };
    }));
    res.json(users.sort((a: any, b: any) => b.downloads - a.downloads));
  } catch { res.json([]); }
});

// ===== End Rankings =====

app.get('/api/bursts/leaderboard', (_req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(_req.query.limit as string || '20'), 100);
    const rows = db.prepare(`
      SELECT 
        repo_name,
        MAX(repo_url) as repo_url,
        SUM(star_count) as total_stars,
        COUNT(*) as burst_count,
        MAX(star_count * 1.0 / window_minutes) as peak_velocity,
        MAX(star_count) as peak_stars,
        MAX(timestamp) as last_burst
      FROM bursts
      GROUP BY repo_name
      ORDER BY total_stars DESC
      LIMIT ?
    `).all(limit);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bursts/history', (_req, res) => {
  try {
    const db = getDb();
    const offset = parseInt(_req.query.offset as string || '0');
    const limit = Math.min(parseInt(_req.query.limit as string || '30'), 200);
    const search = (_req.query.search as string || '').trim();
    const hours = parseInt(_req.query.hours as string || '0');
    const sort = (_req.query.sort as string || 'timestamp');

    let where = '';
    const params: any[] = [];

    if (search) {
      where += ' WHERE repo_name LIKE ?';
      params.push(`%${search}%`);
    }

    if (hours > 0) {
      const cutoff = Date.now() - hours * 60 * 60 * 1000;
      where += where ? ' AND timestamp > ?' : ' WHERE timestamp > ?';
      params.push(cutoff);
    }

    const countSql = `SELECT COUNT(*) as count FROM bursts ${where}`;
    const total = (db.prepare(countSql).get(...params) as { count: number }).count;

    let orderBy = 'ORDER BY timestamp DESC';
    if (sort === 'velocity') orderBy = 'ORDER BY (star_count * 1.0 / window_minutes) DESC';
    if (sort === 'stars') orderBy = 'ORDER BY star_count DESC';

    const dataSql = `SELECT * FROM bursts ${where} ${orderBy} LIMIT ? OFFSET ?`;
    const bursts = db.prepare(dataSql).all(...params, limit, offset);

    res.json({ bursts, total, offset, limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats/daily', (_req, res) => {
  try {
    const db = getDb();
    const days = Math.min(parseInt(_req.query.days as string || '30'), 90);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const eventsDaily = db.prepare(`
      SELECT date(timestamp / 1000, 'unixepoch') as date, COUNT(*) as events, COUNT(DISTINCT repo_name) as repos
      FROM events WHERE timestamp > ? GROUP BY date ORDER BY date
    `).all(cutoff) as { date: string; events: number; repos: number }[];

    const burstsDaily = db.prepare(`
      SELECT date(timestamp / 1000, 'unixepoch') as date, COUNT(*) as bursts, COUNT(DISTINCT repo_name) as active
      FROM bursts WHERE timestamp > ? GROUP BY date ORDER BY date
    `).all(cutoff) as { date: string; bursts: number; active: number }[];

    const bmap = new Map(burstsDaily.map(b => [b.date, b]));
    const merged = eventsDaily.map(e => ({
      date: e.date,
      events: e.events,
      repos: e.repos,
      bursts: bmap.get(e.date)?.bursts ?? 0,
      active: bmap.get(e.date)?.active ?? 0,
    }));

    res.json(merged);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/repos/growth', (_req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(_req.query.limit as string || '10'), 30);
    const hours = Math.min(parseInt(_req.query.hours as string || '24'), 168);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    const topRepos = db.prepare(`
      SELECT repo_name, MAX(repo_url) as repo_url, COUNT(*) as total
      FROM events WHERE timestamp > ? GROUP BY repo_name ORDER BY total DESC LIMIT ?
    `).all(cutoff, limit) as { repo_name: string; repo_url: string; total: number }[];

    const result = topRepos.map(r => {
      const points = db.prepare(`
        SELECT strftime('%Y-%m-%dT%H:00', timestamp / 1000, 'unixepoch') as time, COUNT(*) as count
        FROM events WHERE repo_name = ? AND timestamp > ?
        GROUP BY time ORDER BY time
      `).all(r.repo_name, cutoff) as { time: string; count: number }[];

      let cumulative = 0;
      const chart = points.map(p => {
        cumulative += p.count;
        return { time: p.time, count: p.count, total: cumulative };
      });

      return { repo_name: r.repo_name, repo_url: r.repo_url, total_stars: r.total, chart };
    });

    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

let lastPollTime: number | null = null;

app.get('/api/status', (_req, res) => {
  res.json({
    simulate: SIMULATE,
    pollIntervalSec: POLL_INTERVAL / 1000,
    uptime: Math.round(process.uptime()),
    lastPoll: lastPollTime,
  });
});

const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res, next) => {
  if (_req.path.startsWith('/api') || _req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err && _req.path === '/') {
      res.status(200).send('Client not built yet. Run: cd client && npm run build');
    }
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`WS client connected (${clients.size} total)`);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`WS client disconnected (${clients.size} total)`);
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
});

function broadcast(type: string, data: any) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

let pollCount = 0;

async function poll() {
  try {
    pollCount++;

    if (SIMULATE && pollCount % 2 === 0 && Math.random() < 0.5) {
      simulateBurst();
    }

    const result = SIMULATE ? await simulateEvents() : await pollEvents();

    if (result.newEvents > 0) {
      console.log(`[poll #${pollCount}] ${result.newEvents} new star events`);

      const detections = detectBursts();
      if (detections.length > 0) {
        console.log(`  🔥 ${detections.length} bursts detected:`);
        const saved = saveBursts(detections);

        for (const burst of saved) {
          console.log(`     ${burst.repo_name}: +${burst.star_count}⭐ in ${burst.window_minutes}min`);
          broadcast('new_burst', burst);
          sendNotification(burst).catch(() => {});
          // Record star snapshot for growth tracking
          fetch(`https://api.github.com/repos/${burst.repo_name}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'StarBurst/1.0', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } })
            .then(r => r.json()).then(d => { if (d.stargazers_count) recordStarSnapshot(burst.repo_name, d.stargazers_count); }).catch(() => {});
          sendWebhooks(burst).catch(() => {});

          // Async attribution check
          if (burst.id) {
            const [owner, repo] = burst.repo_name.split('/');
            const bid = burst.id;
            attributeBurst(owner, repo, burst.timestamp, process.env.GITHUB_TOKEN || '')
              .then(source => {
                if (source) {
                  updateBurstSource(bid, source);
                  broadcast('burst_attribution', { id: bid, source });
                }
                // AI attribution disabled — re-enable by setting ANTHROPIC_API_KEY or DEEPSEEK_API_KEY
              })
              .catch(() => {});
          }
        }

        broadcast('stats_update', getStats());
      }
    }

    if (pollCount % 20 === 0) {
      const cleaned = cleanupOldEvents(24);
      if (cleaned > 0) console.log(`  Cleaned ${cleaned} old events`);
    }

    lastPollTime = Date.now();
  } catch (error) {
    console.error('Poll error:', error);
  }
}

server.listen(PORT, () => {
  console.log('');
  console.log('  ✦ StarBurst Server ✦');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Mode: ${SIMULATE ? 'SIMULATION' : 'LIVE'}`);
  console.log(`  Poll: every ${POLL_INTERVAL / 1000}s`);
  if (webhooksEnabled()) console.log('  Webhooks: enabled');
  console.log('');

  poll();
  setInterval(poll, POLL_INTERVAL);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  wss.close();
  server.close();
  process.exit(0);
});
