// Tests for js/checkin.js (check-in and quick weigh-in: parsing, defaults, records to write, undo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stepCm, CM_STEP } from '../js/checkin.js';
import { parseNum, stepKg, checkinDefaults, buildCheckin, buildWeighin, bigJump, prevWeighin, editWeighin, deleteWeighin, editMeasureDay, deleteMeasureDay, KG, CM, NOTE_MAX } from '../js/checkin.js';
import { trendSummary } from '../js/trend.js';
import { footnotes } from '../js/report.js';
import { SITES } from '../js/model.js';

const fx = () => JSON.parse(readFileSync(new URL('./fixtures/sample-backup.json', import.meta.url), 'utf8'));
const TODAY = '2026-10-21', AT = 1761000000000;
// Apply writes the way db.writeAll does (put by id).
function apply(data, writes) {
  const out = structuredClone(data);
  for (const [store, recs] of Object.entries(writes)) {
    out[store] ||= [];
    for (const r of recs) {
      const i = out[store].findIndex(x => x.id === r.id);
      if (i >= 0) out[store][i] = r; else out[store].push(r);
    }
  }
  return out;
}
const liveW = d => d.weighins.filter(w => !w.deleted);
const liveM = d => d.measurements.filter(m => !m.deleted);

test('parseNum: comma or dot, empty is null, junk and out of range are NaN', () => {
  assert.equal(parseNum('80,4', KG), 80.4);
  assert.equal(parseNum(' 80.45 ', KG), 80.45);
  assert.equal(parseNum('', KG), null);
  assert.equal(parseNum(undefined, KG), null);
  for (const t of ['abc', '80.456', '29.9', '300.1', '-80', '8e1', '80.', '.5', '1,2,3'])
    assert.ok(Number.isNaN(parseNum(t, KG)), t);
  assert.equal(parseNum('5', CM), 5);
  assert.ok(Number.isNaN(parseNum('4.9', CM)));
});

test('stepKg: ±0.1 without float noise, stays in range, leaves junk alone', () => {
  assert.equal(stepKg('80.2', 0.1), '80.3');
  assert.equal(stepKg('80.9', 0.1), '81');
  assert.equal(stepKg('80,2', -0.1), '80.1');
  assert.equal(stepKg('80.25', 0.1), '80.35');
  assert.equal(stepKg('30', -0.1), '30');
  assert.equal(stepKg('300', 0.1), '300');
  assert.equal(stepKg('', 0.1), '');
  assert.equal(stepKg('abc', 0.1), 'abc');
});

test('defaults: weight from the previous weigh-in, previous value per site, empty circumferences', () => {
  const d = checkinDefaults(fx(), TODAY);
  assert.equal(d.kg, '80.2');
  assert.equal(d.kgSource, 'previous');
  assert.deepEqual(d.prev, { kg: 80.2, date: '2026-10-10' });
  assert.equal(d.sites.length, SITES.length);
  assert.ok(d.sites.every(s => s.value === ''));
  assert.ok(d.sites.every(s => s.prev && s.prev.date < TODAY));
  assert.equal(d.tag, 'normal');
  assert.equal(d.note, '');
  assert.equal(d.editing, false);
});

test('defaults: ignores the soft-deleted 99.9 and anything on/after the date', () => {
  const data = fx();
  const deleted = data.weighins.find(w => w.deleted);
  assert.ok(deleted, 'fixture has a soft-deleted weigh-in');
  const d = checkinDefaults(data, deleted.date);
  assert.notEqual(d.kg, '99.9');
  assert.ok(d.prev.date < deleted.date);
});

test('defaults: an empty device starts blank', () => {
  const d = checkinDefaults({}, TODAY);
  assert.equal(d.kg, '');
  assert.equal(d.kgSource, null);
  assert.equal(d.prev, null);
  assert.ok(d.sites.every(s => s.prev === null));
});

test('a check-in writes one weigh-in, the filled sites, and a check-in record; the engine sees it', () => {
  const data = fx();
  const r = buildCheckin({ date: TODAY, kg: '79,8', cm: { waist: '79', thigh: '58.5' }, tag: 'sick', note: '  a   b  ' }, data, TODAY, AT);
  assert.equal(r.ok, true);
  assert.equal(r.apply.weighins.length, 1);
  assert.deepEqual(r.apply.weighins[0], { id: 'w-' + TODAY, date: TODAY, kg: 79.8, deleted: false, at: AT });
  assert.deepEqual(r.apply.measurements.map(m => [m.site, m.cm]), [['waist', 79], ['thigh', 58.5]]);
  assert.deepEqual(r.apply.checkins, [{ id: 'c-' + TODAY, date: TODAY, weighinId: 'w-' + TODAY, tag: 'sick', note: 'a b', at: AT }]);
  const after = apply(data, r.apply);
  const s = trendSummary(after.weighins, 'cut', TODAY);
  assert.equal(s.latest.kg, 79.8);
  assert.ok(footnotes(s, after.checkins).some(t => t.includes('מחלה (21.10)')));
});

test('undo puts everything back: new records become soft-deleted, nothing is removed', () => {
  const data = fx();
  const r = buildCheckin({ date: TODAY, kg: '79.8', cm: { waist: '79' }, tag: 'event' }, data, TODAY, AT);
  const back = apply(apply(data, r.apply), r.undo);
  assert.deepEqual(liveW(back), liveW(data));
  assert.deepEqual(liveM(back), liveM(data));
  assert.ok(back.checkins.filter(c => !c.deleted).length === data.checkins.length);
  assert.ok(back.weighins.length === data.weighins.length + 1); // kept, marked deleted
});

test('saving again on the same day edits that day (no duplicate weigh-in), and its undo restores the first save', () => {
  const data = fx();
  const first = apply(data, buildCheckin({ date: TODAY, kg: '79.8', cm: { waist: '79', hips: '97' }, tag: 'sick', note: 'x' }, data, TODAY, AT).apply);
  const d = checkinDefaults(first, TODAY);
  assert.equal(d.kg, '79.8');
  assert.equal(d.kgSource, 'same_day');
  assert.equal(d.sites.find(s => s.id === 'waist').value, '79');
  assert.equal(d.tag, 'sick');
  assert.equal(d.note, 'x');
  assert.equal(d.editing, true);
  // Second save: new weight, waist changed, hips cleared.
  const r2 = buildCheckin({ date: TODAY, kg: '79.6', cm: { waist: '78.5', hips: '' }, tag: 'normal', note: '' }, first, TODAY, AT + 1);
  const second = apply(first, r2.apply);
  assert.deepEqual(liveW(second).filter(w => w.date === TODAY).map(w => w.kg), [79.6]);
  assert.deepEqual(liveM(second).filter(m => m.date === TODAY).map(m => [m.site, m.cm]), [['waist', 78.5]]);
  assert.equal(second.checkins.filter(c => c.date === TODAY && !c.deleted).length, 1);
  const undone = apply(second, r2.undo);
  assert.deepEqual(liveW(undone), liveW(first));
  assert.deepEqual(liveM(undone), liveM(first));
  assert.deepEqual(undone.checkins, first.checkins);
});

test('an imported weigh-in with an unusual id on that date is updated, not duplicated', () => {
  const data = { weighins: [{ id: 'imp-7', date: TODAY, kg: 81, deleted: false }, { id: 'imp-8', date: TODAY, kg: 82, deleted: false }] };
  const r = buildWeighin({ date: TODAY, kg: '80.5' }, data, TODAY, AT);
  const after = apply(data, r.apply);
  assert.deepEqual(liveW(after).map(w => [w.id, w.kg]), [['imp-7', 80.5]]);
  assert.deepEqual(apply(after, r.undo).weighins, data.weighins);
});

test('a new id never overwrites a soft-deleted record with the same id', () => {
  const data = { weighins: [{ id: 'w-' + TODAY, date: TODAY, kg: 99.9, deleted: true }] };
  const r = buildWeighin({ date: TODAY, kg: '80' }, data, TODAY, AT);
  assert.equal(r.apply.weighins[0].id, `w-${TODAY}-${AT}`);
});

test('errors: weight required and in range, bad circumference named by site, no future dates', () => {
  const data = fx();
  assert.equal(buildCheckin({ date: TODAY, kg: '' }, data, TODAY, AT).errors.kg, 'צריך משקל כדי לשמור.');
  assert.match(buildCheckin({ date: TODAY, kg: '800' }, data, TODAY, AT).errors.kg, /30/);
  const e = buildCheckin({ date: TODAY, kg: '80', cm: { waist: '7.9.1', neck: '400' } }, data, TODAY, AT);
  assert.equal(e.ok, false);
  assert.deepEqual(Object.keys(e.errors.sites), ['waist', 'neck']);
  assert.equal(e.apply, undefined);
  assert.match(buildCheckin({ date: '2026-10-22', kg: '80' }, data, TODAY, AT).errors.date, /עתידי/);
  assert.ok(buildCheckin({ date: '2026-02-30', kg: '80' }, data, TODAY, AT).errors.date);
  assert.equal(buildWeighin({ date: TODAY, kg: 'x' }, data, TODAY, AT).ok, false);
});

test('a past date is allowed and its default weight is the weigh-in before it', () => {
  const data = fx();
  const d = checkinDefaults(data, '2026-07-12');
  assert.deepEqual(d.prev, { kg: 83, date: '2026-07-11' });
  assert.equal(buildCheckin({ date: '2026-07-12', kg: '83.1' }, data, TODAY, AT).ok, true);
});

test('unknown tag falls back to normal; note is trimmed to one line and capped', () => {
  const r = buildCheckin({ date: TODAY, kg: '80', tag: 'party', note: 'a\nb ' + 'x'.repeat(300) }, fx(), TODAY, AT);
  const c = r.apply.checkins[0];
  assert.equal(c.tag, 'normal');
  assert.ok(!c.note.includes('\n'));
  assert.equal(c.note.length, NOTE_MAX);
});

test('quick weigh-in writes only a weigh-in', () => {
  const r = buildWeighin({ date: TODAY, kg: '80.1' }, fx(), TODAY, AT);
  assert.deepEqual(Object.keys(r.apply), ['weighins']);
});

test('typo guard: more than 2 kg from the previous weigh-in asks first', () => {
  const prev = { kg: 80.2, date: '2026-10-10' };
  assert.equal(bigJump(82.2, prev), null);          // exactly 2.0 is fine
  assert.equal(bigJump(78.2, prev), null);
  assert.deepEqual(bigJump(82.0 + 0.3, prev), { delta: 2.1, prevKg: 80.2, prevDate: '2026-10-10' });
  assert.equal(bigJump(78.1, prev).delta, -2.1);
  assert.equal(bigJump(90, null), null);            // first weigh-in ever: nothing to compare
  assert.deepEqual(prevWeighin(fx(), '2026-07-12'), { kg: 83, date: '2026-07-11' });
  assert.equal(prevWeighin(fx(), '2026-06-06'), null);
});

test('history: fix a weigh-in keeps its id and date; undo restores it', () => {
  const data = fx();
  const w = data.weighins.find(x => x.date === '2026-07-11');
  const r = editWeighin(data, w.id, '83,4', AT);
  assert.equal(r.ok, true);
  assert.deepEqual(r.apply.weighins, [{ ...w, kg: 83.4, at: AT }]);
  assert.deepEqual(apply(apply(data, r.apply), r.undo).weighins, data.weighins);
  assert.equal(editWeighin(data, w.id, '', AT).errors.kg, 'צריך משקל כדי לשמור.');
  assert.equal(editWeighin(data, 'nope', '80', AT).ok, false);
});

test('history: delete a weigh-in is soft, takes that day\'s check-in along, undo brings both back', () => {
  const data = fx();
  const r = deleteWeighin(data, 'w-2026-08-29', AT);
  const after = apply(data, r.apply);
  assert.ok(!liveW(after).some(w => w.date === '2026-08-29'));
  assert.ok(after.weighins.some(w => w.date === '2026-08-29' && w.deleted)); // still there, marked
  assert.ok(after.checkins.every(c => c.deleted));
  const back = apply(after, r.undo);
  assert.deepEqual(back.weighins, data.weighins);
  assert.deepEqual(back.checkins, data.checkins);
  // Another weigh-in left on that date → the check-in stays.
  const two = { weighins: [{ id: 'a', date: TODAY, kg: 80 }, { id: 'b', date: TODAY, kg: 81 }], checkins: [{ id: 'c', date: TODAY, tag: 'sick' }] };
  assert.equal(deleteWeighin(two, 'a', AT).apply.checkins, undefined);
});

test('history: fix or delete one day of circumferences; undo restores', () => {
  const data = fx();
  const day = liveM(data).map(m => m.date).sort().pop();
  const before = liveM(data).filter(m => m.date === day);
  const cm = Object.fromEntries(before.map(m => [m.site, String(m.cm)]));
  cm.waist = '78'; cm.hips = '';
  const r = editMeasureDay(data, day, cm, AT);
  const after = apply(data, r.apply);
  const today = liveM(after).filter(m => m.date === day);
  assert.equal(today.find(m => m.site === 'waist').cm, 78);
  assert.equal(today.find(m => m.site === 'hips'), undefined);
  assert.equal(today.length, before.length - 1);
  assert.deepEqual(liveM(apply(after, r.undo)), liveM(data));
  assert.equal(editMeasureDay(data, day, { waist: 'x' }, AT).ok, false);
  const del = deleteMeasureDay(data, day, AT);
  assert.equal(liveM(apply(data, del.apply)).filter(m => m.date === day).length, 0);
  assert.deepEqual(liveM(apply(apply(data, del.apply), del.undo)), liveM(data));
  assert.equal(deleteMeasureDay(data, '1999-01-01', AT).ok, false);
});

test('stepCm: empty row starts from the previous value; typed value steps; stays in range', () => {
  assert.equal(CM_STEP, 0.5);
  assert.equal(stepCm('', 83.5, -0.5), '83.0');
  assert.equal(stepCm('', 83.5, 0.5), '84.0');
  assert.equal(stepCm('79', 83.5, 0.5), '79.5');        // what was typed wins over the previous value
  assert.equal(stepCm('79,3', null, -0.5), '78.8');     // comma accepted, no float noise
  assert.equal(stepCm('', null, 0.5), '');              // no previous measurement: nothing invented
  assert.equal(stepCm('  ', undefined, 0.5), '');
  assert.equal(stepCm('5.2', null, -0.5), '5.2');        // would leave the range: unchanged
  assert.equal(stepCm('abc', 80, 0.5), 'abc');           // junk left for the validator to name
});
