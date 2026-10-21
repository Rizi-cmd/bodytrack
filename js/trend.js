// Trend engine (weight). Pure functions only: no storage, no DOM, no clock.
// Exact definitions: docs/specs/trend-engine.md (v1). Section numbers below refer to that file.
import { isISODate } from './model.js';

export const STUCK = 0.20;      // kg/week, |rounded rate| below this = stuck / holding (§4)
export const WINDOW_DAYS = 28;  // rate window (§3)
export const MIN_SPAN_DAYS = 14; // earliest weigh-in feeding the window → last weigh-in (§3)
const MINUS = '−';

// Whole days since 1970-01-01 in UTC: no local time, so DST can't shift anything (§1).
export const day = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

// §1: drop deleted / invalid, merge same-date duplicates by mean, sort ascending.
export function cleanWeighins(list) {
  const byDate = new Map();
  for (const w of Array.isArray(list) ? list : []) {
    if (!w || w.deleted === true || !isISODate(w.date)) continue;
    const kg = w.kg;
    if (typeof kg !== 'number' || !Number.isFinite(kg) || kg < 30 || kg > 300) continue;
    const a = byDate.get(w.date) || [];
    a.push(kg);
    byDate.set(w.date, a);
  }
  return [...byDate.keys()].sort().map(date => {
    const a = byDate.get(date);
    return { date, kg: a.reduce((s, v) => s + v, 0) / a.length };
  });
}

// §2: average of the last 4 weigh-ins at each point; t = centroid day of those 4 (used for the slope only).
export function trendSeries(points) {
  return points.map((p, i) => {
    if (i < 3) return { date: p.date, kg: p.kg, avg: null, t: null };
    const four = points.slice(i - 3, i + 1);
    return {
      date: p.date, kg: p.kg,
      avg: four.reduce((s, q) => s + q.kg, 0) / 4,
      t: four.reduce((s, q) => s + day(q.date), 0) / 4
    };
  });
}

// §3: OLS slope of avg on t over the last 28 days, × 7 → kg/week.
export function weeklyRate(series) {
  const empty = { rate: null, provisional: false, windowDates: [], windowStart: null };
  if (!series.length) return { ...empty, reason: 'no_data' };
  const D = day(series[series.length - 1].date);
  const idx = [];
  series.forEach((s, i) => { if (s.avg !== null && day(s.date) >= D - WINDOW_DAYS) idx.push(i); });
  if (idx.length < 2) return { ...empty, reason: 'need_more_weighins' };
  const feedFrom = idx[0] - 3; // earliest weigh-in that feeds the window
  const windowDates = series.slice(feedFrom).map(s => s.date);
  const windowStart = series[feedFrom].date;
  if (D - day(windowStart) < MIN_SPAN_DAYS) return { ...empty, windowDates, windowStart, reason: 'span_too_short' };
  const xs = idx.map(i => series[i].t), ys = idx.map(i => series[i].avg);
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0, sxx = 0;
  xs.forEach((x, k) => { sxy += (x - mx) * (ys[k] - my); sxx += (x - mx) ** 2; });
  return { rate: (sxy / sxx) * 7, provisional: idx.length < 3, windowDates, windowStart, reason: null };
}

// §6 rounding: halves away from zero, tiny nudge for binary float error, never −0.
export function roundN(v, n) {
  const f = 10 ** n;
  const r = Math.sign(v) * Math.round(Math.abs(v) * f + 1e-7) / f;
  return r === 0 ? 0 : r;
}

// §4
export function weightDirection(phase) {
  return { cut: -1, bulk: 1, maintenance: 0 }[phase] ?? null;
}

const arrowOf = r => (r < 0 ? 'down' : r > 0 ? 'up' : 'flat');

export function verdict(rate, direction) {
  if (rate === null || rate === undefined) return { verdict: 'too_early', colour: 'ink', arrow: null };
  const r = roundN(rate, 2);
  if (direction === null || direction === undefined) return { verdict: 'no_phase', colour: 'ink', arrow: arrowOf(r) };
  if (Math.abs(r) < STUCK) {
    return direction === 0
      ? { verdict: 'holding', colour: 'good', arrow: 'flat' }
      : { verdict: 'stuck', colour: 'ink', arrow: 'flat' };
  }
  if (direction !== 0 && Math.sign(r) === direction) return { verdict: 'toward', colour: 'good', arrow: arrowOf(r) };
  return { verdict: 'away', colour: 'bad', arrow: arrowOf(r) };
}

// §5: rolling 28 days; reference = avg point closest to D−28 within [D−35, D−21], tie → older.
export function monthChange(series) {
  const last = series[series.length - 1];
  if (!last || last.avg === null) return { monthChange: null, monthRefDate: null };
  const D = day(last.date);
  let ref = null, best = Infinity;
  for (const s of series) {
    if (s.avg === null) continue;
    const d = day(s.date);
    if (d < D - 35 || d > D - 21) continue;
    const dist = Math.abs(d - (D - 28));
    if (dist < best) { best = dist; ref = s; } // ascending order + strict < keeps the older one on a tie
  }
  if (!ref) return { monthChange: null, monthRefDate: null };
  return { monthChange: last.avg - ref.avg, monthRefDate: ref.date };
}

// Phase input: a string ('cut' | 'bulk' | 'maintenance'), or a list of {from:'YYYY-MM-DD', phase}.
// asOf = the date whose phase counts (defaults to the last weigh-in; the app passes today so a phase
// picked today applies at once).
function phaseInfo(phase, lastDate, windowStart, asOf) {
  if (!Array.isArray(phase)) return { phase: phase ?? null, changed: false };
  const at = asOf && (!lastDate || asOf > lastDate) ? asOf : lastDate;
  const recs = phase.filter(p => p && isISODate(p.from)).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  // Stable sort: on the same `from` date, the record later in the list wins.
  let current = null, changed = false;
  for (const p of recs) {
    if (!at || p.from > at) break;
    // A real change only: not cut → cut, and not the very first phase being set.
    if (windowStart && p.from > windowStart && current !== null && p.phase !== current) changed = true;
    current = p.phase;
  }
  return { phase: current, changed };
}

// §7: everything the verdict screen needs, recomputed from scratch.
export function trendSummary(weighins, phase, asOf) {
  const points = cleanWeighins(weighins);
  const series = trendSeries(points);
  const last = series[series.length - 1] || null;
  const wr = weeklyRate(series);
  const mc = monthChange(series);
  const ph = phaseInfo(phase, last && last.date, wr.windowStart, asOf);
  const phaseName = ph.phase;
  const direction = weightDirection(ph.phase);
  const v = verdict(wr.rate, direction);
  return {
    latest: last ? { date: last.date, kg: last.kg } : null,
    avg: last ? last.avg : null,
    rate: wr.rate,
    rateRounded: wr.rate === null ? null : roundN(wr.rate, 2),
    provisional: wr.provisional,
    windowDates: wr.windowDates,
    monthChange: mc.monthChange,
    monthRefDate: mc.monthRefDate,
    phase: phaseName, direction,
    verdict: v.verdict, colour: v.colour, arrow: v.arrow,
    phaseChangedInWindow: ph.changed,
    reason: wr.reason,
    series
  };
}

// §6 display strings. Plain text; the UI sets dir="ltr" around them.
export const EMPTY = '—';
function fmt(v, n, signed) {
  if (v === null || v === undefined || !Number.isFinite(v)) return EMPTY;
  const r = roundN(v, n);
  const s = Math.abs(r).toFixed(n);
  if (r === 0) return s;
  if (r < 0) return MINUS + s;
  return signed ? '+' + s : s;
}
export const fmtWeight = v => fmt(v, 1, false); // today's weigh-in, average of 4
export const fmtChange = v => fmt(v, 1, true);  // change vs previous month
export const fmtRate = v => fmt(v, 2, true);    // weekly rate
