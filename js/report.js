// Verdict screen: everything shown is computed here (pure, no DOM, no clock) so it can be tested.
// Numbers come from js/trend.js; this file turns them into words, tones and chart geometry.
import { SITES, isISODate } from './model.js';
import { day, roundN, fmtWeight, fmtChange, fmtRate, STUCK } from './trend.js';

export const PHASES = [
  { id: 'cut', he: 'חיטוב' },
  { id: 'bulk', he: 'מסה' },
  { id: 'maintenance', he: 'תחזוקה' }
];
export const PHASE_HE = Object.fromEntries(PHASES.map(p => [p.id, p.he]));
// A stored phase record the app can trust (restore and render both use this).
export const isPhaseRecord = r => !!r && typeof r === 'object' && r.type === 'phase' && !r.deleted &&
  Object.prototype.hasOwnProperty.call(PHASE_HE, r.phase) && isISODate(r.from) &&
  (r.targetKg === undefined || r.targetKg === null || okTarget(r.targetKg));
const okTarget = v => typeof v === 'number' && Number.isFinite(v) && v >= 30 && v <= 300;

// Target weight typed by the owner: '' → null (no target), '82,5' → 82.5, anything else → NaN (rejected).
export function parseTarget(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (t === '') return null;
  if (!/^\d{2,3}(\.\d{1,2})?$/.test(t)) return NaN;
  const v = +t;
  return okTarget(v) ? v : NaN;
}

// The phase record in force on a date (latest `from` on/before it; same date → later in the list).
export function activePhase(records, date) {
  let cur = null;
  for (const r of (records || []).filter(isPhaseRecord).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)))
    if (r.from <= date) cur = r;
  return cur;
}

// Phase pick → the record to write. Rules: the very first pick covers all history (from = first weigh-in);
// re-picking while only that first record exists replaces it; a later pick starts today, and picking again
// on the same day replaces that day's record (so a mis-tap leaves no trace).
// Same phase as now → only the target weight changes on the current record.
export function phasePick(records, phase, today, firstWeighin, at, targetKg = null) {
  const recs = (records || []).filter(isPhaseRecord);
  const active = activePhase(recs, today);
  if (active && active.phase === phase) return { ...active, targetKg, at };
  if (recs.length === 1 && recs[0].first) return { ...recs[0], phase, targetKg, at };
  if (!recs.length) return { id: `phase-${at}`, type: 'phase', from: firstWeighin && firstWeighin < today ? firstWeighin : today, phase, targetKg, at, first: true };
  const same = recs.find(r => r.from === today && !r.first);
  return same ? { ...same, phase, targetKg, at } : { id: `phase-${at}`, type: 'phase', from: today, phase, targetKg, at };
}
export const TAG_HE = { sick: 'מחלה', vacation: 'חופשה', event: 'אירוע' };
export const MIN_WEIGHINS = 5; // spec §3: 2 average points = 3 + 2 weigh-ins

const ARROW = { down: '↓', up: '↑', flat: '→' };
const MOVE_WORD = { down: 'יורד', up: 'עולה', flat: 'יציב' };

export const fmtDay = iso => `${+iso.slice(8, 10)}.${+iso.slice(5, 7)}`;
export const fmtFull = iso => `${+iso.slice(8, 10)}.${+iso.slice(5, 7)}.${iso.slice(0, 4)}`;

// The verdict line: word + arrow + tone + the short label beside it.
export function verdictText(s, weighinCount) {
  const arrow = s.arrow ? ARROW[s.arrow] : '';
  switch (s.verdict) {
    case 'toward': return { arrow, word: MOVE_WORD[s.arrow], tone: 'good', label: 'לכיוון היעד' };
    case 'away': return { arrow, word: MOVE_WORD[s.arrow], tone: 'bad', label: 'בכיוון ההפוך מהיעד' };
    case 'stuck': return { arrow, word: 'תקוע', tone: 'ink', label: `פחות מ־${STUCK.toFixed(1)} ק״ג בשבוע` };
    case 'holding': return { arrow, word: 'יציב', tone: 'good', label: 'בתחזוקה זה היעד' };
    case 'no_phase': return { arrow, word: MOVE_WORD[s.arrow], tone: 'ink', label: 'לא נבחר שלב' };
    default: return { arrow: '', word: 'מוקדם להגיד', tone: 'ink', label: tooEarlyReason(s.reason, weighinCount) };
  }
}

export function tooEarlyReason(reason, n) {
  if (reason === 'no_data') return 'אין עדיין שקילות';
  if (reason === 'span_too_short') return 'צריך שקילות על פני שבועיים לפחות';
  if (n < MIN_WEIGHINS) return `${n === 1 ? 'יש שקילה אחת' : `יש ${n} שקילות`}, צריך לפחות ${MIN_WEIGHINS}`;
  return 'אין מספיק שקילות בחודש האחרון';
}

// A change shown with arrow + word. Tone by goal direction (−1 / +1); 0 or null → ink.
export function changeView(delta, direction, decimals = 1) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
  const r = roundN(delta, decimals);
  if (r === 0) return { text: fmtChange(0), arrow: ARROW.flat, word: 'בלי שינוי', tone: 'ink', zero: true };
  const up = r > 0;
  const tone = direction === 1 || direction === -1 ? (Math.sign(r) === direction ? 'good' : 'bad') : 'ink';
  return { text: decimals === 1 ? fmtChange(delta) : fmtRate(delta), arrow: up ? ARROW.up : ARROW.down, word: up ? 'עלה' : 'ירד', tone };
}

// Footnotes under the verdict (only facts, no advice).
export function footnotes(s, checkins) {
  const out = [];
  if (s.rate !== null && s.extended)
    out.push(`הקצב חושב על פני ${Math.round(s.spanDays / 7)} שבועות, כי היו מעט שקילות בחודש האחרון.`);
  if (s.rate !== null && s.provisional) out.push('קצב ראשוני: יש רק מעט שקילות בחישוב.');
  if (s.phaseChangedInWindow) out.push('השלב השתנה בתוך תקופת החישוב.');
  const inWin = new Set(s.windowDates);
  const tagged = (checkins || [])
    .filter(c => c && !c.deleted && TAG_HE[c.tag] && inWin.has(c.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (s.rate !== null && tagged.length)
    out.push((tagged.length > 1 ? 'בחישוב יש שקילות מסומנות: ' : 'בחישוב יש שקילה מסומנת: ') + tagged.map(c => `${TAG_HE[c.tag]} (${fmtDay(c.date)})`).join(', ') + '.');
  return out;
}

// How often he weighs in: days since the last weigh-in (vs today) and the average gap over all history.
export function weighinStats(series, today) {
  if (!series.length) return { daysSince: null, avgEvery: null };
  const first = day(series[0].date), last = day(series[series.length - 1].date);
  return {
    daysSince: today && day(today) >= last ? day(today) - last : null, // a future-dated weigh-in shows nothing
    avgEvery: series.length > 1 ? (last - first) / (series.length - 1) : null
  };
}
export function cadenceText(st) {
  const parts = [];
  if (st.daysSince !== null)
    parts.push('שקילה אחרונה ' + (st.daysSince === 0 ? 'היום' : st.daysSince === 1 ? 'אתמול' : `לפני ${st.daysSince} ימים`));
  if (st.avgEvery !== null) {
    const v = Math.max(1, Math.round(st.avgEvery));
    parts.push(v === 1 ? 'בממוצע שקילה כל יום' : `בממוצע שקילה כל ${v} ימים`);
  }
  return parts.join(' · ');
}

// Circumferences: latest value per site vs that site's previous measurement (spec §10: neutral ink for now).
export function circRows(measurements) {
  const bySite = new Map();
  for (const m of measurements || []) {
    if (!m || m.deleted || typeof m.cm !== 'number' || !Number.isFinite(m.cm)) continue;
    if (!bySite.has(m.site)) bySite.set(m.site, new Map());
    const dates = bySite.get(m.site);
    if (!dates.has(m.date)) dates.set(m.date, []);
    dates.get(m.date).push(m.cm);
  }
  const rows = [];
  for (const s of SITES) {
    const dates = bySite.get(s.id);
    if (!dates) continue;
    const ds = [...dates.keys()].sort();
    const val = d => { const a = dates.get(d); return a.reduce((x, y) => x + y, 0) / a.length; };
    const last = ds[ds.length - 1], prev = ds.length > 1 ? ds[ds.length - 2] : null;
    const cm = val(last);
    rows.push({
      site: s.id, he: s.he, date: last, cm, cmText: fmtWeight(cm),
      prevDate: prev, change: prev ? changeView(cm - val(prev), null) : null
    });
  }
  return rows;
}

// Table caption: one date pair when every row shares it; otherwise each row shows its own (perRow true).
export function circCaption(rows) {
  const withPrev = rows.filter(r => r.prevDate);
  const dates = new Set(rows.map(r => r.date)), prevs = new Set(withPrev.map(r => r.prevDate));
  if (!rows.length) return { text: 'היקפים', perRow: false };
  if (dates.size === 1 && prevs.size <= 1) {
    const d = [...dates][0], p = [...prevs][0];
    return { date: fmtDay(d), prev: p ? fmtDay(p) : null, perRow: false };
  }
  return { perRow: true };
}

// Centre-zero scale −1..+1 kg/week. Returns x of the marker (clamped) and the stuck band, for a given width.
export function scaleGeometry(rate, width, pad = 14) {
  const lo = -1, hi = 1, w = width - 2 * pad;
  // LTR axis: −1 on the left, +1 on the right.
  const x = v => pad + ((v - lo) / (hi - lo)) * w;
  const r = rate === null ? null : roundN(rate, 2);
  return {
    x0: x(lo), x1: x(hi), zero: x(0), bandFrom: x(-STUCK), bandTo: x(STUCK),
    ticks: [-1, -0.5, 0, 0.5, 1].map(v => ({ x: x(v), label: v === 0 ? '0' : fmtSigned1(v) })),
    marker: r === null ? null : { x: x(Math.max(lo, Math.min(hi, r))), clipped: r < lo || r > hi }
  };
}
const fmtSigned1 = v => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(1);

export const RANGES = { month: 31, quarter: 92, all: Infinity };
const MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

// Nice y ticks: step from 0.5/1/2/5/10 giving at most 5 ticks, covering [min, max].
export function yTicks(min, max) {
  if (min === max) { min -= 1; max += 1; }
  for (const step of [0.5, 1, 2, 5, 10, 20, 50]) {
    const a = Math.floor(min / step + 1e-9) * step, b = Math.ceil(max / step - 1e-9) * step;
    const n = Math.round((b - a) / step) + 1;
    if (n <= 5) {
      const out = [];
      for (let k = 0; k < n; k++) out.push(roundN(a + k * step, 1));
      if (out.length < 2) out.push(roundN(a + step, 1));
      return out;
    }
  }
  return [min, max];
}

// Weight chart geometry for a series from trendSummary. Plain numbers and labels, drawn by the app.
export function weightChart(series, range, width, height = 210) {
  const padL = 34, padR = 12, padT = 12, padB = 30;
  if (!series.length) return null;
  const D = day(series[series.length - 1].date);
  const days = RANGES[range] ?? RANGES.quarter;
  const pts = series.filter(p => D - day(p.date) <= days);
  const vals = pts.flatMap(p => (p.avg === null ? [p.kg] : [p.kg, p.avg]));
  const ticks = yTicks(Math.min(...vals), Math.max(...vals));
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const d0 = day(pts[0].date), d1 = day(pts[pts.length - 1].date);
  const span = Math.max(d1 - d0, 1);
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const X = iso => (d1 === d0 ? padL + plotW / 2 : padL + ((day(iso) - d0) / span) * plotW);
  const Y = v => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const line = [];
  let cur = [];
  for (const p of pts) {
    if (p.avg === null) { if (cur.length) line.push(cur); cur = []; continue; }
    cur.push([X(p.date), Y(p.avg)]);
  }
  if (cur.length) line.push(cur);

  // x labels: first of each month in view; if fewer than 2, the first and last weigh-in dates.
  let xl = [];
  const s0 = new Date(d0 * 864e5);
  let yy = s0.getUTCFullYear(), mm = s0.getUTCMonth() + (s0.getUTCDate() === 1 ? 0 : 1);
  for (;;) {
    const f = new Date(Date.UTC(yy, mm, 1)); // Date.UTC rolls month 12 into next year
    if (f.getTime() / 864e5 > d1) break;
    xl.push({ x: X(iso(f)), label: MONTHS[f.getUTCMonth()] });
    yy = f.getUTCFullYear(); mm = f.getUTCMonth() + 1;
  }
  if (xl.length < 2) xl = [{ x: X(pts[0].date), label: fmtDay(pts[0].date) }, { x: X(pts[pts.length - 1].date), label: fmtDay(pts[pts.length - 1].date) }];
  const spaced = [];
  for (const t of xl) if (!spaced.length || t.x - spaced[spaced.length - 1].x >= 34) spaced.push(t);
  if (spaced.length === 2 && pts.length === 1) spaced.length = 1;

  const last = pts[pts.length - 1];
  return {
    width, height, padL, padR, padT, plotBottom: padT + plotH,
    y: ticks.map(v => ({ y: Y(v), label: Number.isInteger(v) ? String(v) : v.toFixed(1) })),
    x: spaced,
    dots: pts.slice(0, -1).map(p => ({ x: X(p.date), y: Y(p.kg) })),
    last: { x: X(last.date), y: Y(last.kg), label: fmtWeight(last.kg) },
    line, count: pts.length
  };
}
const iso = d => d.toISOString().slice(0, 10);
