// Tests for js/report.js (verdict screen text, tones and chart geometry) and the phase handling in trendSummary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trendSummary, day } from '../js/trend.js';
import {
  verdictText, tooEarlyReason, phasePick, isPhaseRecord, circCaption, parseTarget, activePhase, weighinStats, cadenceText, changeView, footnotes, circRows, scaleGeometry, yTicks, weightChart, nearestPoint, pointReadout, fmtDay, rateZone, lensPoints, lastWeighinLine
} from '../js/report.js';

const M = '−';
const fx = () => JSON.parse(readFileSync(new URL('./fixtures/sample-backup.json', import.meta.url), 'utf8'));
const addDays = (iso, n) => new Date((day(iso) + n) * 86400000).toISOString().slice(0, 10);
const weekly = (start, kgs) => kgs.map((kg, k) => ({ date: addDays(start, 7 * k), kg }));

test('verdict words and tones', () => {
  const v = s => verdictText(s, 10);
  assert.deepEqual(v({ verdict: 'toward', arrow: 'down' }), { arrow: '↓', word: 'יורד', tone: 'good', label: 'לכיוון היעד', slow: false, slowWord: '' });
  assert.equal(v({ verdict: 'away', arrow: 'up' }).tone, 'bad');
  assert.equal(v({ verdict: 'stuck', arrow: 'flat' }).label, 'פחות מ־0.2 ק״ג בשבוע');
  assert.equal(v({ verdict: 'holding', arrow: 'flat' }).tone, 'good');
  assert.equal(v({ verdict: 'no_phase', arrow: 'up' }).tone, 'ink');
  assert.equal(v({ verdict: 'too_early', arrow: null, reason: 'no_data' }).word, 'מוקדם להגיד');
});

test('too-early reasons', () => {
  assert.equal(tooEarlyReason('no_data', 0), 'אין עדיין שקילות');
  assert.equal(tooEarlyReason('need_more_weighins', 3), 'יש 3 שקילות, צריך לפחות 5');
  assert.equal(tooEarlyReason('need_more_weighins', 9), 'אין מספיק שקילות בחודש האחרון');
  assert.match(tooEarlyReason('span_too_short', 5), /שבועיים/);
});

test('changeView: tone only toward/away from goal, zero is neutral', () => {
  assert.deepEqual(changeView(-1.3, -1), { text: M + '1.3', arrow: '↓', word: 'ירד', tone: 'good' });
  assert.equal(changeView(-1.3, 1).tone, 'bad');
  assert.equal(changeView(0.6, 0).tone, 'ink');
  assert.equal(changeView(0.6, null).tone, 'ink');
  assert.deepEqual(changeView(0.04, -1), { text: '0.0', arrow: '→', word: 'בלי שינוי', tone: 'ink', zero: true });
  assert.equal(changeView(null, -1), null);
});

test('fixture: summary, footnote for the tagged weigh-in, circumference rows', () => {
  const f = fx();
  const s = trendSummary(f.weighins, 'cut');
  // the invented check-in on 29.8 is tagged "sick"; it feeds the rate only if it is in windowDates
  const notes = footnotes(s, f.checkins);
  assert.equal(notes.some(n => n.includes('מחלה')), s.windowDates.includes('2026-08-29'));
  const rows = circRows(f.measurements);
  const waist = rows.find(r => r.site === 'waist');
  assert.ok(waist && waist.prevDate && waist.change);
  assert.equal(waist.cmText, '79.5');
  assert.equal(waist.change.tone, 'ink');
  // rows keep the check-in order of SITES
  assert.equal(rows[0].site, 'waist_navel');
});

test('circRows: deleted ignored, single measurement has no change, same-day duplicates averaged', () => {
  const rows = circRows([
    { date: '2026-01-01', site: 'waist', cm: 80 },
    { date: '2026-01-08', site: 'waist', cm: 79 }, { date: '2026-01-08', site: 'waist', cm: 78 },
    { date: '2026-01-15', site: 'waist', cm: 50, deleted: true },
    { date: '2026-01-08', site: 'neck', cm: 40 }
  ]);
  const w = rows.find(r => r.site === 'waist');
  assert.equal(w.cm, 78.5); assert.equal(w.change.text, M + '1.5'); assert.equal(w.prevDate, '2026-01-01');
  assert.equal(rows.find(r => r.site === 'neck').change, null);
});

test('footnotes: provisional and phase change', () => {
  const s = { rate: -0.5, provisional: true, phaseChangedInWindow: true, windowDates: [] };
  assert.equal(footnotes(s, []).length, 2);
  assert.deepEqual(footnotes({ ...s, rate: null }, []), ['השלב השתנה בתוך תקופת החישוב.']);
});

test('scale: centre zero, LTR, clamped marker', () => {
  const g = scaleGeometry(-0.3, 350);
  assert.equal(g.zero, 175); assert.ok(g.marker.x < g.zero);
  assert.ok(Math.abs(g.bandTo - g.bandFrom - 0.2 * 322) < 1e-9);
  assert.equal(scaleGeometry(-1.7, 350).marker.x, 14);
  assert.equal(scaleGeometry(-1.7, 350).marker.clipped, true);
  assert.equal(scaleGeometry(null, 350).marker, null);
  assert.deepEqual(g.ticks.map(t => t.label), [M + '1.0', M + '0.5', '0', '+0.5', '+1.0']);
});

test('yTicks cover the range with ≤5 ticks', () => {
  for (const [a, b] of [[80.1, 84.2], [79.9, 80.3], [60, 90], [80, 80]]) {
    const t = yTicks(a, b);
    assert.ok(t.length >= 2 && t.length <= 5, `${a}-${b}: ${t}`);
    assert.ok(t[0] <= Math.min(a, b) && t[t.length - 1] >= Math.max(a, b), `${a}-${b}: ${t}`);
  }
});

test('weight chart: ranges, points inside the plot, month labels', () => {
  const s = trendSummary(fx().weighins, 'cut').series;
  const all = weightChart(s, 'all', 390), m = weightChart(s, 'month', 390);
  assert.equal(all.count, 16);
  assert.ok(m.count < all.count && m.count >= 4);
  for (const c of [all, m]) {
    for (const p of [...c.dots, c.last]) {
      assert.ok(p.x >= c.padL - 1e-9 && p.x <= c.width - c.padR + 1e-9);
      assert.ok(p.y >= c.padT - 1e-9 && p.y <= c.plotBottom + 1e-9);
    }
  }
  assert.equal(all.last.label, '80.2');
  assert.deepEqual(all.x.map(t => t.label), ['יולי', 'אוג׳', 'ספט׳', 'אוק׳']);
  assert.equal(all.line.length, 1); // no gaps in the average line
  assert.equal(weightChart([], 'all', 390), null);
  // Long-press readout: one point per weigh-in in view, nearest by x, average only once it exists.
  assert.equal(all.points.length, all.count);
  assert.equal(nearestPoint(all.points, -50), all.points[0]);
  assert.equal(nearestPoint(all.points, 9999), all.points[all.points.length - 1]);
  const mid = all.points[5];
  assert.equal(nearestPoint(all.points, mid.x + 1), mid);
  assert.deepEqual(pointReadout(all.points[all.points.length - 1]), { date: '10.10.2026', kg: '80.2', avg: '80.6', tag: null, note: null });
  // That day's check-in: week type (not "normal") and note; deleted check-ins ignored.
  const sick = all.points.find(p => p.date === '2026-08-29');
  assert.deepEqual([pointReadout(sick, fx().checkins).tag, pointReadout(sick, fx().checkins).note], ['מחלה', 'SAMPLE: invented note']);
  const d = sick.date;
  assert.equal(pointReadout(sick, [{ id: 'x', date: d, tag: 'normal', note: '  ' }]).tag, null);
  assert.equal(pointReadout(sick, [{ id: 'x', date: d, tag: 'normal', note: '  ' }]).note, null);
  assert.equal(pointReadout(sick, [{ id: 'x', date: d, tag: 'event', note: 'x', deleted: true }]).tag, null);
  assert.equal(pointReadout(all.points[0]).avg, null);
  assert.equal(nearestPoint([], 10), null);
  // A year of weekly weigh-ins: 6 months = the last 183 days (27 weigh-ins), between 3 months and all.
  const year = trendSummary(weekly('2025-10-04', Array.from({ length: 52 }, (_, k) => 90 - k * 0.2)), 'cut').series;
  assert.deepEqual(['month', 'quarter', 'half', 'all'].map(r => weightChart(year, r, 390).count), [5, 14, 27, 52]);
  const one = weightChart(trendSummary([{ date: '2026-01-03', kg: 80 }]).series, 'all', 390);
  assert.equal(one.count, 1); assert.equal(one.line.length, 0); assert.equal(one.x.length, 1);
});

test('month labels roll over the new year', () => {
  const s = trendSummary(weekly('2026-11-20', [80, 80, 80, 80, 80, 80, 80, 80, 80, 80])).series;
  assert.deepEqual(weightChart(s, 'all', 390).x.map(t => t.label), ['דצמ׳', 'ינו׳']);
});

test('phase records: picked today applies at once; first pick is not a change', () => {
  const w = weekly('2026-01-03', [82.0, 81.5, 81.0, 80.5, 80.0]);
  const first = trendSummary(w, [{ from: '2026-01-03', phase: 'cut' }], '2026-02-02');
  assert.equal(first.phase, 'cut'); assert.equal(first.phaseChangedInWindow, false);
  const later = trendSummary(w, [{ from: '2026-01-03', phase: 'cut' }, { from: '2026-02-02', phase: 'bulk' }], '2026-02-02');
  assert.equal(later.phase, 'bulk'); assert.equal(later.verdict, 'away'); assert.equal(later.phaseChangedInWindow, true);
  assert.equal(fmtDay('2026-02-02'), '2.2');
});

test('phasePick: first pick covers history; re-pick replaces; same-day picks replace', () => {
  const a = phasePick([], 'cut', '2026-02-02', '2026-01-03', 1);
  assert.equal(a.from, '2026-01-03'); assert.equal(a.first, true);
  const b = phasePick([a], 'bulk', '2026-02-02', '2026-01-03', 2);   // fix a wrong first pick
  assert.equal(b.id, a.id); assert.equal(b.phase, 'bulk'); assert.equal(b.from, '2026-01-03');
  const recs = [a, { id: 'phase-9', type: 'phase', from: '2026-01-20', phase: 'bulk' }];
  const c = phasePick(recs, 'maintenance', '2026-02-02', '2026-01-03', 3);
  assert.equal(c.from, '2026-02-02'); assert.notEqual(c.id, a.id);
  const d = phasePick([...recs, c], 'cut', '2026-02-02', '2026-01-03', 4); // second tap the same day
  assert.equal(d.id, c.id); assert.equal(d.phase, 'cut');
  assert.equal(phasePick([], 'cut', '2026-02-02', null, 5).from, '2026-02-02');
});

test('cut → bulk → cut on one day leaves no phase change', () => {
  const w = weekly('2026-01-03', [82.0, 81.5, 81.0, 80.5, 80.0]);
  let recs = [];
  for (const [ph, at] of [['cut', 1]]) recs = [phasePick(recs, ph, '2026-01-03', '2026-01-03', at)];
  // a later day: two taps
  const t = '2026-02-02';
  const x = phasePick(recs, 'bulk', t, '2026-01-03', 2); recs = [...recs.filter(r => r.id !== x.id), x];
  recs = recs.map(r => r); // keep first record
  const first = recs.find(r => r.first);
  // first record replaced only when it is the only one; here two exist
  assert.ok(first);
  const y = phasePick(recs, 'cut', t, '2026-01-03', 3); recs = [...recs.filter(r => r.id !== y.id), y];
  const s = trendSummary(w, recs, t);
  assert.equal(s.phase, 'cut'); assert.equal(s.phaseChangedInWindow, false);
});

test('isPhaseRecord rejects broken records', () => {
  assert.equal(isPhaseRecord({ id: 'p', type: 'phase', from: '2026-01-03', phase: 'cut' }), true);
  for (const r of [null, {}, { type: 'phase', from: 20260103, phase: 'cut' }, { type: 'phase', from: '2026-01-03', phase: 'x' },
    { type: 'phase', from: '2026-01-03', phase: 'cut', deleted: true }, { type: 'goal', from: '2026-01-03', phase: 'cut' }])
    assert.equal(isPhaseRecord(r), false, JSON.stringify(r));
});

test('circCaption: one date pair, or per-row dates when sites differ', () => {
  const rows = circRows(fx().measurements);
  const c = circCaption(rows);
  assert.ok(c.perRow || c.date);
  const mixed = circCaption(circRows([
    { date: '2026-01-01', site: 'waist', cm: 80 }, { date: '2026-01-08', site: 'waist', cm: 79 },
    { date: '2026-01-01', site: 'neck', cm: 40 }, { date: '2026-01-15', site: 'neck', cm: 40 }
  ]));
  assert.equal(mixed.perRow, true);
  const same = circCaption(circRows([
    { date: '2026-01-01', site: 'waist', cm: 80 }, { date: '2026-01-08', site: 'waist', cm: 79 },
    { date: '2026-01-01', site: 'neck', cm: 40 }, { date: '2026-01-08', site: 'neck', cm: 40 }
  ]));
  assert.deepEqual(same, { date: '8.1', prev: '1.1', perRow: false });
});

test('target weight: parse, validate, and same-phase save only changes the target', () => {
  assert.equal(parseTarget(''), null); assert.equal(parseTarget('  '), null);
  assert.equal(parseTarget('78,5'), 78.5); assert.equal(parseTarget('82'), 82);
  for (const t of ['abc', '7', '301', '78.555', '-80', '1e2']) assert.ok(Number.isNaN(parseTarget(t)), t);
  const a = phasePick([], 'cut', '2026-02-02', '2026-01-03', 1, 78);
  assert.equal(a.targetKg, 78); assert.equal(isPhaseRecord(a), true);
  const b = phasePick([a], 'cut', '2026-02-02', '2026-01-03', 2, 77.5);
  assert.equal(b.id, a.id); assert.equal(b.from, '2026-01-03'); assert.equal(b.targetKg, 77.5);
  assert.equal(isPhaseRecord({ ...a, targetKg: 'x' }), false);
  assert.equal(activePhase([a], '2026-01-01'), null);
  assert.equal(activePhase([a], '2026-02-02').id, a.id);
});

test('cadence: days since last weigh-in and average gap over all history', () => {
  const s = trendSummary(weekly('2026-01-03', [80, 80, 80, 80, 80])).series; // 4 gaps of 7 days
  assert.deepEqual(weighinStats(s, '2026-02-11'), { daysSince: 11, avgEvery: 7 });
  assert.equal(cadenceText(weighinStats(s, '2026-02-11')), 'שקילה אחרונה לפני 11 ימים · בממוצע שקילה כל 7 ימים');
  assert.equal(cadenceText(weighinStats(s, '2026-01-31')), 'שקילה אחרונה היום · בממוצע שקילה כל 7 ימים');
  assert.equal(cadenceText(weighinStats(s, '2026-02-01')).startsWith('שקילה אחרונה אתמול'), true);
  const one = trendSummary([{ date: '2026-01-03', kg: 80 }]).series;
  assert.equal(cadenceText(weighinStats(one, '2026-01-05')), 'שקילה אחרונה לפני 2 ימים');
  assert.equal(cadenceText(weighinStats([], '2026-01-05')), '');
  assert.equal(weighinStats(s, '2026-01-20').daysSince, null); // last weigh-in dated after today
  const irregular = trendSummary([{ date: '2026-01-01', kg: 80 }, { date: '2026-01-04', kg: 80 }, { date: '2026-01-21', kg: 80 }]).series;
  assert.equal(weighinStats(irregular, '2026-01-21').avgEvery, 10);
});

test('footnote for a trend reaching back past 28 days', () => {
  const w = [...weekly('2026-01-03', [80, 80, 80, 80]), { date: '2026-03-07', kg: 78.0 }];
  const s = trendSummary(w, 'cut');
  assert.ok(footnotes(s, []).some(n => n === 'הקצב חושב על פני 9 שבועות, כי היו מעט שקילות בחודש האחרון.'));
});

test('slow verdict: toward the goal but under the target band', () => {
  const S = (phase, rate, verdict = 'toward') => ({ verdict, arrow: rate < 0 ? 'down' : 'up', phase, rate, avg: 80 });
  // cut band 0.5–1 %/wk of 80 kg = 0.4–0.8 kg/wk
  assert.equal(verdictText(S('cut', -0.30), 10).slow, true);
  assert.equal(verdictText(S('cut', -0.30), 10).slowWord, 'איטי');
  assert.equal(verdictText(S('cut', -0.30), 10).tone, 'good');
  assert.equal(verdictText(S('cut', -0.40), 10).slow, false); // exactly 0.5 % = in range
  assert.equal(verdictText(S('cut', -0.90), 10).slow, false); // above range is not slow
  // bulk band 0.25–0.5 % = 0.2–0.4 kg/wk
  assert.equal(verdictText(S('bulk', 0.19, 'stuck'), 10).slow, undefined);
  assert.equal(verdictText(S('bulk', 0.30), 10).slow, false);
  assert.equal(verdictText(S('maintenance', -0.3), 10).slow, false); // no band in maintenance
  assert.equal(verdictText(S('cut', 0.5, 'away'), 10).tone, 'bad');
});

test('rateZone', () => {
  const z = (phase, rate, verdict = 'toward') => rateZone({ phase, rate, verdict, avg: 100 });
  assert.equal(z('cut', -0.4), 'below');
  assert.equal(z('cut', -0.5), 'in');
  assert.equal(z('cut', -1.0), 'in');
  assert.equal(z('cut', -1.1), 'above');
  assert.equal(z('cut', 0.3, 'away'), 'wrong_direction');
  assert.equal(z('cut', -0.1, 'stuck'), 'stuck');
  assert.equal(z('maintenance', -0.4), null);
  assert.equal(z('cut', null), null);
});

test('lens points: the last 4 weigh-ins', () => {
  assert.deepEqual(lensPoints([]), { points: [], avgY: null });
  const s = weekly('2026-01-03', [81, 80, 79, 78, 77]);
  const L = lensPoints(s);
  assert.deepEqual(L.points.map(p => p.kg), [80, 79, 78, 77]);
  assert.deepEqual(L.points.map(p => +p.x.toFixed(3)), [0.2, 0.4, 0.6, 0.8]);
  assert.ok(L.points[0].y < L.points[3].y); // heavier = higher on screen
  assert.equal(+L.avgY.toFixed(3), 0.5);     // average 78.5 = middle
  const flat = lensPoints(weekly('2026-01-03', [80, 80, 80, 80]));
  assert.ok(flat.points.every(p => p.y === 0.5));
  const two = lensPoints(weekly('2026-01-03', [80, 79]));
  assert.equal(two.points.length, 2);
  assert.equal(two.avgY, null); // no average of 4 yet
  assert.equal(lensPoints([{ date: '2026-01-03', kg: 80 }]).points[0].x, 0.5);
});

test('last weigh-in line on the dark home', () => {
  const s = weekly('2026-01-03', [80, 79]); // last 2026-01-10
  assert.equal(lastWeighinLine([], '2026-01-10'), null);
  assert.deepEqual(lastWeighinLine(s, '2026-01-20'), { date: '10.1.2026', stale: false, ago: '' });
  assert.deepEqual(lastWeighinLine(s, '2026-01-21'), { date: '10.1.2026', stale: true, ago: 'לפני 11 ימים' });
});
