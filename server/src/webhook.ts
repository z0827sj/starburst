interface BurstPayload {
  repo_name: string
  repo_url: string
  star_count: number
  window_minutes: number
  timestamp: number
  description: string
  source?: string
}

const SLACK_URL = process.env.SLACK_WEBHOOK_URL || ''
const DISCORD_URL = process.env.DISCORD_WEBHOOK_URL || ''

const ENABLED = !!(SLACK_URL || DISCORD_URL)

export function webhooksEnabled(): boolean { return ENABLED }

export async function sendWebhooks(burst: BurstPayload): Promise<void> {
  if (!ENABLED) return
  const results = await Promise.allSettled([
    SLACK_URL ? sendSlack(burst) : Promise.resolve(),
    DISCORD_URL ? sendDiscord(burst) : Promise.resolve(),
  ])
  for (const r of results) {
    if (r.status === 'rejected') console.error('[webhook]', r.reason)
  }
}

async function sendSlack(b: BurstPayload): Promise<void> {
  const velocity = (b.star_count / b.window_minutes).toFixed(1)
  const time = new Date(b.timestamp).toLocaleString()
  const sourceLine = b.source ? `\n> 🕵️ *Source*: ${b.source}` : ''

  const res = await fetch(SLACK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `🔥 ${b.repo_name} +${b.star_count}⭐`, emoji: true },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${b.star_count} stars* in ${b.window_minutes} min (${velocity}/min)\n> <${b.repo_url}|View on GitHub> · ${time}${sourceLine}`,
          },
        },
        { type: 'divider' },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Slack ${res.status}: ${await res.text()}`)
}

async function sendDiscord(b: BurstPayload): Promise<void> {
  const velocity = (b.star_count / b.window_minutes).toFixed(1)
  const time = new Date(b.timestamp).toLocaleString()

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Stars', value: `+${b.star_count}`, inline: true },
    { name: 'Window', value: `${b.window_minutes} min`, inline: true },
    { name: 'Velocity', value: `${velocity}/min`, inline: true },
  ]
  if (b.source) fields.push({ name: 'Source', value: b.source, inline: false })

  const res = await fetch(DISCORD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [
        {
          title: `🔥 ${b.repo_name} +${b.star_count}⭐`,
          description: b.description,
          url: b.repo_url,
          color: 8151871,
          fields,
          footer: { text: `StarBurst · ${time}` },
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`)
}
