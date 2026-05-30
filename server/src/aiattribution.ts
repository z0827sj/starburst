const API_KEY = process.env.ANTHROPIC_API_KEY || ''

interface AttributionContext {
  repo_name: string
  star_count: number
  window_minutes: number
  hn_mentions?: { title: string; points: number; date: string }[]
  releases?: { tag: string; name: string; published: string }[]
  description?: string
}

export async function generateAttribution(ctx: AttributionContext): Promise<string | null> {
  if (!API_KEY) return null

  try {
    const lines: string[] = [`Repo: ${ctx.repo_name}`]
    lines.push(`Burst: +${ctx.star_count} stars in ${ctx.window_minutes} min`)
    if (ctx.description) lines.push(`Description: ${ctx.description}`)
    if (ctx.hn_mentions?.length) {
      lines.push('HN mentions:')
      ctx.hn_mentions.slice(0, 3).forEach(h => {
        lines.push(`  - "${h.title}" (${h.points} pts, ${h.date})`)
      })
    }
    if (ctx.releases?.length) {
      lines.push('Recent releases:')
      ctx.releases.slice(0, 3).forEach(r => {
        lines.push(`  - ${r.tag}: ${r.name} (${r.published})`)
      })
    }

    const prompt = `${lines.join('\n')}\n\nExplain in ONE sentence (max 120 chars) why this GitHub repo got a sudden star burst. Be specific, mention the likely cause. Output only the sentence.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 80,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) return null
    const data = await res.json() as any
    return data?.content?.[0]?.text?.trim() || null
  } catch { return null }
}
