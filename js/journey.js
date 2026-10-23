// Weight page ("המסע") + the home progress ring. Pure functions only: no storage, no DOM, no clock.
// Exact definitions: docs/specs/weight-page.md (v1). Section numbers below refer to that file.
import { day, roundN, fmtWeight, fmtChange, weightDirection } from './trend.js';
import { phaseStart, trendAt, projection } from './analytics.js';
import { activePhase, MIN_WEIGHINS, STALE_DAYS } from './report.js';

export const JOURNEY_GAP = 14; // days: weekly points further apart than this are not joined (§2, convention)

// Start of the journey: the current phase run, or the first weigh-in when no phase is set (§2).
const journeyStart = (series, records, today) => phaseStart(records, today) ?? (series.length ? series[0].date : null);
// Calendar week, Sunday to Saturday (1970-01-01 was a Thursday, so +4 puts Sunday at the start).
const weekOf = iso => Math.floor((day(iso) + 4) / 7);

// §1: the big number. 4+ weigh-ins → the average of the last 4; 1–3 → the last weigh-in; none → null.
export function weightHero(S) {
  const n = S.series.length;
  if (!n) return null;
  if (S.avg !== null) return { kg: fmtWeight(S.avg), label: 'ממוצע 4 השקילות האחרונות', isAvg: true };
  return { kg: fmtWeight(S.latest.kg), label: 'שקילה אחרונה', isAvg: false };
}

// §3: the base of "since phase start": the trend on the start date, else the first average point after it.
// Never a single weigh-in (water noise).
export function journeyBase(series, records, today) {
  const ps = journeyStart(series, records, today);
  if (!ps) return null;
  const at = trendAt(series, ps, JOURNEY_GAP);
  if (at !== null) return { date: ps, kg: at };
  const first = series.find(s => s.avg !== null && s.date >= ps);
  return first ? { date: first.date, kg: first.avg } : null;
}

// §2: one point per calendar week (the last average point of that week, real date and value), from the start on.
// Points more than JOURNEY_GAP days apart start a new segment (no invented points across a gap).
// Under MIN_WEIGHINS weigh-ins: only the raw weigh-ins, no line.
export function journeyPoints(series, records, today) {
  const ps = journeyStart(series, records, today);
  if (!ps) return { segments: [], start: null, raw: [] };
  if (series.length < MIN_WEIGHINS)
    return { segments: [], start: null, raw: series.filter(s => s.date >= ps).map(s => ({ date: s.date, kg: s.kg })) };
  const byWeek = new Map();
  for (const s of series) if (s.avg !== null && s.date >= ps) byWeek.set(weekOf(s.date), { date: s.date, kg: s.avg });
  const segments = [];
  for (const p of byWeek.values()) {
    const seg = segments[segments.length - 1], prev = seg && seg[seg.length - 1];
    if (prev && day(p.date) - day(prev.date) <= JOURNEY_GAP) seg.push(p); else segments.push([p]);
  }
  return { segments, start: journeyBase(series, records, today), raw: [] };
}

// §3: change since the phase start and the part of the way to the target (home ring).
// pct is floored, so 100% shows only once the target is reached; moving away shows 0% (the signed change tells the rest).
export function phaseProgress(S, records, today) {
  const series = S.series, out = { change: null, changeText: '—', pct: null, pctText: '', fill: 0, reached: false };
  if (series.length < MIN_WEIGHINS || S.avg === null) return out;
  const base = journeyBase(series, records, today), D = series[series.length - 1].date;
  if (!base || base.date === D) return out;
  out.change = S.avg - base.kg;
  out.changeText = fmtChange(out.change);
  const rec = activePhase(records, today), dir = weightDirection(rec ? rec.phase : null);
  const target = rec ? rec.targetKg ?? null : null;
  if ((dir !== 1 && dir !== -1) || target === null || dir * (target - base.kg) <= 0) return out;
  const p = (S.avg - base.kg) / (target - base.kg);
  out.pct = Math.min(100, Math.max(0, Math.floor(100 * p + 1e-9)));
  out.pctText = `${out.pct}% מהדרך ליעד`;
  out.fill = Math.min(1, Math.max(0, p));
  out.reached = p >= 1;
  return out;
}

// §5: the analytics projection, hidden as well when the last weigh-in is older than STALE_DAYS.
// line = the dashed part of the chart, from the last average to the target on the expected date.
export function journeyProjection(S, records, today) {
  const p = projection(S, records, today);
  const stale = S.latest && day(today) - day(S.latest.date) > STALE_DAYS;
  if (stale && (p.reason === null || p.reason === 'too_far'))
    return { reason: 'stale', weeks: null, text: 'השקילה האחרונה ישנה מדי לצפי' };
  if (p.reason === 'too_far') return { ...p, text: 'יותר משנה בקצב הנוכחי' };
  if (p.reason !== null) return { ...p, text: '' };
  const range = p.fast !== p.slow ? ` (${p.fast}–${p.slow})` : '';
  return {
    ...p, text: `${p.monthText} · ${p.weeksText} שבועות${range}`,
    line: { from: { date: S.latest.date, kg: S.avg }, to: { date: p.date, kg: p.target } }
  };
}

// §5: kg left to the target, no sign; "הושג" once the trend is on or past it. null = no target in force.
export function kgLeft(S, records, today) {
  const rec = activePhase(records, today), dir = weightDirection(rec ? rec.phase : null);
  const target = rec ? rec.targetKg ?? null : null;
  if ((dir !== 1 && dir !== -1) || target === null || S.avg === null) return null;
  const rem = target - S.avg;
  return dir * rem <= 0 ? 'הושג' : roundN(Math.abs(rem), 1).toFixed(1);
}

// §6: "שבוע N" of the current phase (week 1 = the first 7 days).
export function phaseWeek(records, today) {
  const ps = phaseStart(records, today);
  return ps ? Math.floor((day(today) - day(ps)) / 7) + 1 : null;
}
