// Check-in and quick weigh-in: what the owner typed → records to write, plus the undo for them.
// Pure (no DOM, no storage, no clock): the screen passes today's date and a timestamp in.
import { SITES, isISODate } from './model.js';
import { roundN } from './trend.js';

export const TAGS = [
  { id: 'normal', he: 'רגיל' },
  { id: 'sick', he: 'מחלה' },
  { id: 'vacation', he: 'חופשה' },
  { id: 'event', he: 'אירוע' }
];
const TAG_IDS = new Set(TAGS.map(t => t.id));
export const NOTE_MAX = 120;
export const KG = { lo: 30, hi: 300 };  // same range the trend engine accepts
export const CM = { lo: 5, hi: 300 };   // same range restore accepts

// '' → null (left empty), '80,4' → 80.4, anything else or out of range → NaN.
export function parseNum(text, { lo, hi }) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (t === '') return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return NaN;
  const v = +t;
  return v >= lo && v <= hi ? v : NaN;
}

// The −/+ buttons next to the weight: 0.1 kg per tap. Unreadable text stays as it is.
export function stepKg(text, delta) {
  const v = parseNum(text, { lo: -Infinity, hi: Infinity });
  if (v === null || Number.isNaN(v)) return String(text ?? '');
  const r = roundN(v + delta, 2);
  return r >= KG.lo && r <= KG.hi ? String(r) : String(text);
}

const live = list => (list || []).filter(r => r && !r.deleted);
const before = (list, date) => live(list).filter(r => isISODate(r.date) && r.date < date)
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

// What the form opens with for a date. Records already saved on that date are loaded for editing;
// otherwise the weight starts at the previous weigh-in and the circumferences start empty.
export function checkinDefaults(data, date) {
  const W = live(data.weighins).filter(w => w.date === date);
  const prevW = before(data.weighins, date).pop() || null;
  const M = live(data.measurements);
  const C = live(data.checkins).find(c => c.date === date) || null;
  const sites = SITES.map(s => {
    const today = M.find(m => m.site === s.id && m.date === date);
    const prev = before(M.filter(m => m.site === s.id), date).pop() || null;
    return { id: s.id, he: s.he, value: today ? String(today.cm) : '', prev: prev ? { cm: prev.cm, date: prev.date } : null };
  });
  return {
    date,
    kg: W.length ? String(W[0].kg) : prevW ? String(prevW.kg) : '',
    kgSource: W.length ? 'same_day' : prevW ? 'previous' : null,
    prev: prevW ? { kg: prevW.kg, date: prevW.date } : null,
    sites,
    tag: C && TAG_IDS.has(C.tag) ? C.tag : 'normal',
    note: C && typeof C.note === 'string' ? C.note : '',
    editing: !!(W.length || C || sites.some(s => s.value !== ''))
  };
}

// An id nobody uses yet (deleted records keep theirs, so they can come back with undo).
function freeId(base, list, at) {
  return (list || []).some(r => r && String(r.id) === base) ? `${base}-${at}` : base;
}

// Weigh-in for a date: update that day's record (one weigh-in per day); extra same-day duplicates
// from old imports are soft-deleted so the day holds exactly the number typed.
function weighinWrites(data, date, kg, at) {
  const same = live(data.weighins).filter(w => w.date === date);
  const writes = [];
  if (same.length) {
    writes.push({ store: 'weighins', rec: { ...same[0], kg, at }, old: same[0] });
    for (const d of same.slice(1)) writes.push({ store: 'weighins', rec: { ...d, deleted: true, at }, old: d });
  } else {
    writes.push({ store: 'weighins', rec: { id: freeId('w-' + date, data.weighins, at), date, kg, deleted: false, at }, old: null });
  }
  return writes;
}

function checkDate(date, today, errors) {
  if (!isISODate(date)) errors.date = 'צריך לבחור תאריך.';
  else if (today && date > today) errors.date = 'אי אפשר לשמור תאריך עתידי.';
}

// Group writes by store for db.writeAll (one transaction), and the matching undo.
function pack(writes) {
  const apply = {}, undo = {};
  for (const w of writes) {
    (apply[w.store] ||= []).push(w.rec);
    (undo[w.store] ||= []).push(w.old ? w.old : { ...w.rec, deleted: true });
  }
  return { apply, undo };
}

// Full check-in. form = { date, kg, cm: {siteId: text}, tag, note }.
// Returns { ok, errors: {date?, kg?, sites: {siteId: msg}}, apply, undo, weighinId }.
export function buildCheckin(form, data, today, at) {
  const errors = { sites: {} };
  const date = form.date;
  checkDate(date, today, errors);
  const kg = parseNum(form.kg, KG);
  if (kg === null) errors.kg = 'צריך משקל כדי לשמור.';
  else if (Number.isNaN(kg)) errors.kg = `משקל בין ${KG.lo} ל־${KG.hi} ק״ג, למשל 80.4`;
  const cms = {};
  for (const s of SITES) {
    const v = parseNum((form.cm || {})[s.id], CM);
    if (Number.isNaN(v)) errors.sites[s.id] = `בין ${CM.lo} ל־${CM.hi} ס״מ`;
    else cms[s.id] = v;
  }
  const tag = TAG_IDS.has(form.tag) ? form.tag : 'normal';
  const note = String(form.note ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  const ok = !errors.date && !errors.kg && !Object.keys(errors.sites).length;
  if (!ok) return { ok, errors };

  const writes = weighinWrites(data, date, kg, at);
  const weighinId = writes[0].rec.id;
  const M = live(data.measurements);
  for (const s of SITES) {
    const same = M.filter(m => m.site === s.id && m.date === date);
    const v = cms[s.id];
    if (v === null) {
      // Cleared a value saved earlier that day → remove it (soft, undoable).
      for (const m of same) writes.push({ store: 'measurements', rec: { ...m, deleted: true, at }, old: m });
      continue;
    }
    if (same.length) {
      writes.push({ store: 'measurements', rec: { ...same[0], cm: v, at }, old: same[0] });
      for (const d of same.slice(1)) writes.push({ store: 'measurements', rec: { ...d, deleted: true, at }, old: d });
    } else {
      writes.push({ store: 'measurements', rec: { id: freeId(`m-${date}-${s.id}`, data.measurements, at), date, site: s.id, cm: v, deleted: false, at }, old: null });
    }
  }
  const prevC = live(data.checkins).find(c => c.date === date);
  const c = { id: prevC ? prevC.id : freeId('c-' + date, data.checkins, at), date, weighinId, tag, note, at };
  writes.push({ store: 'checkins', rec: prevC ? { ...prevC, ...c } : c, old: prevC || null });
  return { ok, errors, weighinId, ...pack(writes) };
}

// Quick weigh-in: weight only, no circumferences, no tag.
export function buildWeighin(form, data, today, at) {
  const errors = {};
  checkDate(form.date, today, errors);
  const kg = parseNum(form.kg, KG);
  if (kg === null) errors.kg = 'צריך משקל כדי לשמור.';
  else if (Number.isNaN(kg)) errors.kg = `משקל בין ${KG.lo} ל־${KG.hi} ק״ג, למשל 80.4`;
  if (errors.date || errors.kg) return { ok: false, errors };
  return { ok: true, errors, ...pack(weighinWrites(data, form.date, kg, at)) };
}
