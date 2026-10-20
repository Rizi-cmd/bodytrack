// Backup and restore as a JSON file the user keeps (e.g. in iCloud Drive).
import { SCHEMA, SITE, isISODate } from './model.js';
import { readAll, writeAll, setMeta, STORES } from './db.js';

export async function buildBackup() {
  const data = await readAll();
  return { app: 'bodytrack', schema: SCHEMA, exportedAt: new Date().toISOString(), ...data };
}

// Returns {ok, data, errors[], counts}. Never throws on bad input.
export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['הקובץ לא בפורמט JSON תקין.'] };
  if (obj.app !== 'bodytrack') errors.push('זה לא קובץ גיבוי של BodyTrack.');
  else if (typeof obj.schema !== 'number') errors.push('הקובץ פגום: חסר מספר גרסה.');
  else if (obj.schema > SCHEMA) errors.push('הקובץ נוצר בגרסה חדשה יותר של האפליקציה. צריך לעדכן את האפליקציה.');
  const clean = { settings: obj.settings && typeof obj.settings === 'object' ? obj.settings : {} };
  for (const s of STORES) clean[s] = [];

  (obj.weighins || []).forEach((w, i) => {
    if (!w || !isISODate(w.date) || typeof w.kg !== 'number' || w.kg < 20 || w.kg > 300)
      return errors.push(`שקילה מספר ${i + 1} לא תקינה.`);
    clean.weighins.push({ id: String(w.id || 'w-' + w.date), date: w.date, kg: w.kg, deleted: !!w.deleted });
  });
  (obj.measurements || []).forEach((m, i) => {
    if (!m || !isISODate(m.date) || !SITE[m.site] || typeof m.cm !== 'number' || m.cm < 5 || m.cm > 300)
      return errors.push(`מדידה מספר ${i + 1} לא תקינה.`);
    clean.measurements.push({ id: String(m.id || `m-${m.date}-${m.site}`), date: m.date, site: m.site, cm: m.cm, deleted: !!m.deleted });
  });
  for (const s of ['checkins', 'goals']) if (Array.isArray(obj[s])) clean[s] = obj[s].filter(r => r && r.id);

  return {
    ok: errors.length === 0, data: clean, errors,
    counts: { weighins: clean.weighins.length, measurements: clean.measurements.length }
  };
}

export async function restore(obj, { replace }) {
  const v = validate(obj);
  if (!v.ok) return v;
  await writeAll(v.data, { replace });
  return v;
}

// Hand the file to iOS: the share sheet offers "Save to Files" (iCloud Drive).
export async function shareBackup() {
  const b = await buildBackup();
  const name = `bodytrack-backup-${b.exportedAt.slice(0, 10)}.json`;
  const file = new File([JSON.stringify(b, null, 1)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); }
    catch (e) { if (e && e.name === 'AbortError') return { saved: false }; throw e; }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  await setMeta('lastBackup', b.exportedAt);
  return { saved: true, name };
}
