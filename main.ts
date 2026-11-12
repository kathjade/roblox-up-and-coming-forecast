// Deterministic probabilistic forecaster for Roblox's Up-and-Coming chart.
// Reads only the supplied history; Node standard library only, no network.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

type Row = {
  rank: number;
  universe_id: number;
  playing: number | null;
  up_votes?: number | null;
  down_votes?: number | null;
};
type Snapshot = {
  at: string;
  ok: boolean;
  up_and_coming: Row[] | null;
};
type TimedRank = { t: number; rank: number };

const task = JSON.parse(readFileSync(join(inputDir, 'task.json'), 'utf8')) as {
  places: number;
  output: string;
  snapshots?: number;
  window?: { slots: number; slot_minutes: number };
};
const marks = readFileSync(join(inputDir, 'history.ndjson'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Snapshot)
  .filter((mark) => mark.ok && Array.isArray(mark.up_and_coming));
if (marks.length === 0) throw new Error('history contains no successful Up-and-Coming snapshots');

const latest = marks[marks.length - 1]!;
const cutoff = Date.parse(latest.at);
const chart = [...latest.up_and_coming!].sort((a, b) => a.rank - b.rank);
const places = Math.min(10, task.places);
if (chart.length < places) throw new Error(`latest chart has only ${chart.length} games`);

// Build a recent, exponentially weighted rank trajectory for every game in the final chart.
// The short history is downweighted to avoid extrapolating a temporary surge across three days.
const trajectories = new Map<number, TimedRank[]>();
for (const mark of marks) {
  const t = Date.parse(mark.at);
  if (!Number.isFinite(t) || t > cutoff) continue;
  for (const row of mark.up_and_coming!) {
    const series = trajectories.get(row.universe_id) ?? [];
    series.push({ t, rank: row.rank });
    trajectories.set(row.universe_id, series);
  }
}

function rankVelocity(id: number): number {
  const series = (trajectories.get(id) ?? [])
    .filter((point) => cutoff - point.t <= 36 * 3_600_000)
    .sort((a, b) => a.t - b.t);
  if (series.length < 3) return 0;
  // Weighted least-squares slope in places/hour, with recent observations carrying more weight.
  const points = series.map((point) => {
    const age = (cutoff - point.t) / 3_600_000;
    return { x: -age, y: point.rank, w: Math.exp(-age / 12) };
  });
  const sw = points.reduce((s, p) => s + p.w, 0);
  const mx = points.reduce((s, p) => s + p.w * p.x, 0) / sw;
  const my = points.reduce((s, p) => s + p.w * p.y, 0) / sw;
  const cov = points.reduce((s, p) => s + p.w * (p.x - mx) * (p.y - my), 0);
  const variance = points.reduce((s, p) => s + p.w * (p.x - mx) ** 2, 0);
  if (variance < 1e-8) return 0;
  // Positive velocity means a worsening (larger-numbered) chart rank.
  const raw = cov / variance;
  return Math.max(-0.6, Math.min(0.6, raw * 0.3));
}

const candidates = chart.map((row) => ({
  id: row.universe_id,
  rank: row.rank,
  velocity: rankVelocity(row.universe_id),
}));

// Use the scored window's midpoint rather than assuming a fixed competition horizon.
const horizon = task.window
  ? (task.window.slots * task.window.slot_minutes) / 120
  : 36;
const top10 = [...candidates]
  .map((candidate) => ({ ...candidate, expected: candidate.rank + candidate.velocity * horizon }))
  .sort((a, b) => a.expected - b.expected || a.rank - b.rank || a.id - b.id)
  .slice(0, 10)
  .map((candidate) => candidate.id);

const probabilities: Array<{ universe_id: number; place: number; p: number }> = [];
const unknownMass = 0.12; // Unobserved games can enter from below the captured chart.
for (let place = 1; place <= places; place++) {
  // Rank diffusion grows with the square root of the window's representative horizon.
  // Keep a small floor for the close-in first hours and let uncertainty grow gradually.
  const sigma = 2.0 + 0.38 * Math.sqrt(horizon);
  const weights = candidates.map((candidate) => {
    const projectedRank = Math.max(1, Math.min(130, candidate.rank + candidate.velocity * horizon));
    const z = (projectedRank - place) / sigma;
    return Math.exp(-0.5 * z * z);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) continue;
  for (let i = 0; i < candidates.length; i++) {
    const p = Math.floor(((1 - unknownMass) * weights[i]! / total) * 1e6) / 1e6;
    if (p > 0) probabilities.push({ universe_id: candidates[i]!.id, place, p });
  }
}

const output = { probabilities, top10 };
const serialized = `${JSON.stringify(output)}\n`;
if (Buffer.byteLength(serialized, 'utf8') > 1_048_576) throw new Error('forecast exceeds the 1 MiB output limit');
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, task.output), serialized);
