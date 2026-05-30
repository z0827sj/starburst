import { insertEvent, WatchEvent } from './database';

const GITHUB_EVENTS_URL = 'https://api.github.com/events?per_page=100';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

let lastEtag: string | null = null;

export async function pollEvents(): Promise<{ newEvents: number; totalFetched: number }> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'StarBurst-Monitor/1.0',
  };

  if (GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  }

  if (lastEtag) {
    headers['If-None-Match'] = lastEtag;
  }

  try {
    const response = await fetch(GITHUB_EVENTS_URL, { headers });

    const etag = response.headers.get('etag');
    if (etag) lastEtag = etag;

    if (response.status === 304) {
      return { newEvents: 0, totalFetched: 0 };
    }

    if (!response.ok) {
      console.error(`GitHub API error: ${response.status} ${response.statusText}`);
      return { newEvents: 0, totalFetched: 0 };
    }

    const events = await response.json() as any[];
    let newEvents = 0;

    for (const event of events) {
      if (event.type !== 'WatchEvent') continue;

      const watchEvent: WatchEvent = {
        id: event.id,
        repo_name: event.repo.name,
        repo_url: `https://github.com/${event.repo.name}`,
        timestamp: new Date(event.created_at).getTime(),
        description: event.repo.name,
      };

      if (insertEvent(watchEvent)) {
        newEvents++;
      }
    }

    return { newEvents, totalFetched: events.length };
  } catch (error) {
    console.error('Failed to poll GitHub Events:', error);
    return { newEvents: 0, totalFetched: 0 };
  }
}

const SIM_REPOS = [
  'facebook/react', 'vercel/next.js', 'anthropics/claude-code',
  'microsoft/vscode', 'tensorflow/tensorflow', 'rust-lang/rust',
  'denoland/deno', 'oven-sh/bun', 'withastro/astro', 'tailwindlabs/tailwindcss',
  'shadcn/ui', 'prisma/prisma', 'trpc/trpc', 'tanstack/query',
  'vuejs/core', 'sveltejs/svelte', 'angular/angular', 'remix-run/remix',
  'supabase/supabase', 'vercel/turbo', 'biomejs/biome', 'hono-js/hono',
  'elysiajs/elysia', 'drizzle-team/drizzle-orm', 't3-oss/create-t3-app',
  'calcom/cal.com', 'payloadcms/payload', 'nocodb/nocodb',
  'appwrite/appwrite', 'n8n-io/n8n', 'excalidraw/excalidraw',
  'twentyhq/twenty', 'scalar/scalar', 'unovue/shadcn-vue',
];

export async function simulateEvents(): Promise<{ newEvents: number; totalFetched: number }> {
  const numEvents = Math.floor(Math.random() * 20) + 8;
  let newEvents = 0;

  for (let i = 0; i < numEvents; i++) {
    const repo = SIM_REPOS[Math.floor(Math.random() * SIM_REPOS.length)];
    const event: WatchEvent = {
      id: `sim-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      repo_name: repo,
      repo_url: `https://github.com/${repo}`,
      timestamp: Date.now() - Math.floor(Math.random() * 60000),
      description: repo,
    };

    if (insertEvent(event)) {
      newEvents++;
    }
  }

  return { newEvents, totalFetched: numEvents };
}

export function simulateBurst(): number {
  const repo = SIM_REPOS[Math.floor(Math.random() * SIM_REPOS.length)];
  const burstCount = Math.floor(Math.random() * 40) + 25;
  let inserted = 0;

  for (let i = 0; i < burstCount; i++) {
    const event: WatchEvent = {
      id: `sim-burst-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      repo_name: repo,
      repo_url: `https://github.com/${repo}`,
      timestamp: Date.now() - Math.floor(Math.random() * 300000),
      description: repo,
    };

    if (insertEvent(event)) {
      inserted++;
    }
  }

  console.log(`  [SIM] Generated ${inserted} burst events for ${repo}`);
  return inserted;
}
