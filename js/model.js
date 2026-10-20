// Shared definitions. Pure data, no storage or UI.

export const SCHEMA = 1; // bump only with a migration in db.js

// Measurement sites, in the order the check-in asks for them.
// `goal`: which direction counts as progress (used for colours and the voice in phase 1).
export const SITES = [
  { id: 'waist_navel', he: 'מותניים (טבור)', goal: 'down' },
  { id: 'waist',       he: 'מותן',           goal: 'down' },
  { id: 'hips',        he: 'ישבן',           goal: 'down' },
  { id: 'chest',       he: 'חזה',            goal: 'up' },
  { id: 'shoulders',   he: 'כתפיים',         goal: 'up' },
  { id: 'arm_relaxed', he: 'יד קדמית רפוי', goal: 'up' },
  { id: 'arm_flexed',  he: 'יד קדמית לא רפוי', goal: 'up' },
  { id: 'thigh',       he: 'ירך',            goal: 'up' },
  { id: 'calf',        he: 'שוק',            goal: 'up' },
  { id: 'neck',        he: 'צוואר',          goal: 'none' },
  { id: 'wrist',       he: 'פרק כף יד',      goal: 'none' }
];
export const SITE = Object.fromEntries(SITES.map(s => [s.id, s]));

export const isISODate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
export const fmtDate = iso => { const [y, m, d] = iso.split('-'); return `${+d}.${+m}.${y}`; };
export const fmtKg = v => v.toFixed(2);
export const fmtCm = v => (Math.round(v * 10) / 10).toString();
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
