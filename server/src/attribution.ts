const HN_SEARCH = 'https://hn.algolia.com/api/v1/search';

interface HNHit {
  title: string
  points: number
  num_comments: number
  created_at: string
  story_title?: string
}

export async function attributeBurst(
  owner: string,
  repo: string,
  burstTs: number,
  githubToken: string
): Promise<string | null> {
  const results = await Promise.allSettled([
    checkHackerNews(owner, repo, burstTs),
    checkGitHubRelease(owner, repo, burstTs, githubToken),
  ]);

  const sources: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) sources.push(r.value);
  }
  return sources.length > 0 ? sources.join(' · ') : null;
}

async function checkHackerNews(
  owner: string,
  repo: string,
  burstTs: number
): Promise<string | null> {
  try {
    const windowStart = burstTs - 48 * 3600000;
    const query = `github.com/${owner}/${repo}`;
    const url = `${HN_SEARCH}?query=${encodeURIComponent(query)}&restrictSearchableAttributes=url&tags=front_page&numericFilters=created_at_i>${Math.floor(windowStart / 1000)}&hitsPerPage=3`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'StarBurst/1.0' },
    });
    if (!res.ok) return null;

    const data = await res.json() as { hits: HNHit[] };
    const hits = data.hits || [];
    if (hits.length === 0) return null;

    const best = hits[0];
    const pts = best.points || 0;
    const comments = best.num_comments || 0;
    if (pts >= 5) {
      return `HN Front Page (${pts} pts, ${comments} comments)`;
    }
    return null;
  } catch {
    return null;
  }
}

async function checkGitHubRelease(
  owner: string,
  repo: string,
  burstTs: number,
  githubToken: string
): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'StarBurst/1.0',
    };
    if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=3`,
      { headers }
    );
    if (!res.ok) return null;

    const releases = await res.json() as any[];
    if (!Array.isArray(releases) || releases.length === 0) return null;

    for (const rel of releases) {
      if (rel.draft || !rel.published_at) continue;
      const publishedTs = new Date(rel.published_at).getTime();
      const diffHours = (burstTs - publishedTs) / 3600000;
      if (diffHours >= 0 && diffHours <= 72) {
        const tag = rel.tag_name || 'unknown';
        return `Release ${tag}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}
