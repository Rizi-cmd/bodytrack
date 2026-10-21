// Analytics screen: every number is computed here (pure, no storage, no DOM, no clock: the caller passes today).
// Exact definitions: docs/specs/analytics.md (v1). Section numbers below refer to that file.
import { SITES, isISODate } from './model.js';
import { day, roundN, weightDirection, fmtWeight, fmtChange, fmtRate, EMPTY } from './trend.js';
import { isPhaseRecord, activePhase, changeView, footnotes, TAG_HE } from './report.js';

const addDays = (iso, n) => new Date((day(iso) + n) * 86400000).toISOString().slice(0, 10);
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const SITE_IDS = new Set(SITES.map(s => s.id));
export const NOISE_NOTE = 'בתוך טעות המדידה';

// §0: measurements → Map(site → [{date, cm}]) ascending; bad records dropped, same site + date → mean.
export function cleanMeasurements(list) {
  const by = new Map();
  for (const m of Array.isArray(list) ? list : []) {
    if (!m || m.deleted === true || !isISODate(m.date) || !SITE_IDS.has(m.site)) continue;
    if (typeof m.cm !== 'number' || !Number.isFinite(m.cm) || m.cm < 5 || m.cm > 300) continue;
    if (!by.has(m.site)) by.set(m.site, new Map());
    const d = by.get(m.site);
    if (!d.has(m.date)) d.set(m.date, []);
    d.get(m.date).push(m.cm);
  }
  const out = new Map();
  for (const [site, d] of by) out.set(site, [...d.keys()].sort().map(date => ({ date, cm: mean(d.get(date)) })));
  return out;
}

const taggedDates = checkins => new Map((checkins || [])
  .filter(c => c && !c.deleted && TAG_HE[c.tag] && isISODate(c.date)).map(c => [c.date, c.tag]));

// §0: phase records → runs [{phase, from, to, targetKg}]. Same `from`: later record wins; same phase in a row merges.
export function phaseRuns(records, endDate) {
  const recs = (records || []).filter(isPhaseRecord).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const one = [];
  for (const r of recs) { // stable sort: on the same date the later one replaces the earlier
    if (one.length && one[one.length - 1].from === r.from) one[one.length - 1] = r; else one.push(r);
  }
  const runs = [];
  for (const r of one) {
    if (endDate && r.from > endDate) break;
    const t = r.targetKg ?? null;
    if (runs.length && runs[runs.length - 1].phase === r.phase) runs[runs.length - 1].targetKg = t;
    else runs.push({ phase: r.phase, from: r.from, to: null, targetKg: t });
  }
  runs.forEach((r, i) => { r.to = i + 1 < runs.length ? addDays(runs[i + 1].from, -1) : endDate; });
  return runs;
}
const runAt = (records, date) => { const rs = phaseRuns(records, date); return rs.length ? rs[rs.length - 1] : null; };
export const phaseStart = (records, today) => { const r = runAt(records, today); return r ? r.from : null; };

// §0: trend level on a date, interpolated between real average points at most maxGap days apart.
export function trendAt(series, iso, maxGap = 14) {
  let a = null, b = null;
  for (const s of series || []) {
    if (s.avg === null || s.avg === undefined) continue;
    if (s.date <= iso) a = s;
    if (s.date >= iso && !b) b = s;
  }
  if (a && a.date === iso) return a.avg;
  if (!a || !b) return null;
  const da = day(a.date), db = day(b.date);
  if (db - da > maxGap) return null;
  return a.avg + (b.avg - a.avg) * (day(iso) - da) / (db - da);
}

// §0: the site value closest to a date within ±tol days; tie → the earlier one.
export function siteAt(list, iso, tol = 14) {
  let best = null, dist = Infinity;
  for (const v of list || []) {
    const d = Math.abs(day(v.date) - day(iso));
    if (d <= tol && d < dist) { best = v; dist = d; } // ascending + strict < keeps the earlier on a tie
  }
  return best;
}

// §0.1: goal direction per metric and phase: −1 down, +1 up, 0 holding (weight only), null no colour.
const DIR = {
  weight:      { cut: -1, bulk: 1, maintenance: 0 },
  waist_navel: { cut: -1, maintenance: -1 },
  waist:       { cut: -1, maintenance: -1 },
  hips:        { cut: -1 },
  chest:       { bulk: 1 },
  thigh:       { bulk: 1 },
  shoulders:   { bulk: 1, maintenance: 1 },
  arm_relaxed: { bulk: 1, maintenance: 1 },
  arm_flexed:  { bulk: 1, maintenance: 1 },
  calf:        { bulk: 1, maintenance: 1 }
};
export function metricDirection(metric, phase) {
  if (metric === 'weight') return weightDirection(phase);
  return DIR[metric]?.[phase] ?? null;
}

// §0.2: smallest change (cm, after rounding to 1 decimal) that is coloured.
export const TAPE = {
  waist_navel: 1.0, waist: 1.0, hips: 1.0, thigh: 1.0,
  chest: 1.5, shoulders: 1.5,
  arm_relaxed: 0.5, arm_flexed: 0.5, calf: 0.5, neck: 0.5, wrist: 0.5
};
// A circumference change with arrow + word; coloured only past the tape error and only with a direction.
export function siteChange(delta, site, phase) {
  const big = Math.abs(roundN(delta, 1)) >= TAPE[site];
  const v = changeView(delta, big ? metricDirection(site, phase) : null);
  if (v && !v.zero && !big) v.noise = NOISE_NOTE;
  return v;
}

// §1: phase bands for figure 1 (dates only; the screen turns them into x).
export function phaseBands(records, D, firstVisible) {
  return phaseRuns(records, D)
    .map(r => ({ phase: r.phase, from: r.from, x0: r.from > firstVisible ? r.from : firstVisible, x1: r.to < D ? r.to : D }))
    .filter(b => b.x0 <= b.x1);
}

// §2: rate in kg/week and % of body weight vs the target band of the phase.
export const BANDS = { cut: [0.5, 1.0], bulk: [0.25, 0.5] };
export const PCT_AXIS = 1.25;
export function rateView(S, checkins) {
  const band = BANDS[S.phase] || null;
  const notes = footnotes(S, checkins);
  if (S.rate === null) return { kgText: EMPTY, pct: null, pctText: EMPTY, tone: 'ink', arrow: S.arrow, band, zone: null, scale: null, notes };
  const pct = 100 * S.rate / S.avg, p = roundN(pct, 2);
  let zone = null;
  if (band) {
    if (S.verdict === 'stuck') zone = 'stuck';
    else if (S.verdict === 'away') zone = 'wrong_direction';
    else {
      const m = S.phase === 'cut' ? -p : p;
      zone = m < band[0] ? 'below' : m > band[1] ? 'above' : 'in';
    }
  }
  let scale = null;
  if (band) {
    const m = S.phase === 'cut' ? -p : p;
    scale = { frac: Math.max(0, Math.min(1, m / PCT_AXIS)), clipped: m < 0 || m > PCT_AXIS, band: band.map(b => b / PCT_AXIS) };
  }
  return { kgText: fmtRate(S.rate), pct, pctText: fmtRate(pct) + '%', tone: S.colour, arrow: S.arrow, band, zone, scale, notes };
}

// §3: change in the trend per fixed 7-day bin ending at the last weigh-in; newest first.
export function weeklyBars(series, records, checkins) {
  if (!series || !series.length) return { bars: [], boundaries: [], enough: false };
  const D = series[series.length - 1].date;
  const ends = Array.from({ length: 9 }, (_, k) => addDays(D, -7 * k));
  const tags = [...taggedDates(checkins).keys()];
  const bars = [];
  for (let k = 0; k < 8; k++) {
    const a = trendAt(series, ends[k]), b = trendAt(series, ends[k + 1]);
    const delta = a === null || b === null ? null : a - b;
    bars.push({
      end: ends[k], delta, text: delta === null ? EMPTY : fmtRate(delta),
      tagged: tags.some(t => t > ends[k + 1] && t <= ends[k])
    });
  }
  const boundaries = phaseRuns(records, D).slice(1).map(r => r.from).filter(f => f > ends[8] && f <= D); // the first run's start is not a change
  return { bars, boundaries, enough: bars.some(b => b.delta !== null) };
}

// §4: residual SD of weigh-ins around a straight line over the last 8 weeks (or since the phase start).
export function volatility(points, records, checkins) {
  const none = { vol: null, text: EMPTY, n: 0, tagged: 0, sincePhase: false };
  if (!points || !points.length) return none;
  const D = points[points.length - 1].date, from = addDays(D, -55);
  let win = points.filter(p => p.date >= from), sincePhase = false;
  const ps = phaseStart(records, D);
  if (ps && ps > from) {
    const since = win.filter(p => p.date >= ps);
    if (since.length >= 6) { win = since; sincePhase = true; }
  }
  const n = win.length;
  const tags = taggedDates(checkins);
  const tagged = win.filter(p => tags.has(p.date)).length;
  if (n < 6 || day(win[n - 1].date) - day(win[0].date) < 21) return { ...none, n, tagged, sincePhase };
  const xs = win.map(p => day(p.date)), ys = win.map(p => p.kg);
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  const b = sxy / sxx;
  const ss = xs.reduce((s, x, i) => s + (ys[i] - (my + b * (x - mx))) ** 2, 0);
  const vol = Math.sqrt(ss / (n - 2));
  return { vol, text: '±' + fmtWeight(vol), n, tagged, sincePhase };
}

// §5: weigh-ins per week over the last 8 weeks (up to today) and the longest gap.
export function cadence(points, today) {
  const dates = (points || []).map(p => p.date);
  if (!dates.length) return { perWeek: null, perWeekText: EMPTY, gap: null };
  const E = day(today), first = day(dates[0]), D = day(dates[dates.length - 1]);
  let perWeek = null;
  if (E - first >= 27) {
    const W = Math.min(56, E - first + 1);
    const n = dates.filter(d => day(d) >= E - W + 1 && day(d) <= E).length;
    perWeek = n * 7 / W;
  }
  let gap = null;
  const consider = (a, b, open) => { const days = day(b) - day(a); if (!gap || days >= gap.days) gap = { days, from: a, to: b, open }; };
  for (let i = 1; i < dates.length; i++) if (day(dates[i]) >= E - 55) consider(dates[i - 1], dates[i], false);
  if (E > D) consider(dates[dates.length - 1], today, true);
  return { perWeek, perWeekText: perWeek === null ? EMPTY : fmtWeight(perWeek), gap };
}

// §6: circumference table: current value, change since phase start, change since last time.
export function circTable(measurements, records, today, checkins) {
  const clean = cleanMeasurements(measurements);
  const run = runAt(records, today), ps = run ? run.from : null, phase = run ? run.phase : null;
  const tags = taggedDates(checkins);
  const rows = [];
  for (const s of SITES) {
    const list = clean.get(s.id);
    if (!list) continue;
    const cur = list[list.length - 1], prev = list.length > 1 ? list[list.length - 2] : null;
    let base = ps ? siteAt(list, ps) : null;
    if (base && base.date >= cur.date) base = null;
    rows.push({
      site: s.id, he: s.he, date: cur.date, cm: cur.cm, cmText: fmtWeight(cur.cm),
      tag: tags.has(cur.date) ? TAG_HE[tags.get(cur.date)] : null,
      sinceStart: base ? { date: base.date, delta: cur.cm - base.cm, view: siteChange(cur.cm - base.cm, s.id, phase) } : null,
      sinceLast: prev ? { date: prev.date, delta: cur.cm - prev.cm, view: siteChange(cur.cm - prev.cm, s.id, phase) } : null
    });
  }
  const baseDates = new Set(rows.filter(r => r.sinceStart).map(r => r.sinceStart.date));
  return { rows, phaseStart: ps, phase, perRow: baseDates.size > 1 };
}

// §7: waist (narrowest) ÷ hips, from the latest day with both.
export function waistHip(measurements) {
  const c = cleanMeasurements(measurements);
  const hips = new Map((c.get('hips') || []).map(v => [v.date, v.cm]));
  const pair = (c.get('waist') || []).filter(v => hips.has(v.date)).pop();
  if (!pair) return { whr: null, text: EMPTY, date: null, reason: 'no_pair' };
  const whr = pair.cm / hips.get(pair.date);
  return { whr, text: roundN(whr, 2).toFixed(2), date: pair.date, reason: null };
}

const baseAndCurrent = (list, ps) => {
  if (!list || !list.length || !ps) return null;
  const cur = list[list.length - 1], base = siteAt(list, ps);
  return base && base.date < cur.date ? { base, cur, delta: cur.cm - base.cm } : null;
};

// §7: cm of waist (navel) per kg of trend since the phase start; cut or bulk only, at least 2 kg moved.
export const MIN_KG_FOR_RATIO = 2.0;
export function waistPerKg(measurements, series, records, today) {
  const run = runAt(records, today);
  const dir = run ? weightDirection(run.phase) : null;
  const out = reason => ({ ratio: null, text: EMPTY, errText: null, phase: run ? run.phase : null, reason });
  if (dir !== 1 && dir !== -1) return out('no_phase');
  const bc = baseAndCurrent(cleanMeasurements(measurements).get('waist_navel'), run.from);
  if (!bc) return out('no_base');
  const t1 = trendAt(series, bc.cur.date), t0 = trendAt(series, bc.base.date);
  if (t1 === null || t0 === null) return out('no_trend');
  const dkg = t1 - t0;
  if (Math.sign(dkg) !== dir) return out('wrong_direction');
  if (Math.abs(dkg) < MIN_KG_FOR_RATIO) return out('too_small');
  const ratio = bc.delta / dkg, err = (Math.SQRT2 * 0.7) / Math.abs(dkg);
  return { ratio, text: fmtWeight(ratio), err, errText: '±' + fmtWeight(err), phase: run.phase, dkg, dw: bc.delta, reason: null };
}

// §8: recomposition: waist down and arm up since the phase start (a tape pattern, not a measurement).
export function recomp(measurements, records, today) {
  const run = runAt(records, today);
  const c = cleanMeasurements(measurements);
  const none = { state: 'insufficient', waist: null, arm: null };
  if (!run) return none;
  const w = baseAndCurrent(c.get('waist_navel'), run.from);
  let armSite = 'arm_relaxed', a = baseAndCurrent(c.get(armSite), run.from);
  if (!a) { armSite = 'arm_flexed'; a = baseAndCurrent(c.get(armSite), run.from); }
  if (!w || !a) return none;
  const curDate = w.cur.date < a.cur.date ? w.cur.date : a.cur.date;
  if (day(curDate) - day(run.from) < 28) return none;
  const waist = { site: 'waist_navel', delta: w.delta, view: siteChange(w.delta, 'waist_navel', run.phase) };
  const arm = { site: armSite, delta: a.delta, view: siteChange(a.delta, armSite, run.phase) };
  const dW = roundN(w.delta, 1), dA = roundN(a.delta, 1);
  const state = dW <= -1.0 && dA >= 0.5 ? 'recomp' : dW >= 1.0 && dA <= -0.5 ? 'opposite' : 'none';
  return { state, waist, arm };
}

// §9: weeks to the target weight at the current rate, with a range and the month.
export const RATE_SE = 0.09;
const MONTHS_FULL = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
export function projection(S, records, today) {
  const rec = activePhase(records, today);
  const phase = rec ? rec.phase : null, dir = weightDirection(phase);
  const out = reason => ({ reason, weeks: null });
  if (dir !== 1 && dir !== -1) return out('no_projection_phase');
  const target = rec.targetKg ?? null;
  if (target === null) return out('no_target');
  if (S.rate === null) return out('too_early');
  const rem = target - S.avg;
  if (dir * rem <= 0) return out('reached');
  if (S.provisional) return out('provisional');
  if (S.verdict === 'stuck') return out('stuck');
  if (S.verdict === 'away') return out('wrong_direction');
  const weeks = rem / S.rate;
  if (weeks > 52) return { reason: 'too_far', weeks };
  const date = addDays(S.latest.date, Math.ceil(weeks * 7));
  const r = Math.abs(S.rate), a = Math.abs(rem);
  return {
    reason: null, weeks, weeksText: String(roundN(weeks, 0)),
    fast: roundN(a / (r + RATE_SE), 0), slow: roundN(a / (r - RATE_SE), 0),
    date, monthText: `${MONTHS_FULL[+date.slice(5, 7) - 1]} ${date.slice(0, 4)}`,
    target, extended: S.extended, spanDays: S.spanDays
  };
}

// §10: lowest and highest trend ever, and the best 28 days toward the goal in the current run.
export function records(series, phaseRecords, today) {
  const av = (series || []).filter(s => s.avg !== null && s.avg !== undefined);
  if (!av.length) return { low: null, high: null, best28: null };
  let low = av[0], high = av[0];
  for (const s of av) { if (s.avg < low.avg) low = s; if (s.avg > high.avg) high = s; }
  const run = runAt(phaseRecords, today);
  const dir = run ? weightDirection(run.phase) : null;
  let best28 = null;
  if (dir === 1 || dir === -1) {
    const inRun = av.filter(s => s.date >= run.from);
    for (const p of inRun) {
      const P = day(p.date);
      let ref = null, dist = Infinity;
      for (const s of inRun) {
        const d = day(s.date);
        if (d < P - 35 || d > P - 21) continue;
        if (Math.abs(d - (P - 28)) < dist) { dist = Math.abs(d - (P - 28)); ref = s; }
      }
      if (!ref) continue;
      const delta = p.avg - ref.avg;
      if (dir * delta > 0 && (!best28 || dir * delta > dir * best28.delta)) best28 = { delta, from: ref.date, to: p.date };
    }
  }
  return {
    low: { avg: low.avg, date: low.date, text: fmtWeight(low.avg) },
    high: { avg: high.avg, date: high.date, text: fmtWeight(high.avg) },
    best28: best28 && { ...best28, text: fmtChange(best28.delta) }
  };
}

// §11: US Navy body-fat estimate (Hodgdon & Beckett), inches and log10. An estimate, ±4 points at best.
export function navyBodyFat(measurements, settings) {
  const h = settings && settings.heightCm, sex = settings && settings.sex;
  const out = reason => ({ bf: null, text: EMPTY, reason });
  if (typeof h !== 'number' || !Number.isFinite(h) || h < 120 || h > 230) return out('no_height');
  if (sex !== 'male' && sex !== 'female') return out('no_sex');
  const c = cleanMeasurements(measurements);
  let date, parts;
  if (sex === 'male') {
    const ab = (c.get('waist_navel') || []).at(-1);
    if (!ab) return out('no_site');
    date = ab.date; parts = { abdomen: ab.cm };
  } else {
    const hips = new Map((c.get('hips') || []).map(v => [v.date, v.cm]));
    const w = (c.get('waist') || []).filter(v => hips.has(v.date)).pop();
    if (!w) return out('no_site');
    date = w.date; parts = { waist: w.cm, hips: hips.get(w.date) };
  }
  const neck = (c.get('neck') || []).filter(v => v.date <= date).pop();
  if (!neck || day(date) - day(neck.date) > 90) return out('no_neck');
  const inch = v => v / 2.54;
  const arg = sex === 'male' ? inch(parts.abdomen) - inch(neck.cm) : inch(parts.waist) + inch(parts.hips) - inch(neck.cm);
  if (arg <= 0) return out('bad_input');
  const bf = sex === 'male'
    ? 86.010 * Math.log10(arg) - 70.041 * Math.log10(inch(h)) + 36.76
    : 163.205 * Math.log10(arg) - 97.684 * Math.log10(inch(h)) - 78.387;
  if (!(bf >= 2 && bf <= 60)) return out('out_of_range');
  return { bf, text: String(roundN(bf, 0)) + '%', err: '±4', date, neckDate: neck.date, reason: null };
}
