interface EcosystemSignals {
  npm?: { package: string; weeklyDownloads: number; error?: string }
  pypi?: { package: string; recentDownloads: number; error?: string }
  docker?: { image: string; pulls: number; error?: string }
  score: number
  scoreBreakdown: string[]
}

export async function getEcosystem(owner: string, name: string): Promise<EcosystemSignals> {
  const signals: EcosystemSignals = { score: 0, scoreBreakdown: [] }
  const pkgName = name.toLowerCase()

  const results = await Promise.allSettled([
    fetchNpm(pkgName),
    fetchPypi(pkgName),
    fetchDocker(`${owner.toLowerCase()}/${pkgName}`),
  ])

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue
    const result = r.value
    if ('weeklyDownloads' in result && result.weeklyDownloads > 0) {
      signals.npm = result
      const pts = Math.min(25, Math.max(0, Math.log10(result.weeklyDownloads + 1) * 4))
      signals.score += pts
      signals.scoreBreakdown.push(`npm ${result.weeklyDownloads.toLocaleString()}/wk (+${Math.round(pts)})`)
    }
    if ('recentDownloads' in result && result.recentDownloads > 0) {
      signals.pypi = result
      const pts = Math.min(25, Math.max(0, Math.log10(result.recentDownloads + 1) * 4))
      signals.score += pts
      signals.scoreBreakdown.push(`PyPI ${result.recentDownloads.toLocaleString()}/mo (+${Math.round(pts)})`)
    }
    if ('pulls' in result && result.pulls > 0) {
      signals.docker = result
      const pts = Math.min(25, Math.max(0, Math.log10(result.pulls + 1) * 3))
      signals.score += pts
      signals.scoreBreakdown.push(`Docker ${result.pulls.toLocaleString()} pulls (+${Math.round(pts)})`)
    }
  }

  return signals
}

async function fetchNpm(pkg: string): Promise<{ package: string; weeklyDownloads: number } | null> {
  try {
    const res = await fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkg)}`)
    if (!res.ok) return null
    const d = await res.json() as any
    if (d.downloads > 0) return { package: pkg, weeklyDownloads: d.downloads }
    return null
  } catch { return null }
}

async function fetchPypi(pkg: string): Promise<{ package: string; recentDownloads: number } | null> {
  try {
    const res = await fetch(`https://pypistats.org/api/packages/${encodeURIComponent(pkg)}/recent`)
    if (!res.ok) return null
    const d = await res.json() as any
    const total = d?.data?.last_month || 0
    if (total > 0) return { package: pkg, recentDownloads: total }
    return null
  } catch { return null }
}

async function fetchDocker(image: string): Promise<{ image: string; pulls: number } | null> {
  try {
    const res = await fetch(`https://hub.docker.com/v2/repositories/${encodeURIComponent(image)}/`)
    if (!res.ok) return null
    const d = await res.json() as any
    if (d.pull_count > 0) return { image, pulls: d.pull_count }
    return null
  } catch { return null }
}
