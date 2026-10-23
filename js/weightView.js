// Weight page ("המסע"): every text, number and chart coordinate the screen shows. Pure: no DOM, no clock.
// Numbers come from js/journey.js, js/trend.js, js/analytics.js. Spec: docs/specs/weight-page.md, mockup docs/design/weight-page.html.
import { day, fmtWeight, fmtRate, weightDirection } from './trend.js';
import { rateView } from './analytics.js';
import { PHASE_HE, BANDS, MIN_WEIGHINS, STALE_DAYS, activePhase, fmtDay, lastWeighinLine, tooEarlyReason } from './report.js';
import { weightHero, journeyPoints, journeyProjection, kgLeft } from './journey.js';

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
export const MONTHS_SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
export const MIN_SPAN_KG = 2;      // the Y axis never spans less than 2 kg (mockup), so noise doesn't look like a cliff
export const TICK_GAP_PX = 52;     // month labels at least this far apart; otherwise every 2nd / 3rd / 6th / 12th month
const isoOf = d => new Date(d * 86400000).toISOString().slice(0, 10);

// Top right of the page: "יום שישי, 23 באוקטובר".
export function dayHeading(iso) {
  const d = new Date(day(iso) * 86400000);
  return `יום ${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ב${MONTHS[d.getUTCMonth()]}`;
}

// Y range in kg: every value drawn, at least MIN_SPAN_KG wide, 8% air above and below.
export function yRange(values) {
  let lo = Math.min(...values), hi = Math.max(...values);
  if (hi - lo < MIN_SPAN_KG) { const c = (hi + lo) / 2; lo = c - MIN_SPAN_KG / 2; hi = c + MIN_SPAN_KG / 2; }
  const pad = (hi - lo) * 0.08;
  return { lo: lo - pad, hi: hi + pad };
}

// Month ticks on the 1st of each month between t0 and t1 (day numbers). Thinned so labels never crowd:
// step 1, 2, 3, 6 or 12 months, kept on months that divide by the step (January always stays when it is in range).
// January carries the year when the span crosses a year.
export function monthTicks(t0, t1, width) {
  const pxMonth = width / Math.max(t1 - t0, 1) * 30.44;
  const step = [1, 2, 3, 6, 12].find(s => s * pxMonth >= TICK_GAP_PX) ?? 12;
  const a = isoOf(t0), b = isoOf(t1), years = a.slice(0, 4) !== b.slice(0, 4);
  const out = [];
  let y = +a.slice(0, 4), m = +a.slice(5, 7) - 1;
  if (+a.slice(8, 10) !== 1) m++;
  for (;; m++) {
    if (m > 11) { m = 0; y++; }
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-01`, t = day(iso);
    if (t > t1) break;
    if (m % step === 0) out.push({ t, label: MONTHS_SHORT[m] + (years && m === 0 ? ` ${y}` : '') });
  }
  return out;
}

const n = text => ({ n: text });   // a number inside a text line: the screen shows it LTR

// Phase row (§6): "שלב: חיטוב · מ-1.9 · יעד 78.0", "הגעת ליעד · שינוי שלב", "לא נבחר שלב · בחירת שלב".
export function phaseRow(rec, reached) {
  if (!rec) return ['לא נבחר שלב · בחירת שלב'];
  if (reached) return ['הגעת ליעד · שינוי שלב'];
  const parts = [`שלב: ${PHASE_HE[rec.phase]} · מ-`, n(fmtDay(rec.from))];
  const dir = weightDirection(rec.phase);
  if (dir === 1 || dir === -1) parts.push(...(rec.targetKg != null ? [' · יעד ', n(fmtWeight(rec.targetKg))] : [' · הגדרת יעד']));
  return parts;
}

// The whole page. S = trendSummary(weighins, records, today); records = phase records.
export function weightPage(S, records, today) {
  const series = S.series, count = series.length;
  const rec = activePhase(records, today), dir = weightDirection(rec ? rec.phase : null);
  const goal = dir === 1 || dir === -1, target = goal && rec.targetKg != null ? rec.targetKg : null;
  const left = kgLeft(S, records, today);
  const out = { heading: dayHeading(today), empty: !count, phase: phaseRow(rec, left === 'הושג') };
  if (!count) return out;

  const D = series[count - 1].date, J = journeyPoints(series, records, today);
  const proj = journeyProjection(S, records, today), rv = rateView(S, []);
  const band = BANDS[S.phase] || null;
  out.hero = weightHero(S);

  // §7 grid: kg/week · %/week (target band under it) · kg left. Under 5 weigh-ins all three are "—".
  const rateOk = S.rate !== null && count >= MIN_WEIGHINS;
  out.grid = [
    { v: rateOk ? fmtRate(S.rate) : '—', lab: 'ק״ג לשבוע' },
    { v: rateOk ? rv.pctText : '—', lab: 'מהמשקל לשבוע', sub: band ? `${band[0]}–${band[1]}%` : '' },
    { v: left ?? '—', lab: dir === 0 ? 'בתחזוקה אין יעד' : target === null ? 'אין יעד' : 'ק״ג עד היעד' }
  ];
  out.note = rateOk ? '' : count < MIN_WEIGHINS ? `מוקדם להגיד. צריך לפחות ${MIN_WEIGHINS} שקילות.` : tooEarlyReason(S.reason, count);

  // §5/§7 rows: projection (or its reason for stale / too far), then the last weigh-in unless the hero is that weigh-in.
  out.rows = [];
  if (proj.reason === null) out.rows.push({ key: 'צפי', month: proj.monthText, weeks: proj.weeksText, range: proj.fast !== proj.slow ? `${proj.fast}–${proj.slow}` : '' });
  else if (proj.reason === 'stale' || proj.reason === 'too_far') out.rows.push({ key: 'צפי', reason: proj.text });
  if (out.hero.isAvg) {
    const line = lastWeighinLine(series, today);
    out.rows.push({ key: 'שקילה אחרונה', kg: fmtWeight(S.latest.kg), date: fmtDay(D), ago: line.ago });
  }
  out.cap = proj.line ? 'הערכה, אם הקצב יישאר כמו עכשיו' : '';

  // Figure 1: day numbers on X, kg on Y. Nothing drawn → no figure.
  const segs = J.segments.map(s => s.map(p => ({ t: day(p.date), kg: p.kg })));
  const raw = J.raw.map(p => ({ t: day(p.date), kg: p.kg }));
  if (!segs.length && !raw.length) { out.chart = null; return out; }
  const start = J.start ? { t: day(J.start.date), kg: J.start.kg, label: fmtWeight(J.start.kg) } : null;
  const end = proj.line ? { t: day(proj.line.to.date), kg: target, label: MONTHS_SHORT[+proj.line.to.date.slice(5, 7) - 1] } : null;
  const stale = day(today) - day(D) > STALE_DAYS;
  const ts = [...segs.flat(), ...raw].map(p => p.t);
  if (start) ts.push(start.t);
  const t0 = Math.min(...ts), last = Math.max(day(D), day(today), end ? end.t : -Infinity);
  const span = Math.max(last - t0, 14);
  const kgs = [...segs.flat(), ...raw].map(p => p.kg);
  if (start) kgs.push(start.kg);
  if (target !== null) kgs.push(target);
  out.chart = {
    segments: segs, raw, start, end,
    target, targetLabel: target === null ? '' : `יעד ${fmtWeight(target)}`,
    headLabel: segs.length ? (D === today ? 'היום' : fmtDay(D)) : '',
    todayT: stale ? day(today) : null,
    t0, t1: t0 + span + Math.max(2, span * 0.06),
    y: yRange(kgs)
  };
  out.figCap = !rec ? 'מהשקילה הראשונה' : target !== null ? 'מתחילת השלב עד היעד' : 'מתחילת השלב';
  out.key = segs.length
    ? ['נקודה = ממוצע שבועי', start ? `○ ${rec ? 'תחילת השלב' : 'השקילה הראשונה'}` : '', end ? '┄ צפי' : ''].filter(Boolean).join(' · ')
    : 'נקודה = שקילה';
  return out;
}
