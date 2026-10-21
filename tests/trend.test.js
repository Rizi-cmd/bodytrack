// Tests for js/trend.js against the vectors in docs/specs/trend-engine.md §9, plus edge cases from §8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  day, cleanWeighins, trendSeries, weeklyRate, roundN, weightDirection, verdict,
  monthChange, trendSummary, fmtWeight, fmtChange, fmtRate, EMPTY
} from '../js/trend.js';

const M = '−';
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} expected ${b}, got ${a}`);
const addDays = (iso, n) => new Date((day(iso) + n) * 86400000).toISOString().slice(0, 10);
// Weekly weigh-ins from a start date.
const weekly = (start, kgs) => kgs.map((kg, k) => ({ id: 'w' + k, date: addDays(start, 7 * k), kg }));
const avgs = s => trendSeries(cleanWeighins(s)).filter(p => p.avg !== null).map(p => p.avg);

test('V1 empty', () => {
  const r = trendSummary([], 'cut');
  assert.equal(r.latest, null); assert.equal(r.avg, null); assert.equal(r.rate, null);
  assert.equal(r.verdict, 'too_early'); assert.equal(r.reason, 'no_data');
  assert.equal(fmtRate(r.rate), EMPTY);
});

test('V2 three weigh-ins', () => {
  const r = trendSummary(weekly('2026-01-03', [80.0, 79.8, 79.6]), 'cut');
  assert.equal(r.latest.kg, 79.6); assert.equal(r.avg, null); assert.equal(r.rate, null);
  assert.equal(r.verdict, 'too_early'); assert.equal(r.reason, 'need_more_weighins');
});

test('V3 four weigh-ins: average but no rate', () => {
  const r = trendSummary(weekly('2026-01-03', [80.0, 79.6, 79.4, 79.0]), 'cut');
  near(r.avg, 79.5); assert.equal(fmtWeight(r.avg), '79.5');
  assert.equal(r.rate, null); assert.equal(r.verdict, 'too_early');
});

test('V4 five weigh-ins, all three phases', () => {
  const w = weekly('2026-01-03', [82.0, 81.5, 81.0, 80.5, 80.0]);
  const a = avgs(w); near(a[0], 81.25); near(a[1], 80.75);
  const exp = { cut: ['toward', 'good'], bulk: ['away', 'bad'], maintenance: ['away', 'bad'] };
  for (const [ph, [v, c]] of Object.entries(exp)) {
    const r = trendSummary(w, ph);
    near(r.rate, -0.5); assert.equal(fmtRate(r.rate), M + '0.50');
    assert.equal(r.verdict, v, ph); assert.equal(r.colour, c, ph); assert.equal(r.arrow, 'down');
    assert.equal(fmtWeight(r.avg), '80.8'); assert.equal(r.monthChange, null); assert.equal(r.provisional, true);
  }
});

test('V5 flat across DST', () => {
  const w = weekly('2026-03-07', [80.0, 80.4, 79.8, 80.2, 80.0, 80.4, 79.8, 80.2]);
  assert.equal(w[7].date, '2026-04-25');
  for (const a of avgs(w)) near(a, 80.1);
  const cut = trendSummary(w, 'cut'), mt = trendSummary(w, 'maintenance');
  assert.ok(Math.abs(cut.rate) < 1e-9); assert.equal(fmtRate(cut.rate), '0.00');
  assert.equal(cut.verdict, 'stuck'); assert.equal(cut.colour, 'ink'); assert.equal(cut.arrow, 'flat');
  assert.equal(mt.verdict, 'holding'); assert.equal(mt.colour, 'good');
  near(cut.monthChange, 0); assert.equal(fmtChange(cut.monthChange), '0.0'); assert.equal(cut.monthRefDate, '2026-03-28');
});

test('V6 steady gain', () => {
  const w = weekly('2026-05-02', [0, 1, 2, 3, 4, 5, 6, 7].map(k => 70 + 0.25 * k));
  const a = avgs(w); near(a[0], 70.375); near(a[a.length - 1], 71.375);
  const b = trendSummary(w, 'bulk'), c = trendSummary(w, 'cut');
  near(b.rate, 0.25); assert.equal(fmtRate(b.rate), '+0.25');
  assert.equal(b.verdict, 'toward'); assert.equal(b.arrow, 'up'); assert.equal(c.verdict, 'away');
  assert.equal(fmtWeight(b.avg), '71.4');
  near(b.monthChange, 1.0); assert.equal(fmtChange(b.monthChange), '+1.0'); assert.equal(b.monthRefDate, '2026-05-23');
});

test('V7a exactly 0.20 counts as movement', () => {
  const r = trendSummary(weekly('2026-01-03', [80, 80, 80, 80, 79.2]), 'cut');
  near(r.rate, -0.2); assert.equal(fmtRate(r.rate), M + '0.20'); assert.equal(r.verdict, 'toward');
});

test('V7b −0.175 rounds to −0.18, stuck', () => {
  const r = trendSummary(weekly('2026-01-03', [80, 80, 80, 80, 79.3]), 'cut');
  near(r.rate, -0.175); assert.equal(fmtRate(r.rate), M + '0.18'); assert.equal(r.verdict, 'stuck');
});

test('V8 long gap: trend shown across the gap (owner 21.10), marked as extended', () => {
  const w = [...weekly('2026-01-03', [80, 80, 80, 80]), { id: 'x', date: '2026-03-07', kg: 78.0 }];
  const r = trendSummary(w, 'cut');
  assert.equal(r.latest.kg, 78.0); near(r.avg, 79.5); assert.equal(fmtWeight(r.avg), '79.5');
  near(r.rate, -0.5 / 15.75 * 7); assert.equal(fmtRate(r.rate), M + '0.22'); assert.equal(r.verdict, 'toward');
  assert.equal(r.extended, true); assert.equal(r.spanDays, 63); assert.equal(r.provisional, true);
});

test('dense weigh-ins keep the 28-day window (not extended)', () => {
  const r = trendSummary(weekly('2026-03-07', [80.0, 80.4, 79.8, 80.2, 80.0, 80.4, 79.8, 80.2]), 'cut');
  assert.equal(r.extended, false); assert.equal(r.spanDays, 49);
});

test('two average points in 28 days but older ones exist → reach back to 3', () => {
  // weekly, then a 5-week gap, then two more weigh-ins
  const w = [...weekly('2026-01-03', [82, 81.8, 81.6, 81.4, 81.2, 81.0]), { date: '2026-03-14', kg: 80 }, { date: '2026-03-21', kg: 79.8 }];
  const r = trendSummary(w, 'cut');
  assert.equal(r.extended, true); assert.equal(r.provisional, false);
  assert.ok(r.rate < 0);
});

test('V9 irregular spacing uses the centroid date', () => {
  const w = [...weekly('2026-01-03', [81.0, 80.8, 80.6, 80.4]), { id: 'x', date: '2026-02-14', kg: 79.6 }];
  const s = trendSeries(cleanWeighins(w));
  near(s[3].avg, 80.7); near(s[3].t, day('2026-01-03') + 10.5);
  near(s[4].avg, 80.35); near(s[4].t, day('2026-01-03') + 21);
  const r = trendSummary(w, 'cut');
  near(r.rate, -0.35 / 10.5 * 7); assert.equal(fmtRate(r.rate), M + '0.23'); assert.equal(r.verdict, 'toward');
});

test('VF invented fixture', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/sample-backup.json', import.meta.url), 'utf8'));
  const r = trendSummary(fx.weighins, 'cut');
  assert.equal(r.series.length, 16);
  const D = day(r.latest.date);
  const win = r.series.filter(p => p.avg !== null && day(p.date) >= D - 28).map(p => p.avg);
  [81.875, 81.625, 81.2, 80.925, 80.575].forEach((v, i) => near(win[i], v, 'window avg ' + i));
  assert.equal(win.length, 5);
  assert.equal(fmtRate(r.rate), M + '0.33'); assert.equal(r.verdict, 'toward'); assert.equal(r.provisional, false);
  assert.equal(fmtWeight(r.avg), '80.6');
  assert.equal(fmtChange(r.monthChange), M + '1.3'); assert.equal(r.monthRefDate, '2026-09-12');
  assert.equal(fmtWeight(r.latest.kg), '80.2');
});

// ---- §8 edge cases and building blocks ----

test('cleaning: deleted, invalid, out of range, duplicates, order', () => {
  const c = cleanWeighins([
    { date: '2026-01-10', kg: 80 }, { date: '2026-01-03', kg: 81 },
    { date: '2026-01-10', kg: 79 },                       // same date → mean 79.5
    { date: '2026-01-10', kg: 50, deleted: true },        // deleted duplicate ignored
    { date: '2026-02-30', kg: 80 }, { date: 'x', kg: 80 }, // invalid dates
    { date: '2026-01-17', kg: NaN }, { date: '2026-01-17', kg: '80' }, { date: '2026-01-17', kg: 29.9 }, { date: '2026-01-17', kg: 300.1 },
    null, 5
  ]);
  assert.deepEqual(c, [{ date: '2026-01-03', kg: 81 }, { date: '2026-01-10', kg: 79.5 }]);
  assert.deepEqual(cleanWeighins(null), []);
  // order-independent
  const a = [{ date: '2026-01-10', kg: 80 }, { date: '2026-01-10', kg: 79 }];
  assert.deepEqual(cleanWeighins(a), cleanWeighins([...a].reverse()));
});

test('only deleted → no_data', () => {
  const r = trendSummary([{ date: '2026-01-03', kg: 80, deleted: true }], 'cut');
  assert.equal(r.reason, 'no_data'); assert.equal(r.latest, null);
});

test('five weigh-ins inside 14 days → span_too_short', () => {
  const w = [0, 2, 4, 6, 8].map((d, k) => ({ date: addDays('2026-01-03', d), kg: 80 - k * 0.3 }));
  const r = trendSummary(w, 'cut');
  assert.equal(r.rate, null); assert.equal(r.reason, 'span_too_short'); assert.equal(r.verdict, 'too_early');
});

test('no phase → rate shown, no colour', () => {
  const r = trendSummary(weekly('2026-01-03', [82.0, 81.5, 81.0, 80.5, 80.0]), undefined);
  assert.equal(r.verdict, 'no_phase'); assert.equal(r.colour, 'ink'); assert.equal(r.arrow, 'down');
  assert.equal(r.direction, null); near(r.rate, -0.5);
});

test('phase list: current phase used, change inside window flagged', () => {
  const w = weekly('2026-01-03', [82.0, 81.5, 81.0, 80.5, 80.0]);
  const r = trendSummary(w, [{ from: '2025-06-01', phase: 'bulk' }, { from: '2026-01-20', phase: 'cut' }]);
  assert.equal(r.direction, -1); assert.equal(r.verdict, 'toward'); assert.equal(r.phaseChangedInWindow, true);
  const r2 = trendSummary(w, [{ from: '2025-06-01', phase: 'cut' }]);
  assert.equal(r2.phaseChangedInWindow, false);
  const r3 = trendSummary(w, [{ from: '2027-01-01', phase: 'cut' }]); // starts after the last weigh-in
  assert.equal(r3.verdict, 'no_phase');
});

test('phase list: same phase repeated is not a change; same date → later record wins', () => {
  const w = weekly('2026-01-03', [82.0, 81.5, 81.0, 80.5, 80.0]);
  const r = trendSummary(w, [{ from: '2025-06-01', phase: 'cut' }, { from: '2026-01-20', phase: 'cut' }]);
  assert.equal(r.phaseChangedInWindow, false);
  const r2 = trendSummary(w, [{ from: '2025-06-01', phase: 'bulk' }, { from: '2025-06-01', phase: 'cut' }]);
  assert.equal(r2.direction, -1);
});

test('never reset: V8 plus one more weigh-in gives a rate across the gap', () => {
  const w = [...weekly('2026-01-03', [80, 80, 80, 80]),
    { date: '2026-03-07', kg: 78.0 }, { date: '2026-03-14', kg: 78.0 }];
  const r = trendSummary(w, 'cut');
  assert.equal(fmtRate(r.rate), M + '0.22'); assert.equal(r.verdict, 'toward');
  assert.equal(r.windowDates[0], '2026-01-03'); assert.equal(r.extended, true);
});

test('span of exactly 14 days is enough', () => {
  const w = [0, 3, 7, 10, 14].map((d, k) => ({ date: addDays('2026-01-03', d), kg: 80 - k * 0.3 }));
  const r = trendSummary(w, 'cut');
  assert.notEqual(r.rate, null); assert.equal(r.reason, null);
});

test('windowDates lists the weigh-ins that feed the rate', () => {
  const r = trendSummary(weekly('2026-01-03', [82.0, 81.5, 81.0, 80.5, 80.0]), 'cut');
  assert.deepEqual(r.windowDates, ['2026-01-03', '2026-01-10', '2026-01-17', '2026-01-24', '2026-01-31']);
});

test('monthChange: no reference in [D−35, D−21] → null; tie → older', () => {
  assert.deepEqual(monthChange([]), { monthChange: null, monthRefDate: null });
  // avg points on D−31 and D−25 are equally close to D−28 → older wins
  const s = [
    { date: '2026-01-01', avg: 80 }, { date: '2026-01-07', avg: 79 }, { date: '2026-02-01', avg: 78 }
  ];
  const r = monthChange(s);
  assert.equal(r.monthRefDate, '2026-01-01'); near(r.monthChange, -2);
});

test('verdict table', () => {
  assert.deepEqual(verdict(null, -1), { verdict: 'too_early', colour: 'ink', arrow: null });
  assert.equal(verdict(-0.195, -1).verdict, 'toward');   // rounds to −0.20
  assert.equal(verdict(-0.194, -1).verdict, 'stuck');    // rounds to −0.19
  assert.equal(verdict(0.19, 0).verdict, 'holding');
  assert.equal(verdict(0.2, 0).verdict, 'away');
  assert.equal(verdict(-0.3, 1).colour, 'bad');
  assert.equal(verdict(0, null).arrow, 'flat');
  assert.equal(weightDirection('cut'), -1); assert.equal(weightDirection('bulk'), 1);
  assert.equal(weightDirection('maintenance'), 0); assert.equal(weightDirection('x'), null);
});

test('display: halves round away from zero, no −0, real minus', () => {
  assert.equal(roundN(-0.004, 2), 0); assert.ok(!Object.is(roundN(-0.004, 2), -0));
  assert.equal(fmtRate(-0.004), '0.00'); assert.equal(fmtChange(-0.04), '0.0');
  assert.equal(fmtRate(0.125), '+0.13'); assert.equal(fmtRate(-0.125), M + '0.13');
  assert.equal(fmtWeight(80.25), '80.3'); assert.equal(fmtWeight(80.05), '80.1');
  assert.equal(fmtChange(1), '+1.0'); assert.equal(fmtChange(NaN), EMPTY);
  assert.ok(!fmtRate(-0.5).includes('-'));
});

test('pure: same input gives the same output and input is not changed', () => {
  const w = weekly('2026-01-03', [82.0, 81.5, 81.0, 80.5, 80.0]);
  const copy = JSON.parse(JSON.stringify(w));
  assert.deepEqual(trendSummary(w, 'cut'), trendSummary(w, 'cut'));
  assert.deepEqual(w, copy);
});

test('weeklyRate on an empty series', () => {
  assert.equal(weeklyRate([]).reason, 'no_data');
});
