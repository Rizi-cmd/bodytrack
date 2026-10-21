// Analytics screen (DOM only). Every number comes from js/analytics.js and js/analyticsView.js (pure, tested).
import { cleanWeighins, trendSummary, fmtWeight, EMPTY } from './trend.js';
import { PHASE_HE, tooEarlyReason, fmtDay } from './report.js';
import { rateView, weeklyBars, volatility, cadence, circTable, waistHip, waistPerKg, recomp, projection, records } from './analytics.js';
import { trendFigure, pctScale, zoneText, barsFigure, gapText, waistPerKgText, RECOMP_HE, projectionText, spanText } from './analyticsView.js';
import { SITE } from './model.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const num = (text, cls = 'n') => { const s = el('span', cls, text); s.dir = 'ltr'; return s; };
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, text) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, typeof v === 'number' ? v.toFixed(1) : v);
  if (text != null) e.textContent = text;
  return e;
};
const notes = (sel, list) => { const u = $(sel); u.replaceChildren(...list.map(t => el('li', null, t))); };
// A change shown as arrow + number + word (tone from analytics); noise gets a "*" for the footnote.
function changeEl(v) {
  const d = el('span', 'd ' + v.tone);
  if (v.zero) d.append(v.arrow + ' ' + v.word);
  else d.append(v.arrow + ' ', num(v.text), ' ' + v.word);
  if (v.noise) d.append('*');
  return d;
}

const view = { range: 'half', data: null };
const BAND_TOP = 20; // strip above the plot for the phase labels

function drawTrend() {
  const { S, phases, C } = view.data, box = $('#aChart');
  box.replaceChildren();
  const has = S.series.length > 0;
  $('#aChartEmpty').hidden = has; $('#aChartCap').hidden = !has; box.hidden = !has;
  document.querySelectorAll('[data-arange]').forEach(b => b.setAttribute('aria-pressed', b.dataset.arange === view.range));
  notes('#aChartNotes', has && S.series.length < 4 ? ['מוקדם להגיד: ממוצע 4 שקילות מתחיל מהשקילה הרביעית.'] : []);
  if (!has) return;
  const w = Math.max(260, Math.round(box.clientWidth || 350));
  const c = trendFigure(S.series, phases, C, view.range, w);
  const H = c.height + BAND_TOP;
  const svg = sv('svg', { width: w, height: H, viewBox: `0 0 ${w} ${H}`, role: 'img',
    'aria-label': `גרף מגמה: ${c.count === 1 ? 'שקילה אחת' : c.count + ' שקילות'}, ממוצע 4 שקילות ושלבים` });
  for (const b of c.bands) {
    svg.append(sv('rect', { class: b.shade ? 'phase-b' : 'phase-a', x: b.x0, y: 0, width: Math.max(0, b.x1 - b.x0), height: c.plotBottom + BAND_TOP }));
    if (b.label) svg.append(sv('text', { class: 'phase-t', x: b.x1 - 4, y: 14, 'text-anchor': 'end' }, b.label));
  }
  const g = sv('g', { transform: `translate(0,${BAND_TOP})` });
  for (const t of c.y) {
    g.append(sv('line', { class: 'grid', x1: c.padL, x2: w - c.padR, y1: t.y, y2: t.y }));
    g.append(sv('text', { class: 'ax', x: c.padL - 6, y: t.y + 4, 'text-anchor': 'end' }, t.label));
  }
  g.append(sv('line', { class: 'axis', x1: c.padL, x2: w - c.padR, y1: c.plotBottom, y2: c.plotBottom }));
  for (const t of c.x) {
    g.append(sv('line', { class: 'axis', x1: t.x, x2: t.x, y1: c.plotBottom, y2: c.plotBottom + 4 }));
    g.append(sv('text', { class: 'ax', x: t.x, y: c.plotBottom + 18, 'text-anchor': 'middle' }, t.label));
  }
  for (const seg of c.line) g.append(sv('polyline', { class: 'trend', points: seg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') }));
  for (const d of c.dots) {
    if (d.last) {
      g.append(sv('circle', { class: 'dot-now', cx: d.x, cy: d.y, r: 4.7 }));
      if (d.tagged) g.append(sv('circle', { class: 'dot-ring', cx: d.x, cy: d.y, r: 7.5, 'fill-opacity': 0 }));
    } else g.append(sv('circle', d.tagged ? { class: 'dot-ring', cx: d.x, cy: d.y, r: 3.6 } : { class: 'dot', cx: d.x, cy: d.y, r: 3.2 }));
  }
  svg.append(g); box.append(svg);
  $('#aKeyTag').hidden = !c.anyTagged;
}

function drawPct(rv) {
  const box = $('#aScale'); box.replaceChildren();
  const w = Math.max(240, Math.round(box.clientWidth || 350));
  const g = pctScale(rv, w);
  box.hidden = !g;
  if (!g) return;
  const dir = view.data.S.phase === 'cut' ? 'ירידה' : 'עלייה';
  const svg = sv('svg', { width: w, height: 80, viewBox: `0 0 ${w} 80`, role: 'img',
    'aria-label': `סרגל קצב באחוזים: ${rv.pctText} בשבוע, טווח יעד ${rv.band[0]} עד ${rv.band[1]} אחוז` });
  svg.append(sv('rect', { class: 'band', x: g.bandFrom, y: 14, width: g.bandTo - g.bandFrom, height: 24 }));
  svg.append(sv('text', { class: 'band-t', x: (g.bandFrom + g.bandTo) / 2, y: 10, 'text-anchor': 'middle' }, 'טווח היעד'));
  svg.append(sv('line', { class: 'axis', x1: g.x0, x2: g.x1, y1: 26, y2: 26 }));
  for (const t of g.ticks) {
    svg.append(sv('line', { class: 'tick', x1: t.x, x2: t.x, y1: 18, y2: 34 }));
    svg.append(sv('text', { class: 'ax', x: t.x, y: 52, 'text-anchor': 'middle' }, t.label));
  }
  const x = g.marker.x;
  svg.append(sv('path', { class: 'marker', d: `M${(x - 7).toFixed(1)},4 L${(x + 7).toFixed(1)},4 L${x.toFixed(1)},15 Z` }));
  svg.append(sv('line', { class: 'marker-l', x1: x, x2: x, y1: 14, y2: 38 }));
  if (g.marker.clipped) svg.append(sv('text', { class: 'val', x: (g.x0 + g.x1) / 2, y: 74, 'text-anchor': 'middle' }, `${rv.pctText} מחוץ לסרגל`));
  else svg.append(sv('text', { class: 'end-t', x: g.x1, y: 74, 'text-anchor': 'end' }, `${dir} מהירה יותר →`));
  box.append(svg);
}

function drawBars() {
  const { wb } = view.data, box = $('#aBars');
  box.replaceChildren();
  const w = Math.max(260, Math.round(box.clientWidth || 350));
  const f = barsFigure(wb, w);
  $('#aBarsEmpty').hidden = !!f; box.hidden = !f;
  const n = [];
  if (f && f.boundaries.length) n.push('קו מקווקו: החלפת שלב.');
  if (f && f.anyTagged) n.push('כוכבית ליד תאריך: באותו שבוע יש שקילה מסומנת (מחלה, חופשה או אירוע).');
  if (f) n.push('כל עמודה: כמה הממוצע זז בשבוע שמסתיים בתאריך שמתחתיה.');
  notes('#aBarsNotes', n);
  if (!f) return;
  const svg = sv('svg', { width: w, height: f.height, viewBox: `0 0 ${w} ${f.height}`, role: 'img', 'aria-label': 'שינוי שבועי בממוצע, 8 שבועות: ' +
    f.bars.map(b => `${b.label} ${b.text}`).join(', ') });
  for (const t of f.y) {
    svg.append(sv('line', { class: t.label === '0' ? 'axis' : 'grid', x1: f.padL, x2: w - f.padR, y1: t.y, y2: t.y }));
    svg.append(sv('text', { class: 'ax', x: f.padL - 6, y: t.y + 4, 'text-anchor': 'end' }, t.label));
  }
  for (const x of f.boundaries) svg.append(sv('line', { class: 'hl-line', x1: x, x2: x, y1: f.padT - 10, y2: f.plotBottom }));
  for (const b of f.bars) {
    if (!b.empty) svg.append(sv('rect', { class: 'bar', x: b.x, y: b.y, width: b.w, height: b.h }));
    svg.append(sv('text', { class: b.empty ? 'ax' : 'val', x: b.cx, y: b.ty, 'text-anchor': 'middle' }, b.text));
    svg.append(sv('text', { class: 'ax', x: b.cx, y: f.height - 8, 'text-anchor': 'middle' }, b.label));
  }
  box.append(svg);
}

function fillRate() {
  const { S, rv, n } = view.data;
  $('#aKg').textContent = rv.kgText; $('#aPct').textContent = rv.pctText;
  $('#aKgBox').className = 'v ' + rv.tone; $('#aPctBox').className = 'v ' + rv.tone;
  const word = $('#aRateWord');
  word.className = 'd ' + rv.tone;
  const arrow = { down: '↓', up: '↑', flat: '→' }[S.arrow] || '';
  const label = { toward: 'לכיוון היעד', away: 'בכיוון ההפוך מהיעד', holding: 'יציב, בתחזוקה זה היעד', stuck: 'תקוע', no_phase: 'לא נבחר שלב' }[S.verdict];
  word.textContent = S.rate === null ? tooEarlyReason(S.reason, n) : label ? `${arrow} ${label}` : arrow;
  $('#aZone').textContent = S.rate === null ? '' : zoneText(rv, S.phase);
  notes('#aRateNotes', S.rate === null ? [] : rv.notes);
}

function fillData() {
  const { vol, cad } = view.data;
  $('#aVol').textContent = vol.vol === null ? 'אין מספיק נתונים' : vol.text;
  $('#aVol').className = vol.vol === null ? 'lab' : 'n';
  $('#aVolUnit').hidden = vol.vol === null;
  $('#aVolLab').textContent = vol.sincePhase ? 'תנודתיות סביב המגמה, מתחילת השלב' : 'תנודתיות סביב המגמה, 8 השבועות האחרונים';
  $('#aPerWeek').textContent = cad.perWeekText;
  const g = gapText(cad.gap);
  $('#aGap').textContent = g.big; $('#aGapUnit').hidden = !cad.gap;
  const gs = $('#aGapSub'); gs.replaceChildren();
  if (cad.gap) gs.append('(', ...(cad.gap.open ? ['מ־', num(fmtDay(cad.gap.from)), ' ועד היום'] : [num(`${fmtDay(cad.gap.from)}–${fmtDay(cad.gap.to)}`)]), ')');
  const n = [];
  if (vol.vol !== null && vol.tagged) n.push(vol.tagged === 1 ? 'בחישוב התנודתיות יש שקילה מסומנת אחת.' : `בחישוב התנודתיות יש ${vol.tagged} שקילות מסומנות.`);
  notes('#aDataNotes', n);
}

function fillCirc() {
  const { ct } = view.data, tb = $('#aCirc');
  tb.replaceChildren();
  $('#aCircEmpty').hidden = ct.rows.length > 0; tb.hidden = !ct.rows.length;
  if (!ct.rows.length) { notes('#aCircNotes', []); return; }
  const head = el('tr');
  const since = el('th', 'dl');
  if (ct.phaseStart) since.append('מ־', num(fmtDay(ct.phaseStart)));
  else since.append('מתחילת השלב');
  // A date shared by every row goes in the header once; otherwise each row shows its own.
  const one = list => (new Set(list).size === 1 ? list[0] : null);
  const curDate = one(ct.rows.map(r => r.date));
  const lastDate = one(ct.rows.filter(r => r.sinceLast).map(r => r.sinceLast.date));
  const cmHead = el('th', 'dl', 'ס״מ');
  if (curDate) cmHead.append(', ', num(fmtDay(curDate)));
  const lastHead = el('th', 'dl');
  if (lastDate) lastHead.append('מ־', num(fmtDay(lastDate)));
  else lastHead.append('מהקודם');
  head.append(el('th', null, 'אזור'), cmHead, since, lastHead);
  tb.append(head);
  let noise = false;
  const cell = (c, perRowDate) => {
    const td = el('td', 'dl');
    if (!c) { td.append(EMPTY); return td; }
    if (c.view.noise) noise = true;
    td.append(changeEl(c.view));
    if (perRowDate) td.append(el('br'), el('span', 'lab rowdate', 'מ־' + fmtDay(c.date)));
    return td;
  };
  for (const r of ct.rows) {
    const tr = el('tr');
    const name = el('td', null, r.he);
    const sub = [curDate ? null : fmtDay(r.date), r.tag].filter(Boolean).join(' · ');
    if (sub) name.append(el('br'), el('span', 'lab rowdate', sub));
    tr.append(name, Object.assign(el('td', 'num'), { dir: 'ltr' }), cell(r.sinceStart, ct.perRow), cell(r.sinceLast, !lastDate));
    tr.children[1].append(num(r.cmText));
    tb.append(tr);
  }
  const n = [];
  if (noise) n.push('כוכבית ליד שינוי: בתוך טעות המדידה. השינוי קטן מכדי לדעת אם הוא אמיתי, אז הוא לא צבוע.');
  if (!ct.phase) n.push('לא נבחר שלב, אז אין צבע ואין השוואה לתחילת השלב.');
  notes('#aCircNotes', n);
}

function fillRatios() {
  const { whr, wpk, rc } = view.data;
  $('#aWhr').textContent = whr.text;
  const wl = $('#aWhrLab'); wl.replaceChildren('מותן ÷ ישבן');
  if (whr.date) wl.append(' · ', num(fmtDay(whr.date)));
  else wl.append(' · אין מדידה של שניהם באותו יום');
  const wt = waistPerKgText(wpk);
  $('#aWpk').textContent = wpk.ratio === null ? EMPTY : wpk.text;
  $('#aWpkErr').textContent = wpk.ratio === null ? '' : wpk.errText;
  const lab = $('#aWpkLab'); lab.replaceChildren(wt.label);
  if (wt.reason) lab.append(el('br'), wt.reason);
  $('#aRecomp').textContent = RECOMP_HE[rc.state];
  const f = $('#aRecompFacts'); f.replaceChildren();
  if (rc.waist && rc.arm) {
    f.append(SITE[rc.waist.site].he + ' ', changeEl(rc.waist.view), ' · ', SITE[rc.arm.site].he + ' ', changeEl(rc.arm.view), ' (מתחילת השלב)');
  }
}

function fillProjection() {
  const { pr, rec, phaseName } = view.data;
  const p = projectionText(pr);
  $('#aProj').textContent = p.big;
  $('#aProjUnit').textContent = p.unit || '';
  const lab = $('#aProjLab'); lab.replaceChildren();
  if (p.reason) lab.append(p.reason);
  else lab.append('עד היעד ', num(fmtWeight(p.target)), ' ק״ג (טווח ', num(p.range), ' שבועות, בערך ', p.month, ')', el('br'),
    'הערכה, אם הקצב יישאר כמו עכשיו.');
  if (!p.reason && pr.extended) lab.append(el('br'), `הקצב חושב על פני ${Math.round(pr.spanDays / 7)} שבועות, כי היו מעט שקילות בחודש האחרון.`);
  $('#aLow').textContent = rec.low ? rec.low.text : EMPTY;
  $('#aHigh').textContent = rec.high ? rec.high.text : EMPTY;
  const dl = (id, base, r) => { const e = $(id); e.replaceChildren(base); if (r) e.append(' · ', num(fmtDay(r.date))); };
  dl('#aLowLab', 'הממוצע הנמוך ביותר', rec.low);
  dl('#aHighLab', 'הממוצע הגבוה ביותר', rec.high);
  $('#aBest').textContent = rec.best28 ? rec.best28.text : EMPTY;
  const bl = $('#aBestLab'); bl.replaceChildren(`28 הימים הכי טובים לכיוון היעד${phaseName ? ' (בשלב הנוכחי)' : ''}`);
  if (rec.best28) bl.append(' · ', num(`${fmtDay(rec.best28.from)}–${fmtDay(rec.best28.to)}`));
  else if (!phaseName || phaseName === PHASE_HE.maintenance) bl.append(' · רק בחיטוב או במסה');
}

// Recompute everything from the stored records (after any edit, delete or undo the caller calls this again).
export function renderAnalytics({ W, M, C, phases, today }) {
  const S = trendSummary(W, phases, today);
  const points = cleanWeighins(W);
  view.data = {
    S, phases, C, n: S.series.length,
    rv: rateView(S, C),
    wb: weeklyBars(S.series, phases, C),
    vol: volatility(points, phases, C),
    cad: cadence(points, today),
    ct: circTable(M, phases, today, C),
    whr: waistHip(M),
    wpk: waistPerKg(M, S.series, phases, today),
    rc: recomp(M, phases, today),
    pr: projection(S, phases, today),
    rec: records(S.series, phases, today),
    phaseName: S.phase ? PHASE_HE[S.phase] : null
  };
  const sp = spanText(S.series), meta = $('#aMeta');
  meta.replaceChildren();
  if (sp) meta.append(num(`${sp.from}–${sp.to}`), ' · ' + sp.count);
  redraw();
  fillRate(); fillData(); fillCirc(); fillRatios(); fillProjection();
}
// Charts depend on the width: redraw on resize and range change.
export function redraw() {
  if (!view.data) return;
  drawTrend(); drawBars(); drawPct(view.data.rv);
}
document.querySelectorAll('[data-arange]').forEach(b => b.onclick = () => { view.range = b.dataset.arange; drawTrend(); });

