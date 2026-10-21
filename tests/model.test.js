// Unit tests for the pure parts of js/model.js and the restore validation in js/backup.js.
// Run: npm test   (node --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCHEMA, SITES, SITE, isISODate, fmtDate, fmtKg, fmtCm, todayISO } from '../js/model.js';
// backup.js and db.js only touch indexedDB/DOM inside functions, so validate() imports fine in node.
import { validate } from '../js/backup.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/sample-backup.json', import.meta.url), 'utf8'));

test('isISODate accepts real ISO dates', () => {
  for (const s of ['2026-10-21', '2024-02-29', '1999-01-01']) assert.equal(isISODate(s), true, s);
});

test('isISODate rejects wrong shapes and non-strings', () => {
  for (const s of ['2026-1-01', '21.10.2026', '2026/10/21', '2026-10-21T00:00', '', ' 2026-10-21', '2026-13-01', '2026-00-10', 'abcd-ef-gh'])
    assert.equal(isISODate(s), false, JSON.stringify(s));
  for (const v of [null, undefined, 20261021, {}, [], true]) assert.equal(isISODate(v), false, String(v));
});

test('isISODate rejects impossible calendar days (2026-02-30, 2026-02-29)', () => {
  assert.equal(isISODate('2026-02-30'), false);
  assert.equal(isISODate('2026-02-29'), false);
  for (const s of ['2026-13-01', '2026-00-10', '2026-04-31', '2026-01-00', '2026-01-32', '1900-02-29'])
    assert.equal(isISODate(s), false, s);
});

test('isISODate accepts leap days and month ends', () => {
  for (const s of ['2028-02-29', '2000-02-29', '2026-12-31', '2026-04-30', '0099-01-01'])
    assert.equal(isISODate(s), true, s);
});

test('fmtDate prints d.m.yyyy without leading zeros', () => {
  assert.equal(fmtDate('2026-10-21'), '21.10.2026');
  assert.equal(fmtDate('2026-01-05'), '5.1.2026');
  assert.equal(fmtDate('2026-12-09'), '9.12.2026');
});

test('fmtKg always shows two decimals', () => {
  assert.equal(fmtKg(80), '80.00');
  assert.equal(fmtKg(80.2), '80.20');
  assert.equal(fmtKg(80.256), '80.26');
  assert.equal(fmtKg(100.5), '100.50');
});

test('fmtCm rounds to one decimal and drops a trailing .0', () => {
  assert.equal(fmtCm(83), '83');
  assert.equal(fmtCm(83.04), '83');
  assert.equal(fmtCm(83.26), '83.3');
  assert.equal(fmtCm(83.5), '83.5');
  assert.equal(fmtCm(0), '0');
});

test('todayISO returns a valid ISO date matching the local calendar day', () => {
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const before = iso(new Date());
  const t = todayISO();
  const after = iso(new Date());
  assert.equal(isISODate(t), true);
  assert.ok(t === before || t === after, t); // safe across midnight
});

// Site ids are stored in user data: they must never be renamed or reordered without a migration.
test('SITES: 11 unique ids, Hebrew label, valid goal, in check-in order', () => {
  assert.equal(SITES.length, 11);
  assert.equal(new Set(SITES.map(s => s.id)).size, SITES.length);
  assert.deepEqual(SITES.map(s => s.id), ['waist_navel', 'waist', 'hips', 'chest', 'shoulders', 'arm_relaxed', 'arm_flexed', 'thigh', 'calf', 'neck', 'wrist']);
  for (const s of SITES) {
    assert.match(s.id, /^[a-z_]+$/);
    assert.match(s.he, /[֐-׿]/, s.id + ' has a Hebrew label');
    assert.ok(['up', 'down', 'none'].includes(s.goal), s.id + ' goal');
  }
});

test('SITE maps every id to its own entry', () => {
  assert.equal(Object.keys(SITE).length, SITES.length);
  for (const s of SITES) assert.equal(SITE[s.id], s);
  assert.equal(SITE.waist.he, 'מותן');
  assert.equal(SITE.wrist.he, 'פרק כף יד');
  assert.equal(SITE.nope, undefined);
});


// ---- fixture + the same validate() the restore UI calls ----

test('fixture passes the restore validation', () => {
  const v = validate(fixture());
  assert.deepEqual(v.errors, []);
  assert.equal(v.ok, true);
  assert.equal(v.counts.weighins, 17);      // 16 live + 1 soft-deleted duplicate
  assert.equal(v.counts.measurements, 4 * SITES.length + 1);
  assert.equal(v.data.checkins.length, 1);
  assert.equal(v.data.weighins.filter(w => w.deleted).length, 1);
});

test('fixture shape: ~16 weekly weigh-ins, slow cut ~84 to ~80, one 3-week gap', () => {
  const live = fixture().weighins.filter(w => !w.deleted).sort((a, b) => a.date.localeCompare(b.date));
  assert.equal(live.length, 16);
  assert.ok(live[0].kg >= 83.5 && live[0].kg <= 84.5);
  assert.ok(live.at(-1).kg >= 79.5 && live.at(-1).kg <= 80.5);
  const gaps = live.slice(1).map((w, i) => Math.round((Date.parse(w.date) - Date.parse(live[i].date)) / (7 * 864e5)));
  assert.equal(gaps.filter(g => g === 4).length, 1, 'exactly one gap of 3 missing weeks');
  assert.equal(gaps.filter(g => g === 1).length, 14);
});

test('fixture measurement sets use real site ids and are full sets', () => {
  const byDate = new Map();
  for (const m of fixture().measurements) {
    assert.ok(SITE[m.site], m.site);
    byDate.set(m.date, (byDate.get(m.date) || 0) + 1);
  }
  assert.equal([...byDate.values()].filter(n => n === SITES.length).length, 4);
});

test('validate rejects bad input without throwing', () => {
  assert.equal(validate(null).ok, false);
  assert.equal(validate('x').ok, false);
  assert.equal(validate({ app: 'other', schema: 1 }).ok, false);
  assert.equal(validate({ app: 'bodytrack' }).ok, false);
  assert.equal(validate({ app: 'bodytrack', schema: SCHEMA + 1 }).ok, false);
  const bad = fixture(); bad.weighins[0].kg = 5; bad.measurements[0].site = 'elbow'; bad.weighins[1].date = '21.10.2026';
  const v = validate(bad);
  assert.equal(v.ok, false);
  assert.equal(v.errors.length, 3);
});

test('validate reports non-array lists as errors without throwing', () => {
  for (const bad of ['x', {}, null, 5, true]) {
    for (const key of ['weighins', 'measurements']) {
      let v;
      assert.doesNotThrow(() => { v = validate({ app: 'bodytrack', schema: SCHEMA, [key]: bad }); }, `${key}=${JSON.stringify(bad)}`);
      assert.equal(v.ok, false, `${key}=${JSON.stringify(bad)}`);
      assert.equal(v.errors.length, 1);
    }
  }
  assert.equal(validate({ app: 'bodytrack', schema: SCHEMA, weighins: 'x', measurements: {} }).errors.length, 2);
});

test('validate never throws on any JSON value, and rejects prototype-key sites', () => {
  for (const v of [null, true, 0, 'x', [], [1], {}, { app: 'bodytrack', schema: SCHEMA, weighins: [null, 1, 'a', []], measurements: [null, {}, []] }])
    assert.doesNotThrow(() => validate(v), JSON.stringify(v));
  for (const id of [{ toString: 1 }, { valueOf: 1 }]) {
    const o = { app: 'bodytrack', schema: SCHEMA, weighins: [{ id, date: '2026-10-21', kg: 80 }],
      measurements: [{ id, date: '2026-10-21', site: 'waist', cm: 80 }], checkins: [{ id }], goals: [{ id }] };
    let v; assert.doesNotThrow(() => { v = validate(o); });
    assert.equal(v.data.weighins[0].id, 'w-2026-10-21');
    assert.equal(v.data.measurements[0].id, 'm-2026-10-21-waist');
    assert.equal(v.ok, false);
  }
  const f = fixture(); f.measurements[0].site = 'constructor';
  assert.equal(validate(f).ok, false);
  assert.equal(validate({ app: 'bodytrack', schema: SCHEMA }).ok, true);
});

test('validate bounds years to 1900-2100, rejects array settings, requires checkin/goal ids', () => {
  const base = { app: 'bodytrack', schema: SCHEMA };
  for (const d of ['0026-10-21', '1899-12-31', '2101-01-01'])
    assert.equal(validate({ ...base, weighins: [{ date: d, kg: 80 }] }).ok, false, d);
  assert.equal(validate({ ...base, weighins: [{ date: '1900-01-01', kg: 80 }, { date: '2100-12-31', kg: 80 }] }).ok, true);
  assert.deepEqual(validate({ ...base, settings: [1] }).data.settings, {});
  const v = validate({ ...base, checkins: [{ id: 'c1' }, { id: {} }, null], goals: [{ id: 7 }, {}] });
  assert.equal(v.ok, false);
  assert.equal(v.errors.length, 3);
  assert.equal(v.data.checkins.length, 1);
  assert.equal(v.data.goals.length, 1);
});

test('validate rejects a broken phase record (it would break the screen)', () => {
  const base = { app: 'bodytrack', schema: 1, weighins: [], measurements: [] };
  assert.equal(validate({ ...base, goals: [{ id: 'p1', type: 'phase', from: 20260103, phase: 'cut' }] }).ok, false);
  assert.equal(validate({ ...base, goals: [{ id: 'p1', type: 'phase', from: '2026-01-03', phase: 'cut' }] }).ok, true);
});
