// Phase 1 UI: verdict screen (Swiss Lab), history, phase, backup/restore.
// Every number shown comes from js/trend.js and js/report.js (pure, tested).
import { SITES, fmtDate, fmtCm, todayISO } from './model.js';
import { getAll, put, getMeta, requestPersistence } from './db.js';
import { validate, restore, shareBackup } from './backup.js';
import { trendSummary, fmtRate, fmtWeight, EMPTY } from './trend.js';
import {
  PHASE_HE, isPhaseRecord, phasePick, activePhase, parseTarget, circCaption, verdictText, changeView, footnotes, circRows, scaleGeometry, weightChart, fmtDay, fmtFull
} from './report.js';

export const VERSION = '0.2.3';
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, text) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, typeof v === 'number' ? v.toFixed(1) : v);
  if (text != null) e.textContent = text;
  return e;
};

let toastT;
function toast(msg, ms = 3500) {
  $('#toastMsg').textContent = msg; $('#toast').hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { $('#toast').hidden = true; }, ms);
}

let state = { summary: null, range: 'quarter', phases: [] };

function drawScale(rate) {
  const box = $('#scale'); box.replaceChildren();
  const w = Math.max(240, Math.round(box.clientWidth || 350));
  const g = scaleGeometry(rate, w);
  const svg = sv('svg', { width: w, height: 80, viewBox: `0 0 ${w} 80`, role: 'img',
    'aria-label': rate === null ? 'סרגל קצב: אין עדיין קצב' : `סרגל קצב: ${fmtRate(rate)} ק״ג בשבוע` });
  svg.append(sv('rect', { class: 'band', x: g.bandFrom, y: 14, width: g.bandTo - g.bandFrom, height: 24 }));
  svg.append(sv('text', { class: 'band-t', x: g.zero, y: 10, 'text-anchor': 'middle' }, 'תקוע'));
  svg.append(sv('line', { class: 'axis', x1: g.x0, x2: g.x1, y1: 26, y2: 26 }));
  for (const t of g.ticks) {
    svg.append(sv('line', { class: 'tick', x1: t.x, x2: t.x, y1: 18, y2: 34 }));
    svg.append(sv('text', { class: 'ax', x: t.x, y: 52, 'text-anchor': 'middle' }, t.label));
  }
  if (g.marker) {
    const x = g.marker.x;
    if (g.marker.clipped) {
      svg.append(sv('text', { class: 'val', x: g.zero, y: 74, 'text-anchor': 'middle' }, `${fmtRate(rate)} מחוץ לסרגל`));
    }
    svg.append(sv('path', { class: 'marker', d: `M${(x - 7).toFixed(1)},4 L${(x + 7).toFixed(1)},4 L${x.toFixed(1)},15 Z` }));
    svg.append(sv('line', { class: 'marker-l', x1: x, x2: x, y1: 14, y2: 38 }));
  }
  svg.append(sv('text', { class: 'end-t', x: g.x0, y: 74, 'text-anchor': 'start' }, '← ירידה'));
  svg.append(sv('text', { class: 'end-t', x: g.x1, y: 74, 'text-anchor': 'end' }, 'עלייה →'));
  box.append(svg);
}

function drawChart() {
  const s = state.summary, box = $('#chart');
  box.replaceChildren();
  const has = s && s.series.length;
  $('#chartEmpty').hidden = !!has; $('#chartCap').hidden = !has; box.hidden = !has;
  if (!has) return;
  const w = Math.max(260, Math.round(box.clientWidth || 350));
  const c = weightChart(s.series, state.range, w);
  const svg = sv('svg', { width: w, height: c.height, viewBox: `0 0 ${w} ${c.height}`, role: 'img',
    'aria-label': `גרף משקל: ${c.count === 1 ? 'שקילה אחת' : c.count + ' שקילות'} וממוצע 4 שקילות` });
  for (const t of c.y) {
    svg.append(sv('line', { class: 'grid', x1: c.padL, x2: w - c.padR, y1: t.y, y2: t.y }));
    svg.append(sv('text', { class: 'ax', x: c.padL - 6, y: t.y + 4, 'text-anchor': 'end' }, t.label));
  }
  svg.append(sv('line', { class: 'axis', x1: c.padL, x2: w - c.padR, y1: c.plotBottom, y2: c.plotBottom }));
  for (const t of c.x) {
    svg.append(sv('line', { class: 'axis', x1: t.x, x2: t.x, y1: c.plotBottom, y2: c.plotBottom + 4 }));
    svg.append(sv('text', { class: 'ax', x: t.x, y: c.plotBottom + 18, 'text-anchor': 'middle' }, t.label));
  }
  for (const seg of c.line) svg.append(sv('polyline', { class: 'trend', points: seg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') }));
  for (const d of c.dots) svg.append(sv('circle', { class: 'dot', cx: d.x, cy: d.y, r: 3.2 }));
  svg.append(sv('circle', { class: 'dot-last', cx: c.last.x, cy: c.last.y, r: 4.7 }));
  const below = c.last.y < c.plotBottom - 24;
  svg.append(sv('text', { class: 'val', x: c.last.x - 8, y: below ? c.last.y + 18 : c.last.y - 10, 'text-anchor': 'end' }, c.last.label));
  box.append(svg);
  $('#chartCount').textContent = c.count === 1 ? 'שקילה אחת' : `${c.count} שקילות`;
  document.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', b.dataset.range === state.range));
}

function renderVerdict(W, M, C) {
  const s = state.summary = trendSummary(W, state.phases, todayISO());
  const n = s.series.length;
  const v = verdictText(s, n);

  $('#meta').textContent = `היום ${fmtFull(todayISO())}`;
  $('#phaseBtn').textContent = s.phase ? `${PHASE_HE[s.phase]} ▾` : 'בחירת שלב ▾';
  const vw = $('#vWord'); vw.className = 'vword ' + v.tone;
  vw.textContent = (v.arrow ? v.arrow + ' ' : '') + v.word;
  $('#vLabel').textContent = v.label;
  $('#rate').textContent = s.rate === null ? EMPTY : fmtRate(s.rate);
  drawScale(s.rate);
  const notes = $('#notes'); notes.replaceChildren();
  for (const t of footnotes(s, C)) notes.append(el('li', null, t));

  $('#avg').textContent = fmtWeight(s.avg);
  const mc = changeView(s.monthChange, s.direction);
  $('#mc').textContent = mc ? mc.text : EMPTY;
  $('#mcBox').className = 'v ' + (mc ? mc.tone : 'ink');
  const mw = $('#mcWord'); mw.className = 'd ' + (mc ? mc.tone : 'ink');
  mw.textContent = mc ? `${mc.arrow} ${mc.word}` : '';
  $('#lastKg').textContent = s.latest ? fmtWeight(s.latest.kg) : EMPTY;
  const ll = $('#lastLab'); ll.replaceChildren('שקילה אחרונה');
  if (s.latest) { const dd = el('span', 'n', fmtDay(s.latest.date)); dd.dir = 'ltr'; ll.append(' · ', dd); }
  drawChart();

  const rows = circRows(M), tb = $('#circTable'), cap = circCaption(rows);
  const h = $('#circTitle'); h.replaceChildren('טבלה 1 · היקפים');
  if (!cap.perRow && cap.date) {
    const d = el('span', 'n', cap.date); d.dir = 'ltr'; h.append(', ', d);
    if (cap.prev) { const p = el('span', 'n', cap.prev); p.dir = 'ltr'; h.append(' מול ', p); }
  }
  tb.replaceChildren();
  $('#circEmpty').hidden = rows.length > 0; tb.hidden = !rows.length;
  for (const r of rows) {
    const tr = el('tr');
    tr.append(el('td', null, r.he));
    const num = el('td', 'num'); num.append(el('span', 'n', r.cmText), ' ', el('span', 'lab', 'ס״מ'));
    num.firstChild.dir = 'ltr';
    const dl = el('td', 'dl');
    if (r.change) {
      const d = el('span', 'd ' + r.change.tone);
      const nn = el('span', 'n', r.change.text); nn.dir = 'ltr';
      if (r.change.zero) d.append(r.change.arrow + ' ' + r.change.word);
      else d.append(r.change.arrow + ' ', nn, ' ' + r.change.word);
      dl.append(d);
    } else dl.append(el('span', 'lab', 'מדידה ראשונה'));
    if (cap.perRow) {
      const when = el('span', 'lab rowdate', r.prevDate ? `${fmtDay(r.date)} מול ${fmtDay(r.prevDate)}` : fmtDay(r.date));
      tr.firstChild.append(el('br'), when);
    }
    tr.append(num, dl); tb.append(tr);
  }

}

async function render() {
  const W = (await getAll('weighins')).filter(w => !w.deleted).sort((a, b) => a.date.localeCompare(b.date));
  const M = (await getAll('measurements')).filter(m => !m.deleted);
  const C = await getAll('checkins');
  state.phases = (await getAll('goals')).filter(isPhaseRecord)
    .sort((a, b) => (a.at || 0) - (b.at || 0));
  const has = W.length || M.length;
  renderVerdict(W, M, C);

  const lw = $('#listW'); lw.replaceChildren();
  if (!W.length) lw.append(el('p', 'empty', 'אין שקילות.'));
  W.slice().reverse().forEach(w => {
    const r = el('div', 'row'); const b = el('b', 'n', fmtWeight(w.kg)); b.dir = 'ltr';
    r.append(el('span', 'dt', fmtDate(w.date)), b); lw.append(r);
  });

  const days = new Map();
  for (const m of M) { if (!days.has(m.date)) days.set(m.date, []); days.get(m.date).push(m); }
  const lm = $('#listM'); lm.replaceChildren();
  if (!days.size) lm.append(el('p', 'empty', 'אין מדידות.'));
  [...days.keys()].sort().reverse().forEach(d => {
    const box = el('div', 'mday'); box.append(el('h3', null, fmtDate(d)));
    const g = el('div', 'mgrid');
    const byId = Object.fromEntries(days.get(d).map(m => [m.site, m]));
    SITES.filter(s => byId[s.id]).forEach(s => {
      const sp = el('span'); sp.append(el('span', null, s.he), el('b', null, fmtCm(byId[s.id].cm))); g.append(sp);
    });
    box.append(g); lm.append(box);
  });

  const lb = await getMeta('lastBackup');
  $('#backupInfo').textContent = lb ? `גיבוי אחרון: ${fmtDate(lb.slice(0, 10))}` : 'עוד לא נשמר גיבוי.';
  const stale = !lb || (Date.now() - Date.parse(lb)) > 30 * 864e5;
  const nag = $('#backupNag');
  nag.hidden = !(has && stale);
  nag.textContent = lb ? 'עבר יותר מחודש מהגיבוי האחרון.' : 'יש נתונים במכשיר ואין להם גיבוי עדיין.';
}

document.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { state.range = b.dataset.range; drawChart(); });

// Phase sheet: pick a phase (first pick covers all history, later ones start today) and an optional target weight.
let picked = null;
const markPicked = () => document.querySelectorAll('[data-phase]').forEach(b => b.setAttribute('aria-pressed', b.dataset.phase === picked));
$('#phaseBtn').onclick = () => {
  const act = activePhase(state.phases, todayISO());
  picked = act ? act.phase : null; markPicked();
  $('#phaseInfo').textContent = act ? `מאז ${fmtFull(act.from)}` : 'בלי שלב אין יעד להשוואה.';
  $('#targetKg').value = act && act.targetKg != null ? String(act.targetKg) : '';
  $('#targetErr').hidden = true;
  $('#phaseSheet').hidden = false;
};
document.querySelectorAll('[data-phase]').forEach(b => b.onclick = () => { picked = b.dataset.phase; markPicked(); });
$('#phaseCancel').onclick = () => { $('#phaseSheet').hidden = true; };
$('#phaseSave').onclick = async () => {
  if (!picked) { $('#phaseSheet').hidden = true; return; }
  const target = parseTarget($('#targetKg').value);
  if (Number.isNaN(target)) { $('#targetErr').hidden = false; return; }
  const firstW = state.summary && state.summary.series.length ? state.summary.series[0].date : null;
  try {
    await put('goals', phasePick(state.phases, picked, todayISO(), firstW, Date.now(), target));
    $('#phaseSheet').hidden = true;
    await render();
  } catch { toast('לא הצלחתי לשמור את השלב.'); }
};

let rz;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (state.summary) { drawScale(state.summary.rate); drawChart(); } }, 150); });

document.querySelectorAll('[data-list]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-list]').forEach(x => x.setAttribute('aria-selected', x === b));
  $('#listW').hidden = b.dataset.list !== 'w'; $('#listM').hidden = b.dataset.list !== 'm';
});

$('#exportBtn').onclick = async () => {
  try {
    const r = await shareBackup();
    if (r.saved) toast('הגיבוי מוכן. צריך לבחור "שמירה בקבצים".');
    render();
  } catch { toast('לא הצלחתי ליצור את קובץ הגיבוי.'); }
};

// ---- restore flow ----
let pendingObj = null;
$('#importFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  let obj; try { obj = JSON.parse(await f.text()); } catch { obj = null; }
  let v; try { v = validate(obj); } catch { v = { ok: false, errors: ['זה לא קובץ גיבוי תקין.'] }; }
  const errs = $('#importErrors'); errs.replaceChildren();
  if (!v.ok) {
    pendingObj = null;
    $('#importSummary').textContent = 'אי אפשר לשחזר את הקובץ הזה:';
    v.errors.slice(0, 5).forEach(m => errs.append(el('p', 'note', m)));
    $('#impMerge').hidden = $('#impReplace').hidden = true;
  } else {
    pendingObj = obj;
    $('#importSummary').textContent = `בקובץ: ${v.counts.weighins} שקילות ו־${v.counts.measurements} מדידות היקף.`;
    $('#impMerge').hidden = $('#impReplace').hidden = false;
  }
  $('#importSheet').hidden = false;
};
async function doRestore(replace) {
  if (!pendingObj) return;
  let v;
  try { v = await restore(pendingObj, { replace }); } catch { v = { ok: false }; }
  pendingObj = null; $('#importSheet').hidden = true;
  await requestPersistence();
  toast(v.ok ? `שוחזרו ${v.counts.weighins} שקילות ו־${v.counts.measurements} מדידות.` : 'השחזור נכשל, שום דבר לא השתנה.');
  render();
}
$('#impMerge').onclick = () => doRestore(false);
$('#impReplace').onclick = () => doRestore(true);
$('#impCancel').onclick = () => { pendingObj = null; $('#importSheet').hidden = true; };

$('#ver').textContent = 'גרסה ' + VERSION + '.';
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
