// Phase 0 UI: summary, history, backup/restore.
import { SITES, SITE, fmtDate, fmtKg, fmtCm } from './model.js';
import { getAll, getMeta, requestPersistence } from './db.js';
import { validate, restore, shareBackup } from './backup.js';

export const VERSION = '0.1.0';
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let toastT;
function toast(msg, ms = 3500) {
  $('#toastMsg').textContent = msg; $('#toast').hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { $('#toast').hidden = true; }, ms);
}

async function render() {
  const W = (await getAll('weighins')).filter(w => !w.deleted).sort((a, b) => a.date.localeCompare(b.date));
  const M = (await getAll('measurements')).filter(m => !m.deleted);
  const has = W.length || M.length;
  $('#emptyState').hidden = !!has; $('#sumBody').hidden = !has;

  if (W.length) {
    const last = W[W.length - 1];
    $('#lastKg').textContent = fmtKg(last.kg);
    $('#lastDate').textContent = fmtDate(last.date);
  }
  const days = new Map();
  for (const m of M) { if (!days.has(m.date)) days.set(m.date, []); days.get(m.date).push(m); }
  $('#nW').textContent = W.length; $('#nM').textContent = days.size;
  const first = [W[0]?.date, ...days.keys()].filter(Boolean).sort()[0];
  $('#since').textContent = first ? fmtDate(first) : '–';

  const lw = $('#listW'); lw.replaceChildren();
  if (!W.length) lw.append(el('p', 'muted', 'אין שקילות.'));
  W.slice().reverse().forEach(w => {
    const r = el('div', 'row'); r.append(el('span', 'd', fmtDate(w.date)), el('b', null, fmtKg(w.kg))); lw.append(r);
  });

  const lm = $('#listM'); lm.replaceChildren();
  if (!days.size) lm.append(el('p', 'muted', 'אין מדידות.'));
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

document.querySelectorAll('[data-list]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-list]').forEach(x => x.setAttribute('aria-selected', x === b));
  $('#listW').hidden = b.dataset.list !== 'w'; $('#listM').hidden = b.dataset.list !== 'm';
});

$('#exportBtn').onclick = async () => {
  try {
    const r = await shareBackup();
    if (r.saved) toast('הגיבוי מוכן. ודא שבחרת "שמירה בקבצים".');
    render();
  } catch { toast('לא הצלחתי ליצור את קובץ הגיבוי.'); }
};

// ---- restore flow ----
let pendingObj = null;
$('#importFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  let obj; try { obj = JSON.parse(await f.text()); } catch { obj = null; }
  const v = validate(obj);
  const errs = $('#importErrors'); errs.replaceChildren();
  if (!v.ok) {
    pendingObj = null;
    $('#importSummary').textContent = 'אי אפשר לשחזר את הקובץ הזה:';
    v.errors.slice(0, 5).forEach(m => errs.append(el('p', 'note warn', m)));
    $('#impMerge').hidden = $('#impReplace').hidden = true;
  } else {
    pendingObj = obj;
    $('#importSummary').textContent = `בקובץ: ${v.counts.weighins} שקילות ו-${v.counts.measurements} מדידות היקף.`;
    $('#impMerge').hidden = $('#impReplace').hidden = false;
  }
  $('#importSheet').hidden = false;
};
async function doRestore(replace) {
  if (!pendingObj) return;
  const v = await restore(pendingObj, { replace });
  pendingObj = null; $('#importSheet').hidden = true;
  await requestPersistence();
  toast(v.ok ? `שוחזרו ${v.counts.weighins} שקילות ו-${v.counts.measurements} מדידות.` : 'השחזור נכשל, שום דבר לא השתנה.');
  render();
}
$('#impMerge').onclick = () => doRestore(false);
$('#impReplace').onclick = () => doRestore(true);
$('#impCancel').onclick = () => { pendingObj = null; $('#importSheet').hidden = true; };

$('#ver').textContent = 'גרסה ' + VERSION;
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
