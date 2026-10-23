// Tests for js/journey.js against the vectors in docs/specs/weight-page.md §8, plus every scenario in §10.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trendSummary, day } from '../js/trend.js';
import { weightHero, journeyBase, journeyPoints, phaseProgress, journeyProjection, kgLeft, phaseWeek } from '../js/journey.js';

const M = '−';
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} expected ${b}, got ${a}`);
const addDays = (iso, n) => new Date((day(iso) + n) * 86400000).toISOString().slice(0, 10);
const weekly = (start, kgs) => kgs.map((kg, k) => ({ id: 'w' + k, date: addDays(start, 7 * k), kg }));
const ph = (from, phase, targetKg = null) => ({ id: `p-${from}-${phase}`, type: 'phase', from, phase, targetKg });
const S = (w, recs, today) => trendSummary(w, recs, today);
const pts = j => j.segments.map(s => s.map(p => [p.date.slice(5), +p.kg.toFixed(6)]));

const V4 = weekly('2026-01-03', [82.0, 81.5, 81.0, 80.5, 80.0]);
const V6 = weekly('2026-05-02', [0, 1, 2, 3, 4, 5, 6, 7].map(k => 70 + 0.25 * k)); // last 06-20
const G2 = weekly('2026-01-03', [82, 81.5, 81, 80.5, 80, 79.5]);                    // last 02-07
const J2 = [...weekly('2026-01-03', [80, 80, 80, 80, 80]), { date: '2026-03-07', kg: 79 }, { date: '2026-03-14', kg: 79 }];

test('J1 weekly points, start falls back to the first average', () => {
  const R = [ph('2026-05-02', 'bulk', 75)], s = S(V6, R, '2026-06-20'), j = journeyPoints(s.series, R, '2026-06-20');
  assert.deepEqual(pts(j), [[['05-23', 70.375], ['05-30', 70.625], ['06-06', 70.875], ['06-13', 71.125], ['06-20', 71.375]]]);
  assert.deepEqual(j.start, { date: '2026-05-23', kg: 70.375 });
});
test('J2 a gap over 14 days splits the line', () => {
  const R = [ph('2026-01-03', 'cut', 75)], j = journeyPoints(S(J2, R, '2026-03-14').series, R, '2026-03-14');
  assert.deepEqual(pts(j), [[['01-24', 80], ['01-31', 80]], [['03-07', 79.75], ['03-14', 79.5]]]);
});
test('J3 several weigh-ins in a week → one point, the last average of that week', () => {
  const w = ['01-01', '01-02', '01-03', '01-04'].map(d => ({ date: '2026-' + d, kg: 80 }))
    .concat([{ date: '2026-01-08', kg: 79.6 }, { date: '2026-01-09', kg: 79.2 }, { date: '2026-01-11', kg: 79.0 }]);
  const j = journeyPoints(S(w, [], '2026-01-11').series, [], '2026-01-11');
  assert.deepEqual(pts(j), [[['01-09', 79.7], ['01-11', 79.45]]]);
});
test('J4 under 5 weigh-ins: raw dots only', () => {
  const w = weekly('2026-01-03', [80.0, 79.8, 79.6]), j = journeyPoints(S(w, [], '2026-01-17').series, [], '2026-01-17');
  assert.deepEqual(j.segments, []); assert.equal(j.start, null); assert.equal(j.raw.length, 3);
  assert.equal(journeyPoints([], [], '2026-01-17').raw.length, 0);
});

test('G1 bulk: change and % of the way', () => {
  const R = [ph('2026-05-02', 'bulk', 75)], g = phaseProgress(S(V6, R, '2026-06-20'), R, '2026-06-20');
  near(g.change, 1.0); assert.equal(g.changeText, '+1.0'); assert.equal(g.pct, 21); assert.equal(g.pctText, '21% מהדרך ליעד');
  near(g.fill, 1 / 4.625);
});
test('G2 base = trend on the phase start date', () => {
  const R = [ph('2026-01-27', 'cut', 78)], s = S(G2, R, '2026-02-07');
  near(journeyBase(s.series, R, '2026-02-07').kg, 81.0357142857);
  const g = phaseProgress(s, R, '2026-02-07');
  near(g.change, -0.7857142857); assert.equal(g.changeText, M + '0.8'); assert.equal(g.pct, 25);
});
test('G3 no trend on the start date → first average after it', () => {
  const R = [ph('2026-01-20', 'cut', 78)], g = phaseProgress(S(G2, R, '2026-02-07'), R, '2026-02-07');
  near(g.change, -1.0); assert.equal(g.pct, 30);
});
test('G4–G6 moving away, overshoot, target behind the start', () => {
  // G4: cut, trend going up → 0%, empty ring, change still signed
  const up = weekly('2026-01-03', [80, 80, 80, 80, 80.4, 80.8, 81.2, 81.6]), R4 = [ph('2026-01-24', 'cut', 78)];
  const g4 = phaseProgress(S(up, R4, '2026-02-21'), R4, '2026-02-21');
  assert.equal(g4.pct, 0); assert.equal(g4.fill, 0); assert.ok(g4.change > 0); assert.equal(g4.reached, false);
  // G5: cut past the target → 100%, reached
  const R5 = [ph('2026-01-24', 'cut', 81.0)], g5 = phaseProgress(S(G2, R5, '2026-02-07'), R5, '2026-02-07');
  assert.equal(g5.pct, 100); assert.equal(g5.fill, 1); assert.equal(g5.reached, true);
  // G6: cut with a target above the start → no ring
  const R6 = [ph('2026-01-24', 'cut', 90)], g6 = phaseProgress(S(G2, R6, '2026-02-07'), R6, '2026-02-07');
  assert.equal(g6.pct, null); assert.equal(g6.fill, 0); assert.notEqual(g6.change, null);
});
test('G7 maintenance / no target / no phase: change only', () => {
  for (const R of [[ph('2026-05-02', 'maintenance', 75)], [ph('2026-05-02', 'bulk')], []]) {
    const g = phaseProgress(S(V6, R, '2026-06-20'), R, '2026-06-20');
    assert.equal(g.pct, null); near(g.change, 1.0);
  }
});
test('G8 TE V4 with the first record cut', () => {
  const R = [ph('2026-01-03', 'cut')], g = phaseProgress(S(V4, R, '2026-01-31'), R, '2026-01-31');
  near(g.change, -0.5); assert.equal(g.changeText, M + '0.5');
});
test('phase picked on the last weigh-in date → change "—"', () => {
  const R = [ph('2026-06-20', 'bulk', 75)], g = phaseProgress(S(V6, R, '2026-06-20'), R, '2026-06-20');
  assert.equal(g.change, null); assert.equal(g.changeText, '—'); assert.equal(g.pct, null);
});
test('under 5 weigh-ins → "—", empty ring', () => {
  const R = [ph('2026-01-03', 'cut', 75)], g = phaseProgress(S(V4.slice(0, 4), R, '2026-01-24'), R, '2026-01-24');
  assert.equal(g.changeText, '—'); assert.equal(g.pct, null);
});

test('P1 projection line, text and kg left', () => {
  const R = [ph('2026-05-02', 'bulk', 75)], s = S(V6, R, '2026-06-20'), p = journeyProjection(s, R, '2026-06-20');
  assert.equal(p.reason, null); assert.equal(p.text, 'ספטמבר 2026 · 15 שבועות (11–23)');
  assert.deepEqual(p.line, { from: { date: '2026-06-20', kg: 71.375 }, to: { date: '2026-09-30', kg: 75 } });
  assert.equal(kgLeft(s, R, '2026-06-20'), '3.6');
});
test('P2/P3 stale guard: hidden after 10 days, shown on day 10', () => {
  const R = [ph('2026-05-02', 'bulk', 75)];
  const p2 = journeyProjection(S(V6, R, '2026-07-01'), R, '2026-07-01');
  assert.equal(p2.reason, 'stale'); assert.equal(p2.line, undefined); assert.equal(p2.text, 'השקילה האחרונה ישנה מדי לצפי');
  assert.equal(journeyProjection(S(V6, R, '2026-06-30'), R, '2026-06-30').reason, null);
});
test('projection hidden for every other reason', () => {
  const t = '2026-06-20', run = (w, R, d = t) => journeyProjection(S(w, R, d), R, d);
  assert.equal(run(V6, [ph('2026-05-02', 'cut', 68)]).reason, 'wrong_direction');
  assert.equal(run(V6, [ph('2026-05-02', 'bulk', 71)]).reason, 'reached');
  assert.equal(run(V6, [ph('2026-05-02', 'maintenance', 75)]).reason, 'no_projection_phase');
  assert.equal(run(V6, [ph('2026-05-02', 'bulk')]).reason, 'no_target');
  assert.equal(run(V6, []).reason, 'no_projection_phase');
  assert.equal(run(V4, [ph('2026-01-03', 'cut', 75)], '2026-01-31').reason, 'provisional');
  const far = run(V6, [ph('2026-05-02', 'bulk', 90)]);
  assert.equal(far.reason, 'too_far'); assert.equal(far.text, 'יותר משנה בקצב הנוכחי'); assert.equal(far.line, undefined);
  const flat = weekly('2026-01-03', [80, 80.1, 80, 80.1, 80, 80.1, 80, 80.1]);
  assert.equal(run(flat, [ph('2026-01-03', 'cut', 75)], '2026-02-21').reason, 'stuck');
  for (const r of ['wrong_direction', 'reached', 'no_target']) assert.equal(run(V6, [ph('2026-05-02', r === 'no_target' ? 'bulk' : r === 'reached' ? 'bulk' : 'cut', r === 'no_target' ? null : r === 'reached' ? 71 : 68)]).text, '');
});
test('kg left: reached, no target, maintenance', () => {
  const t = '2026-06-20';
  assert.equal(kgLeft(S(V6, [], t), [ph('2026-05-02', 'bulk', 71)], t), 'הושג');
  assert.equal(kgLeft(S(V6, [], t), [ph('2026-05-02', 'bulk')], t), null);
  assert.equal(kgLeft(S(V6, [], t), [ph('2026-05-02', 'maintenance', 75)], t), null);
  assert.equal(kgLeft(S(V6, [], t), [], t), null);
});

test('W1 phase week', () => {
  const R = [ph('2026-09-01', 'cut')];
  assert.deepEqual(['2026-09-01', '2026-09-07', '2026-09-08'].map(d => phaseWeek(R, d)), [1, 1, 2]);
  assert.equal(phaseWeek([], '2026-09-08'), null);
});

test('hero: average from 4, last weigh-in under 4, nothing when empty', () => {
  assert.deepEqual(weightHero(S(V4, [], '2026-01-31')), { kg: '80.8', label: 'ממוצע 4 השקילות האחרונות', isAvg: true });
  assert.deepEqual(weightHero(S(V4.slice(0, 3), [], '2026-01-17')), { kg: '81.0', label: 'שקילה אחרונה', isAvg: false });
  assert.equal(weightHero(S([], [], '2026-01-17')), null);
});
test('deleted and same-day weigh-ins: removed / merged before anything is drawn', () => {
  const w = [...V6, { date: '2026-06-20', kg: 71.75, id: 'dup' }, { date: '2026-06-13', kg: 99, deleted: true }];
  const R = [ph('2026-05-02', 'bulk', 75)], j = journeyPoints(S(w, R, '2026-06-20').series, R, '2026-06-20');
  assert.equal(j.segments[0].length, 5); near(j.segments[0][4].kg, 71.375);
});
test('no phase: the journey starts at the first weigh-in', () => {
  const j = journeyPoints(S(V6, [], '2026-06-20').series, [], '2026-06-20');
  assert.equal(j.segments[0][0].date, '2026-05-23'); assert.equal(j.start.date, '2026-05-23');
});
test('later phase: only points from its start', () => {
  const R = [ph('2026-05-02', 'cut'), ph('2026-06-06', 'bulk', 75)], j = journeyPoints(S(V6, R, '2026-06-20').series, R, '2026-06-20');
  assert.deepEqual(j.segments[0].map(p => p.date), ['2026-06-06', '2026-06-13', '2026-06-20']);
  assert.deepEqual(j.start, { date: '2026-06-06', kg: 70.875 });
});
