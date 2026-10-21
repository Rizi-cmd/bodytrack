// Tests for js/analytics.js against the vectors in docs/specs/analytics.md §12, plus edge cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trendSummary, cleanWeighins, trendSeries, day } from '../js/trend.js';
import {
  cleanMeasurements, phaseRuns, phaseStart, trendAt, siteAt, metricDirection, siteChange, phaseBands,
  rateView, weeklyBars, volatility, cadence, circTable, waistHip, waistPerKg, recomp, projection, records,
  NOISE_NOTE
} from '../js/analytics.js';

const M = '−';
const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) < eps, `${msg ?? ''} expected ${b}, got ${a}`);
const addDays = (iso, n) => new Date((day(iso) + n) * 86400000).toISOString().slice(0, 10);
const weekly = (start, kgs) => kgs.map((kg, k) => ({ id: 'w' + k, date: addDays(start, 7 * k), kg }));
const ph = (from, phase, targetKg, extra = {}) => ({ id: `p-${from}-${phase}`, type: 'phase', from, phase, targetKg, ...extra });
const ms = (site, rows) => rows.map(([date, cm, deleted]) => ({ id: `m-${date}-${site}-${cm}`, date, site, cm, deleted: !!deleted }));
const fx = () => JSON.parse(readFileSync(new URL('./fixtures/sample-backup.json', import.meta.url), 'utf8'));

const V4 = weekly('2026-01-03', [82.0, 81.5, 81.0, 80.5, 80.0]);
const V5 = weekly('2026-03-07', [80.0, 80.4, 79.8, 80.2, 80.0, 80.4, 79.8, 80.2]);
const V6 = weekly('2026-05-02', [0, 1, 2, 3, 4, 5, 6, 7].map(k => 70 + 0.25 * k));
const V7b = weekly('2026-01-03', [80, 80, 80, 80, 79.3]);
const V9 = [...weekly('2026-01-03', [81.0, 80.8, 80.6, 80.4]), { date: '2026-02-14', kg: 79.6 }];
const avgSeries = pts => pts.map(([date, avg]) => ({ date, kg: avg, avg }));

// §0 helpers
test('cleanMeasurements drops bad records and averages same-day values', () => {
  const c = cleanMeasurements([
    ...ms('waist', [['2026-01-02', 80], ['2026-01-01', 81], ['2026-01-01', 82], ['2026-01-03', 70, true]]),
    { date: '2026-01-01', site: 'nose', cm: 5 }, { date: '2026-02-30', site: 'waist', cm: 80 },
    { date: '2026-01-05', site: 'waist', cm: 4 }, { date: '2026-01-05', site: 'waist', cm: NaN }, null
  ]);
  assert.deepEqual([...c.keys()], ['waist']);
  assert.deepEqual(c.get('waist'), [{ date: '2026-01-01', cm: 81.5 }, { date: '2026-01-02', cm: 80 }]);
});

test('phaseRuns: merge same phase, later wins on same date, to = next start − 1', () => {
  const runs = phaseRuns([
    ph('2026-01-01', 'cut', 80), ph('2026-02-01', 'cut', 78), ph('2026-03-01', 'bulk', null),
    ph('2026-03-01', 'maintenance', null), ph('2026-04-01', 'cut', null, { deleted: true })
  ], '2026-05-01');
  assert.deepEqual(runs, [
    { phase: 'cut', from: '2026-01-01', to: '2026-02-28', targetKg: 78 },
    { phase: 'maintenance', from: '2026-03-01', to: '2026-05-01', targetKg: null }
  ]);
  assert.equal(phaseStart([ph('2026-01-01', 'cut'), ph('2026-02-01', 'bulk')], '2026-01-20'), '2026-01-01');
  assert.equal(phaseStart([], '2026-01-20'), null);
});

test('trendAt: exact, interpolated, no extrapolation, no bridge over 14 days', () => {
  const s = avgSeries([['2026-01-10', 80], ['2026-01-20', 79]]);
  near(trendAt(s, '2026-01-13'), 79.7);
  assert.equal(trendAt(s, '2026-01-10'), 80);
  assert.equal(trendAt(s, '2026-01-09'), null);
  assert.equal(trendAt(s, '2026-01-21'), null);
  assert.equal(trendAt(avgSeries([['2026-01-01', 80], ['2026-01-20', 79]]), '2026-01-13'), null);
});

test('siteAt: closest within 14 days, tie to the earlier', () => {
  const l = [{ date: '2026-01-01', cm: 1 }, { date: '2026-01-11', cm: 2 }];
  assert.equal(siteAt(l, '2026-01-06').cm, 1);
  assert.equal(siteAt(l, '2026-01-08').cm, 2);
  assert.equal(siteAt(l, '2026-02-01'), null);
});

test('D1 metricDirection', () => {
  assert.equal(metricDirection('waist', 'bulk'), null);
  assert.equal(metricDirection('arm_flexed', 'cut'), null);
  assert.equal(metricDirection('arm_flexed', 'maintenance'), 1);
  assert.equal(metricDirection('wrist', 'cut'), null);
  assert.equal(metricDirection('weight', 'maintenance'), 0);
  assert.equal(metricDirection('hips', null), null);
  assert.equal(metricDirection('waist_navel', 'cut'), -1);
});

test('siteChange colours only past the tape error', () => {
  const small = siteChange(-0.9, 'waist', 'cut');
  assert.equal(small.tone, 'ink'); assert.equal(small.noise, NOISE_NOTE);
  assert.equal(siteChange(-1.0, 'waist', 'cut').tone, 'good');
  assert.equal(siteChange(1.0, 'waist', 'cut').tone, 'bad');
  assert.equal(siteChange(1.4, 'chest', 'bulk').tone, 'ink');
  assert.equal(siteChange(1.5, 'chest', 'bulk').tone, 'good');
  assert.equal(siteChange(2, 'neck', 'cut').tone, 'ink');
  assert.equal(siteChange(2, 'neck', 'cut').noise, undefined); // big but no direction: plain ink
  assert.equal(siteChange(0.02, 'waist', 'cut').zero, true);
});

test('phaseBands clip to the view and drop bands outside it', () => {
  const recs = [ph('2026-01-01', 'cut', null, { first: true }), ph('2026-03-01', 'bulk'), ph('2026-06-01', 'cut')];
  assert.deepEqual(phaseBands(recs, '2026-05-15', '2026-03-10'), [
    { phase: 'bulk', from: '2026-03-01', x0: '2026-03-10', x1: '2026-05-15' }
  ]);
  assert.equal(phaseBands(recs, '2026-05-15', '2026-01-01').length, 2);
});

// §2
test('R1 rateView V4 cut', () => {
  const v = rateView(trendSummary(V4, 'cut'), []);
  near(v.pct, -0.619195, 1e-6); assert.equal(v.pctText, M + '0.62%'); assert.equal(v.kgText, M + '0.50');
  assert.equal(v.zone, 'in'); assert.equal(v.tone, 'good');
  assert.ok(v.notes.some(n => n.includes('ראשוני')));
});
test('R2 rateView V6 bulk', () => {
  const v = rateView(trendSummary(V6, 'bulk'), []);
  near(v.pct, 0.350263, 1e-6); assert.equal(v.pctText, '+0.35%'); assert.equal(v.zone, 'in');
  near(v.scale.frac, 0.35 / 1.25);
});
test('R3 rateView V6 cut', () => {
  const v = rateView(trendSummary(V6, 'cut'), []);
  assert.equal(v.zone, 'wrong_direction'); assert.equal(v.tone, 'bad');
  assert.equal(v.scale.clipped, true); assert.equal(v.scale.frac, 0);
});
test('R4 rateView V7b cut', () => assert.equal(rateView(trendSummary(V7b, 'cut'), []).zone, 'stuck'));
test('R5 rateView V9 cut', () => {
  const S = trendSummary(V9, 'cut');
  near(S.avg, 80.35); const v = rateView(S, []);
  near(v.pct, -0.290396, 1e-6); assert.equal(v.pctText, M + '0.29%'); assert.equal(v.zone, 'below');
});
test('R6 rateView fast cut', () => {
  const S = trendSummary(weekly('2026-01-03', [82, 81, 80, 79, 78]), 'cut');
  near(S.rate, -1.0); const v = rateView(S, []);
  near(v.pct, -1.257862, 1e-6); assert.equal(v.pctText, M + '1.26%'); assert.equal(v.zone, 'above');
  assert.equal(v.scale.clipped, true); assert.equal(v.scale.frac, 1);
});
test('R7 rateView V5 maintenance', () => {
  const v = rateView(trendSummary(V5, 'maintenance'), []);
  assert.equal(v.pctText, '0.00%'); assert.equal(v.band, null); assert.equal(v.zone, null); assert.equal(v.scale, null);
});
test('rateView too early and no phase', () => {
  const e = rateView(trendSummary(V4.slice(0, 3), 'cut'), []);
  assert.equal(e.kgText, '—'); assert.equal(e.pctText, '—'); assert.equal(e.zone, null);
  const n = rateView(trendSummary(V4, null), []);
  assert.equal(n.band, null); assert.equal(n.zone, null); assert.equal(n.tone, 'ink');
});

// §3
test('B1 weeklyBars V6', () => {
  const s = trendSeries(cleanWeighins(V6));
  const { bars, enough } = weeklyBars(s, [], []);
  assert.equal(bars.length, 8); assert.ok(enough);
  assert.deepEqual(bars.slice(0, 4).map(b => b.end), ['2026-06-20', '2026-06-13', '2026-06-06', '2026-05-30']);
  for (const b of bars.slice(0, 4)) { near(b.delta, 0.25); assert.equal(b.text, '+0.25'); }
  for (const b of bars.slice(4)) { assert.equal(b.delta, null); assert.equal(b.text, '—'); }
});
test('B2 weeklyBars interpolated', () => {
  const { bars } = weeklyBars(avgSeries([['2026-01-10', 80], ['2026-01-20', 79]]), [], []);
  near(bars[0].delta, -0.7); assert.equal(bars[0].text, M + '0.70');
  assert.ok(bars.slice(1).every(b => b.delta === null));
});
test('B3 weeklyBars gap too long', () => {
  const r = weeklyBars(avgSeries([['2026-01-01', 80], ['2026-01-20', 79]]), [], []);
  assert.equal(r.enough, false);
});
test('weeklyBars tag marks and phase boundaries', () => {
  const s = trendSeries(cleanWeighins(V6));
  const r = weeklyBars(s, [ph('2026-05-02', 'cut', null, { first: true }), ph('2026-06-10', 'bulk')],
    [{ date: '2026-06-14', tag: 'sick' }, { date: '2026-06-13', tag: 'normal' }, { date: '2026-06-01', tag: 'event', deleted: true }]);
  assert.deepEqual(r.boundaries, ['2026-06-10']);
  assert.deepEqual(r.bars.map(b => b.tagged), [true, false, false, false, false, false, false, false]);
});

// §4
const VO1 = weekly('2026-01-03', [80.5, 79.4, 79.3, 80.2, 80.1, 79.0, 78.9, 79.8]);
test('VO1 volatility', () => {
  const v = volatility(cleanWeighins(VO1), [], []);
  near(v.vol, 0.577350, 1e-6); assert.equal(v.text, '±0.6'); assert.equal(v.n, 8);
});
test('VO2 volatility too few', () => {
  const v = volatility(cleanWeighins(VO1.slice(0, 5)), [], []);
  assert.equal(v.vol, null); assert.equal(v.text, '—');
});
test('VO3 volatility on a straight line', () => {
  const v = volatility(cleanWeighins(weekly('2026-01-03', [0, 1, 2, 3, 4, 5, 6, 7].map(k => 80 - 0.1 * k))), [], []);
  assert.ok(v.vol < 1e-9); assert.equal(v.text, '±0.0');
});
test('volatility: since phase start when 6+ points, tagged count', () => {
  const daily = Array.from({ length: 30 }, (_, k) => ({ date: addDays('2026-01-01', 2 * k), kg: 80 + (k % 2 ? 0.5 : -0.5) }));
  const pts = cleanWeighins(daily); // D = 2026-02-28, window from 2026-01-04
  const v = volatility(pts, [ph('2026-01-01', 'cut', null, { first: true }), ph('2026-02-01', 'bulk')], [{ date: '2026-02-02', tag: 'vacation' }]);
  assert.equal(v.sincePhase, true); assert.equal(v.n, 14); assert.equal(v.tagged, 1);
  const w = volatility(pts, [ph('2026-02-20', 'bulk')], [{ date: '2026-02-02', tag: 'vacation' }]);
  assert.equal(w.sincePhase, false); assert.equal(w.tagged, 1);
});

// §5
const SUNDAYS = Array.from({ length: 9 }, (_, k) => ({ date: addDays('2026-01-04', 7 * k), kg: 80 }));
test('C1 cadence', () => {
  const c = cadence(cleanWeighins(SUNDAYS), '2026-03-01');
  near(c.perWeek, 1.0); assert.equal(c.perWeekText, '1.0');
  assert.deepEqual(c.gap, { days: 7, from: '2026-02-22', to: '2026-03-01', open: false });
});
test('C2 cadence with an open gap', () => {
  const c = cadence(cleanWeighins(SUNDAYS), '2026-03-21');
  near(c.perWeek, 0.75); assert.equal(c.perWeekText, '0.8');
  assert.deepEqual(c.gap, { days: 20, from: '2026-03-01', to: '2026-03-21', open: true });
});
const FOUR = ['2026-01-01', '2026-01-08', '2026-01-15', '2026-01-22'].map(date => ({ date, kg: 80 }));
test('C3 cadence short history', () => {
  const c = cadence(cleanWeighins(FOUR), '2026-01-28');
  near(c.perWeek, 1.0); assert.deepEqual(c.gap, { days: 7, from: '2026-01-15', to: '2026-01-22', open: false });
});
test('C4 cadence too short', () => {
  const c = cadence(cleanWeighins(FOUR), '2026-01-22');
  assert.equal(c.perWeek, null); assert.equal(c.perWeekText, '—'); assert.equal(c.gap.days, 7);
});
test('cadence: one weigh-in today, nothing', () => {
  const c = cadence([{ date: '2026-01-01', kg: 80 }], '2026-01-01');
  assert.equal(c.gap, null); assert.equal(c.perWeek, null);
  assert.equal(cadence([], '2026-01-01').gap, null);
});

// §6
test('T1 circTable', () => {
  const m = [
    ...ms('waist_navel', [['2026-05-20', 95.0], ['2026-06-03', 94.0], ['2026-07-01', 93.2], ['2026-07-01', 93.4], ['2026-07-15', 93.6], ['2026-07-15', 90.0, true]]),
    ...ms('hips', [['2026-06-01', 100.0], ['2026-07-15', 98.5]]),
    ...ms('chest', [['2026-07-15', 104.0]])
  ];
  const t = circTable(m, [ph('2026-06-01', 'cut', null)], '2026-07-20', []);
  assert.deepEqual(t.rows.map(r => r.site), ['waist_navel', 'hips', 'chest']);
  assert.equal(t.phaseStart, '2026-06-01'); assert.equal(t.perRow, true);
  const [w, h, c] = t.rows;
  assert.equal(w.cmText, '93.6');
  assert.equal(w.sinceStart.date, '2026-06-03'); near(w.sinceStart.delta, -0.4);
  assert.equal(w.sinceStart.view.text, M + '0.4'); assert.equal(w.sinceStart.view.tone, 'ink'); assert.equal(w.sinceStart.view.noise, NOISE_NOTE);
  assert.equal(w.sinceLast.date, '2026-07-01'); near(w.sinceLast.delta, 0.3);
  assert.equal(w.sinceLast.view.text, '+0.3'); assert.equal(w.sinceLast.view.tone, 'ink');
  near(h.sinceStart.delta, -1.5); assert.equal(h.sinceStart.view.tone, 'good'); assert.equal(h.sinceStart.view.arrow, '↓');
  near(h.sinceLast.delta, -1.5); assert.equal(h.sinceLast.view.tone, 'good');
  assert.equal(c.sinceStart, null); assert.equal(c.sinceLast, null);
});
test('circTable: no phase → no since-start, ink only', () => {
  const t = circTable(ms('hips', [['2026-06-01', 100.0], ['2026-07-15', 98.5]]), [], '2026-07-20', [{ date: '2026-07-15', tag: 'event' }]);
  assert.equal(t.rows[0].sinceStart, null); assert.equal(t.rows[0].sinceLast.view.tone, 'ink');
  assert.equal(t.rows[0].tag, 'אירוע');
});

// §7
test('W1 waistHip same-day pair only', () => {
  const w = waistHip([...ms('waist', [['2026-07-15', 82.0], ['2026-07-22', 81.0]]), ...ms('hips', [['2026-07-15', 98.0]])]);
  near(w.whr, 0.836735, 1e-6); assert.equal(w.text, '0.84'); assert.equal(w.date, '2026-07-15');
  assert.equal(waistHip(ms('waist', [['2026-07-15', 82.0]])).reason, 'no_pair');
});

const K1series = () => avgSeries(Array.from({ length: 7 }, (_, k) => [addDays('2026-06-03', 7 * k), 85.0 - 0.5 * k]));
const K1m = ms('waist_navel', [['2026-06-03', 94.0], ['2026-07-15', 91.0]]);
const CUT0601 = [ph('2026-06-01', 'cut', null)];
test('K1 waistPerKg', () => {
  const k = waistPerKg(K1m, K1series(), CUT0601, '2026-07-20');
  near(k.dkg, -3.0); near(k.dw, -3.0); near(k.ratio, 1.0);
  assert.equal(k.text, '1.0'); near(k.err, 0.33, 0.005); assert.equal(k.errText, '±0.3');
});
test('K2 waistPerKg too small', () => {
  const s = K1series(); s[6].avg = 83.5;
  const k = waistPerKg(K1m, s, CUT0601, '2026-07-20');
  assert.equal(k.ratio, null); assert.equal(k.reason, 'too_small');
});
test('waistPerKg reasons', () => {
  assert.equal(waistPerKg(K1m, K1series(), [ph('2026-06-01', 'maintenance')], '2026-07-20').reason, 'no_phase');
  assert.equal(waistPerKg(K1m, K1series(), [ph('2026-06-01', 'bulk')], '2026-07-20').reason, 'wrong_direction');
  assert.equal(waistPerKg(K1m.slice(1), K1series(), CUT0601, '2026-07-20').reason, 'no_base');
  assert.equal(waistPerKg(K1m, K1series().slice(1), CUT0601, '2026-07-20').reason, 'no_trend');
});

// §8
test('RC1–RC3 recomp', () => {
  const arm = v => ms('arm_relaxed', [['2026-06-03', 35.0], ['2026-07-15', v]]);
  const r1 = recomp([...K1m, ...arm(35.6)], CUT0601, '2026-07-20');
  assert.equal(r1.state, 'recomp'); assert.equal(r1.waist.view.tone, 'good'); assert.equal(r1.arm.view.tone, 'ink');
  assert.equal(recomp([...K1m, ...arm(35.4)], CUT0601, '2026-07-20').state, 'none');
  // RC3: base found, but the run lasted 25 days (< 28) → insufficient; 28 days exactly → counts
  const short = d => [...ms('waist_navel', [['2026-06-03', 94.0], [d, 92.5]]), ...ms('arm_relaxed', [['2026-06-03', 35.0], [d, 35.6]])];
  assert.equal(recomp(short('2026-06-26'), CUT0601, '2026-07-20').state, 'insufficient');
  assert.equal(recomp(short('2026-06-29'), CUT0601, '2026-07-20').state, 'recomp');
});
test('recomp falls back to the flexed arm; opposite pattern', () => {
  const m = [...ms('waist_navel', [['2026-06-03', 90.0], ['2026-07-15', 91.2]]), ...ms('arm_flexed', [['2026-06-03', 38.0], ['2026-07-15', 37.4]])];
  const r = recomp(m, [ph('2026-06-01', 'bulk')], '2026-07-20');
  assert.equal(r.state, 'opposite'); assert.equal(r.arm.site, 'arm_flexed'); assert.equal(r.arm.view.tone, 'bad');
  assert.equal(recomp(m, [], '2026-07-20').state, 'insufficient');
});

// §9
const P = (phase, targetKg) => [ph('2026-05-02', phase, targetKg)];
test('P1 projection', () => {
  const p = projection(trendSummary(V6, 'bulk'), P('bulk', 75.0), '2026-06-20');
  near(p.weeks, 14.5); assert.equal(p.weeksText, '15'); assert.equal(p.date, '2026-09-30');
  assert.equal(p.fast, 11); assert.equal(p.slow, 23); assert.equal(p.monthText, 'ספטמבר 2026');
});
test('P2–P7 projection reasons', () => {
  assert.equal(projection(trendSummary(V6, 'cut'), P('cut', 68.0), '2026-06-20').reason, 'wrong_direction');
  assert.equal(projection(trendSummary(V6, 'bulk'), P('bulk', 71.0), '2026-06-20').reason, 'reached');
  const far = projection(trendSummary(V6, 'bulk'), P('bulk', 90.0), '2026-06-20');
  assert.equal(far.reason, 'too_far'); near(far.weeks, 74.5);
  assert.equal(projection(trendSummary(V4, 'cut'), [ph('2026-01-03', 'cut', 75.0)], '2026-01-31').reason, 'provisional');
  assert.equal(projection(trendSummary(V5, 'cut'), [ph('2026-03-07', 'cut', 75.0)], '2026-04-25').reason, 'stuck');
  assert.equal(projection(trendSummary(V6, 'maintenance'), P('maintenance', 75.0), '2026-06-20').reason, 'no_projection_phase');
  assert.equal(projection(trendSummary(V6, 'bulk'), P('bulk', null), '2026-06-20').reason, 'no_target');
  assert.equal(projection(trendSummary(V4.slice(0, 3), 'cut'), [ph('2026-01-03', 'cut', 75.0)], '2026-01-31').reason, 'too_early');
});

// §10
test('RE1 records bulk', () => {
  const r = records(trendSeries(cleanWeighins(V6)), P('bulk'), '2026-06-20');
  near(r.low.avg, 70.375); assert.equal(r.low.date, '2026-05-23'); assert.equal(r.low.text, '70.4');
  near(r.high.avg, 71.375); assert.equal(r.high.date, '2026-06-20'); assert.equal(r.high.text, '71.4');
  near(r.best28.delta, 1.0); assert.equal(r.best28.from, '2026-05-23'); assert.equal(r.best28.to, '2026-06-20'); assert.equal(r.best28.text, '+1.0');
});
test('RE2 records cut', () => {
  const r = records(trendSeries(cleanWeighins(V6)), P('cut'), '2026-06-20');
  assert.equal(r.low.text, '70.4'); assert.equal(r.best28, null);
  assert.deepEqual(records([], [], '2026-06-20'), { low: null, high: null, best28: null });
});
test('records: tie goes to the earliest', () => {
  const r = records(trendSeries(cleanWeighins(V5)), [], '2026-04-25');
  assert.equal(r.low.date, '2026-03-28'); assert.equal(r.high.date, '2026-03-28');
});

// Whole fixture: every function runs and returns sane values.
test('fixture: all analytics run', () => {
  const d = fx(), today = '2026-10-21';
  const recs = [ph('2026-06-06', 'cut', 75, { first: true })];
  const S = trendSummary(d.weighins, recs, today);
  const pts = cleanWeighins(d.weighins);
  assert.ok(rateView(S, d.checkins).pctText.endsWith('%'));
  assert.ok(weeklyBars(S.series, recs, d.checkins).enough);
  assert.ok(volatility(pts, recs, d.checkins).vol !== null);
  assert.ok(cadence(pts, today).gap.open);
  assert.ok(circTable(d.measurements, recs, today, d.checkins).rows.length > 0);
  assert.ok(records(S.series, recs, today).low);
  projection(S, recs, today); waistHip(d.measurements); waistPerKg(d.measurements, S.series, recs, today); recomp(d.measurements, recs, today);
});
