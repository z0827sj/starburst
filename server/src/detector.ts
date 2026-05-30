import { getEventsInWindow, getRepoBaselineRate, getRepoBurstInCooldown, updateRepoStats, insertBurst, Burst } from './database';

// ═══ Parameters ═══
const WINDOWS       = [3, 5, 10, 15, 30];  // min
const MAX_WINDOW    = 60;                    // min — event lookback
const BASELINE_HRS  = 6;                     // hr — EWMA window
const EWMA_ALPHA    = 0.15;                  // EWMA weight for new data
const R_MIN         = 1.0;                   // stars/min floor
const MULTIPLIER    = 3.0;                   // smoothed_ratio ≥ this
const SMOOTH_A      = 0.3;                   // stars/min — Laplace α in rate space (≈0.5 stars in 3-min window is noise)
const P_THRESHOLD   = 0.006;                 // Poisson upper-tail (≈ Gaussian z=2.5 one-sided)
const COOLDOWN_MIN  = 30;                    // min
const ACCEL_X       = 2.0;                   // cooldown bypass multiplier
const LAG_MIN       = 3;                     // min — Events API lag (set to 0 for exact stargazers polling)
const GLOBAL_PRIOR  = 0.1;                   // stars/min — cold-start baseline
const SIM_BURST_CHANCE = 0.25;

// hot score weights: magnitude | acceleration | significance
const HW = [0.2, 0.35, 0.45];
const L1P100 = Math.log1p(100);
const L1P20  = Math.log1p(20);
const L10P   = -Math.log10(P_THRESHOLD);

export interface BurstDetection {
  repo_name: string; repo_url: string;
  star_count: number; window_minutes: number;
  baseline_rate: number; recent_rate: number;
  smoothed_ratio: number; p_value: number; hot_score: number;
}

/* ─── Exact Poisson upper-tail ───
   p = P(X ≥ k | λ) = 1 − Σ_{i=0}^{k−1} e^{−λ} λ^i / i!   */
function poissonP(k: number, lambda: number): number {
  if (lambda < 0) lambda = 0;
  if (k <= 0) return 1;
  let s = 0, t = Math.exp(-lambda);
  for (let i = 0; i < k; i++) { s += t; t *= lambda / (i + 1); if (s > 0.9999) break; }
  return Math.max(0, 1 - s);
}

/* ─── Smoothed ratio (rate space, constant α) ─── */
function sRatio(rr: number, br: number): number { return (rr + SMOOTH_A) / (br + SMOOTH_A); }

/* ─── Hot score ───
   mag = log1p(rate)  / log1p(100)      [0..~1]
   acc = log1p(ratio−1)/log1p(20)       [0..~1]
   sig = −log10(p)    / −log10(0.006)   [0..1+]
   weighted: 0.2×mag + 0.35×acc + 0.45×sig  */
function hot(rr: number, ratio: number, p: number): number {
  const mag = Math.log1p(rr) / L1P100;
  const acc = ratio > 1 ? Math.log1p(ratio - 1) / L1P20 : 0;
  const sig = Math.min(2, -Math.log10(Math.max(p, 1e-12)) / L10P);
  return Math.round((mag * HW[0] + acc * HW[1] + sig * HW[2]) * 100) / 100;
}

/* ─── Full trigger: AND logic ─── */
function trigger(rr: number, ratio: number, p: number): boolean {
  return rr >= R_MIN && ratio >= MULTIPLIER && p < P_THRESHOLD;
}

/* ═══ Main ═══ */
export function detectBursts(): BurstDetection[] {
  const now = Date.now();
  const start = now - MAX_WINDOW * 60 * 1000;
  const safe = now - LAG_MIN * 60 * 1000;

  const all = getEventsInWindow(start, now);
  const repos = new Map<string, { url: string; ts: number[] }>();
  for (const e of all) {
    if (!repos.has(e.repo_name)) repos.set(e.repo_name, { url: e.repo_url, ts: [] });
    repos.get(e.repo_name)!.ts.push(e.timestamp);
  }

  const dets: BurstDetection[] = [];

  for (const [name, data] of repos) {
    const recentTotal = data.ts.filter(t => t >= start).length;
    if (recentTotal > 0) updateRepoStats(name, recentTotal, MAX_WINDOW);

    const ewma = getRepoBaselineRate(name);
    const bl = ewma > 0 ? ewma : GLOBAL_PRIOR; // cold-start fallback

    // Cooldown
    const prev = getRepoBurstInCooldown(name, COOLDOWN_MIN);
    let bypass = false;
    if (prev) {
      const recent = data.ts.filter(t => t >= safe - COOLDOWN_MIN * 60 * 1000).length;
      bypass = recent >= prev.star_count * ACCEL_X;
      if (!bypass) continue;
    }

    let bestW = 0, bestC = 0, bestP = 1, bestR = 0, bestRatio = 1;

    for (const w of WINDOWS) {
      const ws = safe - w * 60 * 1000;
      const c = data.ts.filter(t => t >= ws && t <= safe).length;
      const rr = c / w; // stars/min
      if (rr < R_MIN) continue;
      const ratio = sRatio(rr, bl);
      if (ratio < MULTIPLIER) continue;
      const p = poissonP(c, bl * w);
      if (p < P_THRESHOLD && p < bestP) { bestP = p; bestW = w; bestC = c; bestR = rr; bestRatio = ratio; }
    }

    if (bestW === 0 || !trigger(bestR, bestRatio, bestP)) continue;

    dets.push({
      repo_name: name, repo_url: data.url,
      star_count: bestC, window_minutes: bestW,
      baseline_rate: Math.round(bl * 100) / 100,
      recent_rate: Math.round(bestR * 100) / 100,
      smoothed_ratio: Math.round(bestRatio * 100) / 100,
      p_value: Math.round(bestP * 1e6) / 1e6,
      hot_score: hot(bestR, bestRatio, bestP),
    });
  }

  dets.sort((a, b) => b.hot_score - a.hot_score);
  return dets;
}

export function saveBursts(detections: BurstDetection[]): Burst[] {
  const saved: Burst[] = []; const now = Date.now();
  for (const d of detections) {
    const burst: Burst = {
      repo_name: d.repo_name, repo_url: d.repo_url,
      star_count: d.star_count, window_minutes: d.window_minutes,
      baseline_avg: d.baseline_rate, timestamp: now,
      description: `${d.repo_name} +${d.star_count}⭐ in ${d.window_minutes}min (${d.recent_rate}/min, ${d.smoothed_ratio}x BL, p=${d.p_value})`,
    };
    insertBurst(burst); saved.push(burst);
  }
  return saved;
}

export { SIM_BURST_CHANCE };
