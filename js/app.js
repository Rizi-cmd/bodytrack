// Phase 1 UI: verdict screen (Swiss Lab), check-in, quick weigh-in, history, phase, backup/restore.
// Every number shown comes from js/trend.js and js/report.js (pure, tested); check-in records from js/checkin.js.
import { SITES, fmtDate, fmtCm, todayISO } from './model.js';
import { getAll, put, writeAll, getMeta, requestPersistence } from './db.js';
import {
  TAGS, stepKg, checkinDefaults, buildCheckin, buildWeighin, bigJump, prevWeighin, editWeighin, deleteWeighin, editMeasureDay, deleteMeasureDay
} from './checkin.js';
import { validate, restore, shareBackup } from './backup.js';
import { trendSummary, fmtRate, fmtWeight, EMPTY } from './trend.js';
import {
  PHASE_HE, isPhaseRecord, phasePick, activePhase, parseTarget, circCaption, verdictText, weighinStats, cadenceText, changeView, footnotes, circRows, scaleGeometry, weightChart, nearestPoint, pointReadout, fmtDay, fmtFull
} from './report.js';
import { renderAnalytics, redraw as redrawAnalytics } from './analyticsScreen.js';
import { initPhotos, openPhotos } from './photosScreen.js';

export const VERSION = '0.7.1';
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
// undo: optional async function behind a "ביטול" button in the toast.
function toast(msg, ms = 3500, undo = null) {
  $('#toastMsg').textContent = msg; $('#toast').hidden = false;
  const a = $('#toastAct'); a.hidden = !undo;
  a.onclick = undo ? () => { $('#toast').hidden = true; clearTimeout(toastT); undo(); } : null;
  clearTimeout(toastT); toastT = setTimeout(() => { $('#toast').hidden = true; }, ms);
}
const num = (text, cls = 'n') => { const s = el('span', cls, text); s.dir = 'ltr'; return s; };

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
  state.chart = c; $('#chartRead').hidden = true;
  $('#chartCount').textContent = c.count === 1 ? 'שקילה אחת' : `${c.count} שקילות`;
  document.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', b.dataset.range === state.range));
}

// Long press on figure 1, then slide: a guide line on the nearest weigh-in and its date, weight and average.
// A quick swipe stays a normal scroll; once the press is held, the page stops scrolling until the finger lifts.
function showPoint(clientX) {
  const c = state.chart, svg = $('#chart svg');
  if (!c || !svg) return;
  const p = nearestPoint(c.points, clientX - svg.getBoundingClientRect().left);
  if (!p) return;
  svg.querySelectorAll('.hl').forEach(e => e.remove());
  svg.append(sv('line', { class: 'hl hl-line', x1: p.x, x2: p.x, y1: c.padT, y2: c.plotBottom }));
  if (p.yAvg !== null) svg.append(sv('rect', { class: 'hl hl-avg', x: p.x - 3.5, y: p.yAvg - 3.5, width: 7, height: 7 }));
  svg.append(sv('circle', { class: 'hl hl-dot', cx: p.x, cy: p.y, r: 5.5 }));
  const t = pointReadout(p, state.checkins), box = $('#chartRead');
  box.replaceChildren(num(t.date, 'n'), el('br'), 'שקילה: ', num(t.kg, 'n'));
  box.firstChild.style.fontWeight = '800';
  if (t.avg !== null) box.append(el('br'), 'ממוצע 4 שקילות: ', num(t.avg, 'n'));
  if (t.tag || t.note) box.append(el('br'), el('span', 'rnote', [t.tag, t.note].filter(Boolean).join(' · ')));
  box.className = 'readout ' + (p.x > c.width / 2 ? 'at-l' : 'at-r'); // keep it away from the finger
  box.hidden = false;
}
{
  const box = $('#chart');
  let timer = null, start = null, scrub = false;
  const stop = () => {
    clearTimeout(timer); start = null;
    if (!scrub) return;
    scrub = false; $('#chartRead').hidden = true;
    document.querySelectorAll('#chart .hl').forEach(e => e.remove());
  };
  box.addEventListener('pointerdown', e => {
    start = { x: e.clientX, y: e.clientY }; clearTimeout(timer);
    timer = setTimeout(() => { scrub = true; showPoint(start.x); }, 350);
  });
  box.addEventListener('pointermove', e => {
    if (scrub) showPoint(e.clientX);
    else if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) { clearTimeout(timer); start = null; }
  });
  box.addEventListener('pointerup', stop);
  box.addEventListener('pointercancel', stop);
  box.addEventListener('touchmove', e => { if (scrub) e.preventDefault(); }, { passive: false });
  box.addEventListener('contextmenu', e => e.preventDefault());
}
// iPhone ignores "no zoom" in the page settings for pinching; this stops the pinch itself.
document.addEventListener('gesturestart', e => e.preventDefault());

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
  const cad = cadenceText(weighinStats(s.series, todayISO()));
  $('#cadence').textContent = cad; $('#cadence').hidden = !cad;
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
  state.checkins = C;
  state.data = { W, M, C };
  renderVerdict(W, M, C);
  if (!$('#anaView').hidden) renderAnalytics({ ...state.data, phases: state.phases, today: todayISO() });

  const lw = $('#listW'); lw.replaceChildren();
  if (!W.length) lw.append(el('p', 'empty', 'אין שקילות.'));
  W.slice().reverse().forEach(w => {
    const r = el('button', 'row'); r.type = 'button'; const b = el('b', 'n', fmtWeight(w.kg)); b.dir = 'ltr';
    r.append(el('span', 'dt', fmtDate(w.date)), b); lw.append(r);
    r.onclick = () => openEditW(w.id);
  });

  const days = new Map();
  for (const m of M) { if (!days.has(m.date)) days.set(m.date, []); days.get(m.date).push(m); }
  const lm = $('#listM'); lm.replaceChildren();
  if (!days.size) lm.append(el('p', 'empty', 'אין מדידות.'));
  [...days.keys()].sort().reverse().forEach(d => {
    const box = el('button', 'mday'); box.type = 'button'; box.onclick = () => openEditM(d);
    box.append(el('h3', null, fmtDate(d)));
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
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => {
  if (state.summary) { drawScale(state.summary.rate); drawChart(); }
  if (!$('#anaView').hidden) redrawAnalytics();
}, 150); });

// Analytics screen: opened from the header, recomputed from the stored records every time.
$('#anaBtn').onclick = () => {
  if (!state.data) return; // first render not finished yet
  showView('analytics');
  renderAnalytics({ ...state.data, phases: state.phases, today: todayISO() });
};
$('#anaBack').onclick = () => showView('main');

// Photos screen: its own module; gets the toast and the weigh-ins (for the before/after captions).
initPhotos({ toast, weighins: () => (state.data ? state.data.W : []) });
$('#phoBtn').onclick = () => { showView('photos'); openPhotos(); };
$('#phoBack').onclick = () => showView('main');

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

// ---- check-in and quick weigh-in ----
// Raw stores, deleted records included (checkin.js needs them to pick free ids and to undo).
async function rawData() {
  const [weighins, measurements, checkins] = await Promise.all(['weighins', 'measurements', 'checkins'].map(getAll));
  return { weighins, measurements, checkins };
}
const ci = { data: null, tag: 'normal', dirty: false };
function showView(v) {
  $('#main').hidden = v !== 'main'; $('#checkinView').hidden = v !== 'checkin'; $('#anaView').hidden = v !== 'analytics';
  $('#phoView').hidden = v !== 'photos';
  scrollTo(0, 0);
}
// After a check-in the verdict screen shows "סיום" at the bottom instead of the entry buttons (mockup).
function afterCheckin(on, measured = false) {
  $('#actions').hidden = on; $('#doneBar').hidden = !on;
  $('#circSec').open = on && measured;
}
function showErr(input, errEl, msg) {
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  errEl.hidden = !msg; errEl.textContent = msg || '';
}
// "Previous weigh-in" line under the weight field.
function kgInfo(box, d) {
  box.replaceChildren();
  if (!d.prev) { box.append(d.kgSource === 'same_day' ? 'כבר שקלת בתאריך הזה.' : 'אין שקילה קודמת.'); return; }
  box.append(d.kgSource === 'same_day' ? 'כבר שקלת בתאריך הזה. השקילה הקודמת: ' : 'מולא מהשקילה הקודמת: ',
    num(fmtWeight(d.prev.kg)), ' ק״ג ב־', num(fmtDay(d.prev.date)));
}
const markTags = () => document.querySelectorAll('[data-tag]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tag === ci.tag));

// One row per site: name (+ error), previous value and date, input. Ids: `${prefix}-${site}`, `${prefix}-err-${site}`.
function siteRows(tb, sites, prefix) {
  tb.replaceChildren();
  for (const s of sites) {
    const tr = el('tr');
    const name = el('td'); const lab = el('label', null, s.he); lab.htmlFor = `${prefix}-${s.id}`;
    name.append(lab, el('span', 'lab bad err', ''));
    name.lastChild.hidden = true; name.lastChild.id = `${prefix}-err-${s.id}`;
    const prev = el('td', 'prev lab');
    if (s.prev) prev.append('קודם ', num(fmtWeight(s.prev.cm)), ' · ', num(fmtDay(s.prev.date)));
    else prev.append('מדידה ראשונה');
    const inp = el('input', 'field n'); inp.id = `${prefix}-${s.id}`; inp.inputMode = 'decimal'; inp.dir = 'ltr';
    inp.autocomplete = 'off'; inp.value = s.value;
    const cell = el('td', 'in'); cell.append(inp);
    tr.append(name, prev, cell); tb.append(tr);
  }
}
const siteValues = prefix => Object.fromEntries(SITES.map(s => [s.id, document.getElementById(`${prefix}-${s.id}`).value]));
const siteErrors = (prefix, errs) => {
  for (const s of SITES) showErr(document.getElementById(`${prefix}-${s.id}`), document.getElementById(`${prefix}-err-${s.id}`), errs[s.id]);
};
// Typo guard: a weight more than 2 kg from the weigh-in before it is saved only after "are you sure?".
function jumpOk(kg, prev) {
  const j = bigJump(kg, prev);
  if (!j) return true;
  return confirm(`${fmtWeight(kg)} ק״ג זה ${fmtWeight(Math.abs(j.delta))} ק״ג ${j.delta > 0 ? 'יותר' : 'פחות'} מהשקילה הקודמת (${fmtWeight(j.prevKg)} ב־${fmtDay(j.prevDate)}). לשמור בכל זאת?`);
}

function fillCheckin(date) {
  const d = checkinDefaults(ci.data, date);
  $('#ciDate').value = date; $('#ciDate').max = todayISO();
  $('#ciKg').value = d.kg;
  kgInfo($('#ciKgInfo'), d);
  showErr($('#ciDate'), $('#ciDateErr'), null); showErr($('#ciKg'), $('#ciKgErr'), null);
  siteRows($('#ciSites'), d.sites, 'ci');
  ci.tag = d.tag; markTags();
  $('#ciNote').value = d.note;
  $('#ciEditing').hidden = !d.editing;
  ci.dirty = false;
}

const tagBox = $('#ciTags');
for (const t of TAGS) {
  const b = el('button', null, t.he); b.type = 'button'; b.dataset.tag = t.id;
  b.onclick = () => { ci.tag = t.id; ci.dirty = true; markTags(); };
  tagBox.append(b);
}
$('#checkinBtn').onclick = async () => {
  ci.data = await rawData();
  fillCheckin(todayISO());
  showView('checkin');
};
$('#ciDate').onchange = () => { if ($('#ciDate').value) fillCheckin($('#ciDate').value); };
// Typing in a field clears its error until the next save.
const clearErr = (input, errEl) => { if (input.getAttribute('aria-invalid') === 'true') showErr(input, errEl, null); };
$('#checkinView').addEventListener('input', e => {
  const t = e.target;
  if (t.id !== 'ciDate') ci.dirty = true;
  if (t.id === 'ciKg') clearErr(t, $('#ciKgErr'));
  else if (t.id.startsWith('ci-')) clearErr(t, document.getElementById('ci-err-' + t.id.slice(3)));
});
$('#qKg').addEventListener('input', e => clearErr(e.target, $('#qKgErr')));
$('#ciNote').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }; // Enter closes the keyboard, doesn't save
const leaveCheckin = () => { if (!ci.dirty || confirm('לצאת בלי לשמור?')) showView('main'); };
$('#ciCancel').onclick = leaveCheckin; $('#ciCancelTop').onclick = leaveCheckin;

document.querySelectorAll('[data-step]').forEach(b => b.onclick = () => {
  const i = document.getElementById(b.dataset.for);
  i.value = stepKg(i.value, +b.dataset.step);
  i.dispatchEvent(new Event('input', { bubbles: true }));
});

$('#checkinView').onsubmit = async e => {
  e.preventDefault();
  const form = { date: $('#ciDate').value, kg: $('#ciKg').value, tag: ci.tag, note: $('#ciNote').value, cm: siteValues('ci') };
  const r = buildCheckin(form, ci.data, todayISO(), Date.now());
  showErr($('#ciDate'), $('#ciDateErr'), r.errors.date); showErr($('#ciKg'), $('#ciKgErr'), r.errors.kg);
  siteErrors('ci', r.errors.sites);
  if (!r.ok) { const bad = $('#checkinView [aria-invalid=true]'); if (bad) bad.focus(); return; }
  if (!jumpOk(r.apply.weighins[0].kg, prevWeighin(ci.data, form.date))) return;
  try { await writeAll(r.apply); } catch { toast('לא הצלחתי לשמור. שום דבר לא השתנה.'); return; }
  await requestPersistence();
  showView('main');
  afterCheckin(true, (r.apply.measurements || []).some(m => !m.deleted));
  await render();
  toast('הצ׳ק-אין נשמר.', 8000, async () => {
    try { await writeAll(r.undo); } catch { toast('לא הצלחתי לבטל.'); return; }
    afterCheckin(false); await render(); toast('הצ׳ק-אין בוטל.');
  });
};
$('#doneBtn').onclick = () => { afterCheckin(false); scrollTo(0, 0); };

$('#quickBtn').onclick = async () => {
  ci.data = await rawData();
  const d = checkinDefaults(ci.data, todayISO());
  $('#qDate').replaceChildren('היום, ', num(fmtFull(todayISO())));
  $('#qKg').value = d.kg; kgInfo($('#qKgInfo'), d);
  showErr($('#qKg'), $('#qKgErr'), null);
  $('#quickSheet').hidden = false;
};
$('#qCancel').onclick = () => { $('#quickSheet').hidden = true; };
$('#quickForm').onsubmit = async e => {
  e.preventDefault();
  const r = buildWeighin({ date: todayISO(), kg: $('#qKg').value }, ci.data, todayISO(), Date.now());
  showErr($('#qKg'), $('#qKgErr'), r.errors.kg || r.errors.date);
  if (!r.ok) { $('#qKg').focus(); return; }
  if (!jumpOk(r.apply.weighins[0].kg, prevWeighin(ci.data, todayISO()))) return;
  try { await writeAll(r.apply); } catch { toast('לא הצלחתי לשמור. שום דבר לא השתנה.'); return; }
  await requestPersistence();
  $('#quickSheet').hidden = true;
  await render();
  toast('השקילה נשמרה.', 8000, async () => {
    try { await writeAll(r.undo); } catch { toast('לא הצלחתי לבטל.'); return; }
    await render(); toast('השקילה בוטלה.');
  });
};

// ---- history: fix or delete ----
const ed = { mode: null, id: null, date: null, data: null };
// Save the change, close the sheet, redraw, and offer undo.
async function commit(r, done, undone) {
  try { await writeAll(r.apply); } catch { toast('לא הצלחתי לשמור. שום דבר לא השתנה.'); return; }
  $('#editSheet').hidden = true;
  await render();
  toast(done, 8000, async () => {
    try { await writeAll(r.undo); } catch { toast('לא הצלחתי לבטל.'); return; }
    await render(); toast(undone);
  });
}
async function openEditW(id) {
  ed.data = await rawData();
  const w = ed.data.weighins.find(x => !x.deleted && x.id === id);
  if (!w) return;
  Object.assign(ed, { mode: 'w', id, date: w.date });
  $('#eTitle').textContent = 'תיקון שקילה';
  $('#eDate').replaceChildren(num(fmtFull(w.date)));
  $('#eKgBox').hidden = false; $('#eSites').hidden = true;
  $('#eKg').value = String(w.kg); showErr($('#eKg'), $('#eKgErr'), null);
  $('#eDelete').textContent = 'מחיקת השקילה';
  $('#editSheet').hidden = false;
}
async function openEditM(date) {
  ed.data = await rawData();
  Object.assign(ed, { mode: 'm', id: null, date });
  $('#eTitle').textContent = 'תיקון היקפים';
  $('#eDate').replaceChildren(num(fmtFull(date)), ' · שדה ריק מוחק את המדידה');
  $('#eKgBox').hidden = true; $('#eSites').hidden = false;
  siteRows($('#eSites'), checkinDefaults(ed.data, date).sites, 'e');
  $('#eDelete').textContent = 'מחיקת כל ההיקפים של היום';
  $('#editSheet').hidden = false;
}
$('#editForm').addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'eKg') clearErr(t, $('#eKgErr'));
  else if (t.id.startsWith('e-')) clearErr(t, document.getElementById('e-err-' + t.id.slice(2)));
});
$('#editForm').onsubmit = async e => {
  e.preventDefault();
  const at = Date.now();
  if (ed.mode === 'w') {
    const r = editWeighin(ed.data, ed.id, $('#eKg').value, at);
    showErr($('#eKg'), $('#eKgErr'), r.errors.kg);
    if (!r.ok) { $('#eKg').focus(); return; }
    if (!jumpOk(r.kg, prevWeighin(ed.data, ed.date))) return;
    await commit(r, 'השקילה תוקנה.', 'התיקון בוטל.');
  } else {
    const r = editMeasureDay(ed.data, ed.date, siteValues('e'), at);
    siteErrors('e', r.errors.sites);
    if (!r.ok) { const bad = $('#editForm [aria-invalid=true]'); if (bad) bad.focus(); return; }
    await commit(r, 'ההיקפים תוקנו.', 'התיקון בוטל.');
  }
};
$('#eDelete').onclick = async () => {
  const at = Date.now();
  const r = ed.mode === 'w' ? deleteWeighin(ed.data, ed.id, at) : deleteMeasureDay(ed.data, ed.date, at);
  if (!r.ok) { $('#editSheet').hidden = true; return; }
  await commit(r, ed.mode === 'w' ? 'השקילה נמחקה.' : 'ההיקפים של היום נמחקו.', 'המחיקה בוטלה.');
};
$('#eCancel').onclick = () => { $('#editSheet').hidden = true; };

$('#ver').textContent = 'גרסה ' + VERSION + '.';
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
