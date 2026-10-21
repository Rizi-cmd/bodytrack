// Tests for js/analyticsView.js (analytics screen text and chart geometry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trendSummary, day } from '../js/trend.js';
import { rateView, weeklyBars, projection } from '../js/analytics.js';
import { trendFigure, pctScale, zoneText, barsFigure, barTicks, gapText, waistPerKgText, projectionText, spanText } from '../js/analyticsView.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
const addDays = (iso, n) => new Date((day(iso) + n) * 86400000).toISOString().slice(0, 10);
const weekly = (start, kgs) => kgs.map((kg, k) => ({ id: 'w' + k, date: addDays(start, 7 * k), kg }));
const ph = (from, phase, targetKg = null) => ({ id: `p-${from}`, type: 'phase', from, phase, targetKg });
const V6 = weekly('2026-05-02', [0, 1, 2, 3, 4, 5, 6, 7].map(k => 70 + 0.25 * k));

test('trendFigure: two phase bands meet without a gap, labels by width, tagged ring', () => {
  const S = trendSummary(V6, 'bulk', '2026-06-20');
  const recs = [ph('2026-05-02', 'bulk'), ph('2026-06-01', 'cut')];
  const C = [{ date: '2026-05-16', tag: 'sick' }, { date: '2026-05-23', tag: 'normal' }, { date: '2026-05-30', tag: 'event', deleted: true }];
  const f = trendFigure(S.series, recs, C, 'all', 360);
  assert.equal(f.bands.length, 2);
  near(f.bands[0].x0, f.padL);
  near(f.bands[0].x1, f.bands[1].x0);
  near(f.bands[1].x1, 360 - f.padR);
  assert.equal(f.bands[0].label, 'מסה · מ־2.5');  // ~170 px wide
  assert.equal(f.bands[1].label, 'חיטוב · מ־1.6'); // ~140 px
  assert.deepEqual(f.dots.map(d => d.tagged), [false, false, true, false, false, false, false, false]);
  assert.equal(f.dots[7].last, true);
  assert.equal(f.tooEarly, false);
  // Narrow band: phase only, then no label.
  const g = trendFigure(S.series, [ph('2026-05-02', 'bulk'), ph('2026-06-13', 'cut')], [], 'all', 360);
  assert.equal(g.bands[1].label, 'חיטוב');
  const h = trendFigure(S.series, [ph('2026-05-02', 'bulk'), ph('2026-06-18', 'cut')], [], 'all', 360);
  assert.equal(h.bands[1].label, null);
});

test('trendFigure: a band that starts before the view is clipped; no phase → no bands; too early', () => {
  const S = trendSummary(V6, 'bulk', '2026-06-20');
  const f = trendFigure(S.series, [ph('2026-01-01', 'bulk')], [], 'month', 360);
  assert.equal(f.bands.length, 1);
  near(f.bands[0].x0, f.padL);
  assert.equal(f.bands[0].label, 'מסה · מ־1.1'); // label keeps the run's real start
  assert.equal(trendFigure(S.series, [], [], 'all', 360).bands.length, 0);
  const few = trendSummary(V6.slice(0, 3), null, '2026-06-20');
  assert.equal(trendFigure(few.series, [], [], 'all', 360).tooEarly, true);
  assert.equal(trendFigure([], [], [], 'all', 360), null);
});

test('pctScale: band and marker in the goal direction; off-scale clipped', () => {
  const r6 = rateView(trendSummary(weekly('2026-01-03', [82, 81, 80, 79, 78]), 'cut', '2026-01-31'), []); // −1.26 %
  const g = pctScale(r6, 278); // plot width 250
  near(g.bandFrom, 14 + 0.5 / 1.25 * 250);
  near(g.bandTo, 14 + 1.0 / 1.25 * 250);
  assert.equal(g.marker.clipped, true);
  near(g.marker.x, 14 + 250);
  assert.deepEqual(g.ticks.map(t => t.label), ['0%', '0.25%', '0.5%', '0.75%', '1%']);
  const away = rateView(trendSummary(V6, 'cut', '2026-06-20'), []);
  const ga = pctScale(away, 300);
  assert.equal(ga.marker.clipped, true);
  near(ga.marker.x, 14);
  assert.equal(pctScale(rateView(trendSummary(V6, 'maintenance', '2026-06-20'), []), 300), null);
});

test('zoneText for every zone and phase', () => {
  const v = (zone, band = [0.5, 1]) => ({ zone, band });
  assert.equal(zoneText(v('in'), 'cut'), 'בתוך טווח היעד לחיטוב (0.5–1% בשבוע)');
  assert.equal(zoneText(v('below', [0.25, 0.5]), 'bulk'), 'איטי יותר מטווח היעד למסה (0.25–0.5% בשבוע)');
  assert.equal(zoneText(v('above'), 'cut'), 'מהיר יותר מטווח היעד לחיטוב (0.5–1% בשבוע)');
  assert.match(zoneText(v('stuck'), 'cut'), /^תקוע\./);
  assert.match(zoneText(v('wrong_direction'), 'cut'), /^בכיוון ההפוך מהיעד\./);
  assert.match(zoneText({ zone: null, band: null }, 'maintenance'), /^בתחזוקה/);
  assert.match(zoneText({ zone: null, band: null }, null), /^לא נבחר שלב/);
});

test('barTicks: zero included, at most 5 ticks, decimals by step', () => {
  assert.deepEqual(barTicks(-0.42, 0), { values: [-0.6, -0.4, -0.2, 0], dec: 1 });
  assert.deepEqual(barTicks(0, 0.25), { values: [0, 0.1, 0.2, 0.3], dec: 1 });
  assert.deepEqual(barTicks(-0.7, 0), { values: [-0.8, -0.6, -0.4, -0.2, 0], dec: 1 });
  assert.deepEqual(barTicks(0, 0), { values: [0, 0.05, 0.1], dec: 2 });
  assert.deepEqual(barTicks(-1, 0.5), { values: [-1, -0.5, 0, 0.5], dec: 1 });
});

test('barsFigure: oldest bar on the left, empty slots, signed labels, tag star, phase line', () => {
  const S = trendSummary(V6, 'bulk', '2026-06-20');
  const C = [{ date: '2026-06-18', tag: 'vacation' }];
  const wb = weeklyBars(S.series, [ph('2026-05-02', 'bulk'), ph('2026-06-10', 'cut')], C);
  const f = barsFigure(wb, 360);
  assert.equal(f.bars.length, 8);
  assert.deepEqual(f.bars.map(b => b.label), ['2.5', '9.5', '16.5', '23.5', '30.5', '6.6', '13.6', '20.6*']);
  assert.equal(f.bars[7].label, '20.6*');
  assert.equal(f.bars[0].label, '2.5');
  assert.deepEqual(f.bars.map(b => !!b.empty), [true, true, true, true, false, false, false, false]);
  assert.equal(f.bars[7].text, '+0.25');
  assert.equal(f.bars[0].text, '—');
  assert.ok(f.bars[4].cx < f.bars[7].cx);
  assert.ok(f.bars[7].y + f.bars[7].h <= f.zero + 1e-9 && f.bars[7].ty < f.bars[7].y); // up bar, label above
  assert.deepEqual(f.y.map(t => t.label), ['0', '+0.1', '+0.2', '+0.3']);
  assert.equal(f.boundaries.length, 1);
  // 06-10 sits between the 06-06 and 06-13 bin ends: inside the 7th slot (bin ending 06-13).
  const slot = (360 - 40 - 8) / 8;
  assert.ok(f.boundaries[0] > 40 + slot * 6 && f.boundaries[0] < 40 + slot * 7);
  assert.equal(f.anyTagged, true);
  assert.equal(barsFigure({ bars: [], boundaries: [], enough: false }, 360), null);
});

test('barsFigure: a down bar hangs below zero with the label under it', () => {
  const S = trendSummary(weekly('2026-01-03', [82, 81, 80, 79, 78, 77, 76]), 'cut', '2026-02-14');
  const f = barsFigure(weeklyBars(S.series, [], []), 360);
  const b = f.bars[7];
  assert.equal(b.text, '−1.00');
  near(b.y, f.zero);
  assert.ok(b.ty > b.y + b.h);
});

test('gapText, spanText', () => {
  assert.deepEqual(gapText(null), { big: '—', sub: null });
  assert.deepEqual(gapText({ days: 7, from: '2026-02-22', to: '2026-03-01', open: false }), { big: '7', sub: '22.2–1.3' });
  assert.deepEqual(gapText({ days: 20, from: '2026-03-01', to: '2026-03-21', open: true }), { big: '20', sub: 'מ־1.3 ועד היום' });
  assert.equal(spanText([]), null);
  assert.deepEqual(spanText([{ date: '2026-04-17' }, { date: '2026-10-16' }]), { from: '17.4.2026', to: '16.10.2026', count: '2 שקילות' });
  assert.equal(spanText([{ date: '2026-04-17' }]).count, 'שקילה אחת');
});

test('waistPerKgText labels and reasons', () => {
  assert.deepEqual(waistPerKgText({ ratio: 1, phase: 'cut', reason: null }), { label: 'ס״מ מותניים (טבור) לכל ק״ג שירד', reason: null });
  assert.equal(waistPerKgText({ ratio: null, phase: 'bulk', reason: 'too_small' }).label, 'ס״מ מותניים (טבור) לכל ק״ג שעלה');
  for (const r of ['no_phase', 'no_base', 'no_trend', 'wrong_direction', 'too_small'])
    assert.ok(waistPerKgText({ ratio: null, phase: 'cut', reason: r }).reason, r);
});

test('projectionText: P1 numbers and a reason for every other case', () => {
  const S = trendSummary(V6, 'bulk', '2026-06-20');
  const p = projectionText(projection(S, [ph('2026-05-02', 'bulk', 75.0)], '2026-06-20'));
  assert.deepEqual(p, { big: '15', unit: 'שבועות', range: '11–23', month: 'ספטמבר 2026', target: 75, reason: null });
  for (const r of ['no_projection_phase', 'no_target', 'too_early', 'reached', 'provisional', 'stuck', 'wrong_direction', 'too_far']) {
    const t = projectionText({ reason: r });
    assert.equal(t.big, '—'); assert.ok(t.reason, r);
  }
});

test('projectionText: one week and under a week read naturally', () => {
  const base = { reason: null, fast: 1, slow: 2, monthText: 'נובמבר 2026', target: 80 };
  assert.deepEqual([projectionText({ ...base, weeksText: '1' }).big, projectionText({ ...base, weeksText: '1' }).unit], ['1', 'שבוע']);
  assert.deepEqual([projectionText({ ...base, weeksText: '0' }).big, projectionText({ ...base, weeksText: '0' }).unit], ['פחות מ־1', 'שבוע']);
});

test('barsFigure: on a narrow chart every other value label sits one line further out', () => {
  const S = trendSummary(weekly('2026-01-03', [82, 81, 80, 79, 78, 77, 76]), 'cut', '2026-02-14');
  const wb = weeklyBars(S.series, [], []);
  const narrow = barsFigure(wb, 340), wide = barsFigure(wb, 560);
  const off = f => f.bars[7].ty - (f.bars[7].y + f.bars[7].h);
  assert.equal(off(narrow) - off(wide), 14);
});
