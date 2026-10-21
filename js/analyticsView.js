// Analytics screen: words and chart geometry (pure, no DOM, no clock) so they can be tested.
// Numbers come from js/analytics.js (spec docs/specs/analytics.md); this file turns them into text and x/y.
import { day, EMPTY } from './trend.js';
import { PHASE_HE, TAG_HE, weightChart, fmtDay } from './report.js';
import { phaseBands, PCT_AXIS } from './analytics.js';

const addDays = (iso, n) => new Date((day(iso) + n) * 86400000).toISOString().slice(0, 10);
const signed = (v, dec) => (v === 0 ? '0' : (v < 0 ? '−' : '+') + Math.abs(v).toFixed(dec));
const BAND_LABEL_FULL = 95, BAND_LABEL_MIN = 40; // px; spec §1: no label under 40 px

// Figure 1: the weight chart of the verdict screen plus phase bands and open rings on tagged weigh-ins.
export function trendFigure(series, records, checkins, range, width) {
  const c = weightChart(series, range, width);
  if (!c) return null;
  const D = series[series.length - 1].date, right = width - c.padR;
  const bands = phaseBands(records, D, c.from).map((b, i) => {
    const x0 = c.xAt(b.x0), x1 = b.x1 < D ? Math.min(right, c.xAt(addDays(b.x1, 1))) : right;
    const w = x1 - x0;
    const label = w >= BAND_LABEL_FULL ? `${PHASE_HE[b.phase]} · מ־${fmtDay(b.from)}` : w >= BAND_LABEL_MIN ? PHASE_HE[b.phase] : null;
    return { x0, x1, label, shade: i % 2 };
  });
  const tags = new Set((checkins || []).filter(x => x && !x.deleted && TAG_HE[x.tag]).map(x => x.date));
  const dots = c.points.map((p, i) => ({ x: p.x, y: p.y, tagged: tags.has(p.date), last: i === c.points.length - 1 }));
  return { ...c, bands, dots, tooEarly: series.length < 4, anyTagged: dots.some(d => d.tagged) };
}

// Table 1: the %/week scale (0 → 1.25 % in the goal's direction, LTR) with the target band.
export function pctScale(view, width, pad = 14) {
  if (!view.scale) return null;
  const w = width - 2 * pad, x = f => pad + f * w;
  return {
    x0: x(0), x1: x(1),
    bandFrom: x(view.scale.band[0]), bandTo: x(view.scale.band[1]),
    ticks: [0, 0.25, 0.5, 0.75, 1].map(v => ({ x: x(v / PCT_AXIS), label: `${v}%` })),
    marker: { x: x(view.scale.frac), clipped: view.scale.clipped }
  };
}
const bandText = band => `${band[0]}–${band[1]}%`;
// The line under the rate: where it sits against the target band (ink; judges speed, not direction).
export function zoneText(view, phase) {
  if (!phase) return 'לא נבחר שלב, אין טווח יעד.';
  if (!view.band) return 'בתחזוקה אין טווח קצב. פסק הדין בודק שהמשקל יציב.';
  const of = `טווח היעד ל${PHASE_HE[phase]} (${bandText(view.band)} בשבוע)`;
  switch (view.zone) {
    case 'in': return `בתוך ${of}`;
    case 'below': return `איטי יותר מ${of}`;
    case 'above': return `מהיר יותר מ${of}`;
    case 'stuck': return `תקוע. ${of}`;
    case 'wrong_direction': return `בכיוון ההפוך מהיעד. ${of}`;
    default: return of;
  }
}

// Figure 2: 8 weekly bars, oldest on the left. Values sit outside the bar end; dashed lines mark a phase change.
export function barsFigure(wb, width, height = 214) {
  if (!wb.enough) return null;
  const padL = 40, padR = 8, padT = 34, plotBottom = height - 60;
  const bars = wb.bars.slice().reverse();
  const vals = bars.filter(b => b.delta !== null).map(b => b.delta);
  const ticks = barTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const lo = ticks.values[0], hi = ticks.values[ticks.values.length - 1];
  const plotW = width - padL - padR, slot = plotW / 8, bw = Math.max(12, Math.min(28, slot * 0.6));
  const Y = v => padT + (1 - (v - lo) / (hi - lo)) * (plotBottom - padT);
  const zero = Y(0), stagger = slot < 44; // narrow phones: every other value one line further out, so labels never touch
  const first = addDays(wb.bars[wb.bars.length - 1].end, -7), span = 56;
  const X = iso => padL + ((day(iso) - day(first)) / span) * plotW;
  return {
    width, height, padL, padR, padT, plotBottom, zero,
    y: ticks.values.map(v => ({ y: Y(v), label: signed(v, ticks.dec) })),
    bars: bars.map((b, i) => {
      const cx = padL + slot * (i + 0.5);
      const base = { cx, label: fmtDay(b.end) + (b.tagged ? '*' : ''), text: b.text, tagged: b.tagged };
      if (b.delta === null) return { ...base, empty: true, ty: zero - 6 };
      const yv = Y(b.delta), up = b.delta >= 0;
      return { ...base, x: cx - bw / 2, w: bw, y: Math.min(yv, zero), h: Math.max(1, Math.abs(yv - zero)), ty: up ? Math.min(yv, zero) - 5 - (stagger && i % 2 ? 14 : 0) : Math.max(yv, zero) + 14 + (stagger && i % 2 ? 14 : 0) };
    }),
    boundaries: wb.boundaries.map(X),
    anyTagged: bars.some(b => b.tagged)
  };
}
// y ticks for the bars: 0 always included, a step from a short list giving at most 5 ticks.
export function barTicks(min, max) {
  if (min === max) max = min + 0.1;
  for (const step of [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5]) {
    const a = Math.floor(min / step + 1e-9) * step, b = Math.ceil(max / step - 1e-9) * step;
    const n = Math.round((b - a) / step) + 1;
    if (n <= 5) {
      const values = Array.from({ length: Math.max(n, 2) }, (_, k) => Math.round((a + k * step) * 100) / 100);
      return { values, dec: step >= 1 ? 0 : Number.isInteger(step * 10) ? 1 : 2 };
    }
  }
  return { values: [min, max], dec: 2 };
}

// Table 2: the longest gap between weigh-ins, with its dates.
export function gapText(gap) {
  if (!gap) return { big: EMPTY, sub: null };
  return { big: String(gap.days), sub: gap.open ? `מ־${fmtDay(gap.from)} ועד היום` : `${fmtDay(gap.from)}–${fmtDay(gap.to)}` };
}

// Table 4: why "cm of waist per kg" is not shown.
export function waistPerKgText(r) {
  const moved = r.phase === 'bulk' ? 'שעלה' : 'שירד';
  const label = `ס״מ מותניים (טבור) לכל ק״ג ${moved}`;
  if (r.ratio !== null) return { label, reason: null };
  const reason = {
    no_phase: 'מחושב רק בחיטוב או במסה.',
    no_base: 'צריך מדידת טבור מתחילת השלב ועוד אחת אחריה.',
    no_trend: 'אין מספיק שקילות סביב תאריכי המדידה.',
    wrong_direction: 'המשקל זז בכיוון ההפוך מהיעד מאז תחילת השלב.',
    too_small: 'המשקל זז פחות מ־2 ק״ג מאז תחילת השלב.'
  }[r.reason];
  return { label, reason };
}

export const RECOMP_HE = {
  recomp: 'יש סימן: מותניים ירדו ויד עלתה',
  opposite: 'סימן הפוך: מותניים עלו ויד ירדה',
  none: 'אין סימן ברור',
  insufficient: 'אין מספיק נתונים'
};

// Table 5: goal projection as weeks + range + month, or the reason there is none.
export function projectionText(p) {
  if (p.reason === null) {
    const w = +p.weeksText;
    return { big: w < 1 ? 'פחות מ־1' : p.weeksText, unit: w <= 1 ? 'שבוע' : 'שבועות', range: `${p.fast}–${p.slow}`, month: p.monthText, target: p.target, reason: null };
  }
  const reason = {
    no_projection_phase: 'צפי מחושב רק בחיטוב או במסה.',
    no_target: 'לא הוגדר משקל יעד. אפשר להגדיר בכפתור השלב במסך הראשי.',
    too_early: 'מוקדם להגיד, אין עדיין קצב.',
    reached: 'הממוצע כבר הגיע ליעד.',
    provisional: 'הקצב עוד ראשוני, מוקדם לצפי.',
    stuck: 'הקצב תקוע, אין צפי.',
    wrong_direction: 'המשקל זז בכיוון ההפוך מהיעד, אין צפי.',
    too_far: 'יותר משנה בקצב הנוכחי.'
  }[p.reason];
  return { big: EMPTY, unit: null, range: null, month: null, target: null, reason };
}

// Header: the dates of all weigh-ins and how many there are.
export function spanText(series) {
  if (!series.length) return null;
  const a = series[0].date, b = series[series.length - 1].date;
  const n = series.length === 1 ? 'שקילה אחת' : `${series.length} שקילות`;
  return { from: fmtDay(a) + '.' + a.slice(0, 4), to: fmtDay(b) + '.' + b.slice(0, 4), count: n };
}

