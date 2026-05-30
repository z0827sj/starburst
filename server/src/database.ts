import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'starburst.db');

let db: Database.Database;

export function initDatabase(): Database.Database {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      repo_name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS bursts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      star_count INTEGER NOT NULL,
      window_minutes INTEGER NOT NULL,
      baseline_avg REAL,
      timestamp INTEGER NOT NULL,
      description TEXT,
      notified INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_events_repo ON events(repo_name);
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_repo_ts ON events(repo_name, timestamp);
    CREATE INDEX IF NOT EXISTS idx_bursts_ts ON bursts(timestamp);
    CREATE INDEX IF NOT EXISTS idx_bursts_repo_ts ON bursts(repo_name, timestamp);

    CREATE TABLE IF NOT EXISTS repo_stats (
      repo_name TEXT PRIMARY KEY,
      ewma_rate REAL DEFAULT 0,
      last_event_ts INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS star_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_name TEXT NOT NULL,
      stars INTEGER NOT NULL,
      recorded_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_repo_ts ON star_snapshots(repo_name, recorded_at);
  `);

  // Migration: add source column if not exists
  try { db.exec(`ALTER TABLE bursts ADD COLUMN source TEXT`); } catch { /* column exists */ }

  return db;
}

export function getDb(): Database.Database {
  return db;
}

export interface WatchEvent {
  id: string;
  repo_name: string;
  repo_url: string;
  timestamp: number;
  description: string;
}

export interface Burst {
  id?: number;
  hot_score?: number;
  repo_name: string;
  repo_url: string;
  star_count: number;
  window_minutes: number;
  baseline_avg: number;
  timestamp: number;
  description: string;
  source?: string;
}

export function insertEvent(event: WatchEvent): boolean {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO events (id, repo_name, repo_url, timestamp, description) VALUES (?, ?, ?, ?, ?)'
  );
  const result = stmt.run(event.id, event.repo_name, event.repo_url, event.timestamp, event.description);
  return result.changes > 0;
}

export function getRecentEvents(minutes: number): WatchEvent[] {
  const cutoff = Date.now() - minutes * 60 * 1000;
  return db.prepare(
    'SELECT * FROM events WHERE timestamp > ? ORDER BY timestamp DESC'
  ).all(cutoff) as WatchEvent[];
}

export function getEventsInWindow(startMs: number, endMs: number): WatchEvent[] {
  return db.prepare(
    'SELECT * FROM events WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC'
  ).all(startMs, endMs) as WatchEvent[];
}

export function getStarEvents(repoName: string, startMs: number, endMs: number): WatchEvent[] {
  return db.prepare(
    'SELECT * FROM events WHERE repo_name = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC'
  ).all(repoName, startMs, endMs) as WatchEvent[];
}

export function insertBurst(burst: Burst): void {
  db.prepare(
    'INSERT INTO bursts (repo_name, repo_url, star_count, window_minutes, baseline_avg, timestamp, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(burst.repo_name, burst.repo_url, burst.star_count, burst.window_minutes, burst.baseline_avg, burst.timestamp, burst.description);
}

export function getRecentBursts(limit = 50): Burst[] {
  const now = Date.now();
  const rows = db.prepare(
    "SELECT *," +
    "  (star_count * 1.0 / window_minutes) / POWER(((? - timestamp) / 1800000.0) + 1.0, 1.2) as hot_score" +
    " FROM bursts" +
    " ORDER BY hot_score DESC" +
    " LIMIT ?"
  ).all(now, limit) as Burst[];
  return rows;
}

export function getBurstsByHour(hours: number): { hour: string; count: number }[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return db.prepare(`
    SELECT 
      strftime('%Y-%m-%d %H:00', timestamp / 1000, 'unixepoch') as hour,
      COUNT(*) as count
    FROM bursts 
    WHERE timestamp > ?
    GROUP BY hour
    ORDER BY hour ASC
  `).all(cutoff) as { hour: string; count: number }[];
}

export function getTopBurstRepos(limit = 10): { repo_name: string; total_stars: number; burst_count: number }[] {
  return db.prepare(`
    SELECT 
      repo_name,
      SUM(star_count) as total_stars,
      COUNT(*) as burst_count
    FROM bursts
    GROUP BY repo_name
    ORDER BY total_stars DESC
    LIMIT ?
  `).all(limit) as { repo_name: string; total_stars: number; burst_count: number }[];
}

export function getStats(): { total_events: number; total_repos: number; bursts_today: number; active_now: number } {
  const totalEvents = (db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number }).count;
  const totalRepos = (db.prepare('SELECT COUNT(DISTINCT repo_name) as count FROM events').get() as { count: number }).count;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const burstsToday = (db.prepare('SELECT COUNT(*) as count FROM bursts WHERE timestamp > ?').get(todayStart.getTime()) as { count: number }).count;
  const recentWindow = Date.now() - 10 * 60 * 1000;
  const activeNow = (db.prepare('SELECT COUNT(DISTINCT repo_name) as count FROM bursts WHERE timestamp > ?').get(recentWindow) as { count: number }).count;

  return { total_events: totalEvents, total_repos: totalRepos, bursts_today: burstsToday, active_now: activeNow };
}

export function cleanupOldEvents(maxAgeHours = 24): number {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  return (db.prepare('DELETE FROM events WHERE timestamp < ?').run(cutoff)).changes;
}

export function updateBurstSource(burstId: number, source: string): void {
  db.prepare('UPDATE bursts SET source = ? WHERE id = ?').run(source, burstId);
}

// Star snapshots for growth tracking
export function recordStarSnapshot(repo: string, stars: number): void {
  db.prepare('INSERT INTO star_snapshots (repo_name, stars, recorded_at) VALUES (?, ?, ?)').run(repo, stars, Date.now());
}

export function getStarGrowth(days: number, limit: number): { repo_name: string; growth: number; current_stars: number }[] {
  const cutoff = Date.now() - days * 86400000;
  const rows = db.prepare(`
    SELECT a.repo_name, a.stars as current_stars, (a.stars - COALESCE(b.stars, a.stars)) as growth
    FROM star_snapshots a
    LEFT JOIN star_snapshots b ON a.repo_name = b.repo_name AND b.recorded_at = (
      SELECT MIN(recorded_at) FROM star_snapshots WHERE repo_name = a.repo_name AND recorded_at > ?
    )
    WHERE a.recorded_at = (SELECT MAX(recorded_at) FROM star_snapshots WHERE repo_name = a.repo_name)
    ORDER BY growth DESC LIMIT ?
  `).all(cutoff, limit) as { repo_name: string; growth: number; current_stars: number }[];
  return rows;
}

// EWMA rate tracking
export function updateRepoStats(repo: string, eventCount: number, windowMin: number): void {
  const rate = eventCount / windowMin;
  const alpha = 0.15; // EWMA smoothing factor
  const existing = db.prepare('SELECT ewma_rate FROM repo_stats WHERE repo_name = ?').get(repo) as { ewma_rate: number } | undefined;
  const newRate = existing ? existing.ewma_rate * (1 - alpha) + rate * alpha : rate;
  db.prepare('INSERT OR REPLACE INTO repo_stats (repo_name, ewma_rate, updated_at) VALUES (?, ?, ?)').run(repo, newRate, Date.now());
}

export function getRepoBaselineRate(repo: string): number {
  const row = db.prepare('SELECT ewma_rate FROM repo_stats WHERE repo_name = ?').get(repo) as { ewma_rate: number } | undefined;
  return row?.ewma_rate || 0;
}

export function getRepoBurstInCooldown(repo: string, cooldownMin: number): { ts: number; star_count: number } | null {
  const cutoff = Date.now() - cooldownMin * 60 * 1000;
  const row = db.prepare('SELECT timestamp, star_count FROM bursts WHERE repo_name = ? AND timestamp > ? ORDER BY timestamp DESC LIMIT 1').get(repo, cutoff) as { timestamp: number; star_count: number } | undefined;
  return row || null;
}

export function getRepoEventsInWindow(repo: string, startMs: number, endMs: number): number[] {
  const rows = db.prepare('SELECT timestamp FROM events WHERE repo_name = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp').all(repo, startMs, endMs) as { timestamp: number }[];
  return rows.map(r => r.timestamp);
}
