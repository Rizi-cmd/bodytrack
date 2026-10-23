// Tests for js/weightView.js: the weight page as the screen shows it, one test per scenario in docs/specs/weight-page.md §10.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trendSummary, day } from '../js/trend.js';
import { weightPage, dayHeading, yRange, monthTicks, phaseRow, MIN_SPAN_KG } from '../js/weightView.js';

const M = '−';
const addDays = (iso, n) => new Date((day(iso) + n) * 86400000).toISOString().slice(0, 10);
const weekly = (start, kgs) => kgs.map((kg, k) => ({ id: 'w' + k, date: addDays(start, 7 * k), kg }));
const ph = (from, phase, targetKg = null) => ({ id: `p-${from}-${phase}`, type: 'phase', from, phase, targetKg });
const page = (w, R, today) => weightPage(trendSummary(w, R, today), R, today);
const text = parts => parts.map(p => (typeof p === 'string' ? p : p.n)).join('');

const V6 = weekly('2026-05-02', [0, 1, 2, 3, 4, 5, 6, 7].map(k => 70 + 0.25 * k)); // bulk, last 06-20
const CUT = weekly('2026-01-03', [82, 81.5, 81, 80.5, 80, 79.5, 79, 78.5]);          // cut, last 02-21

test('day heading', () => {
  assert.equal(dayHeading('2026-10-23'), 'יום שישי, 23 באוקטובר');
  assert.equal(dayHeading('2026-03-01'), 'יום ראשון, 1 במרץ');
});
test('Y range: all values, at least 2 kg, air above and below', () => {
  const r = yRange([80, 80.4]);
  assert.ok(Math.abs((r.hi - r.lo) - MIN_SPAN_KG * 1.16) < 1e-9); assert.ok(r.lo < 80 && r.hi > 80.4);
  const w = yRange([70, 75]); assert.ok(w.lo < 70 && w.hi > 75);
});
test('#23 month ticks: on the 1st, thinned on long spans, never closer than 52 px', () => {
  const t0 = day('2026-09-04'), t1 = day('2026-12-20');
  assert.deepEqual(monthTicks(t0, t1, 400).map(m => m.label), ['אוק׳', 'נוב׳', 'דצמ׳']);
  assert.equal(monthTicks(day('2026-09-01'), t1, 400)[0].label, 'ספט׳');
  const long = monthTicks(day('2025-06-10'), day('2026-10-23'), 343);
  const px = (long[1].t - long[0].t) / (day('2026-10-23') - day('2025-06-10')) * 343;
  assert.ok(px >= 52, `ticks ${px.toFixed(0)} px apart`);
  assert.ok(long.some(m => m.label === 'ינו׳ 2026'), 'January carries the year when the span crosses one');
});

test('#1 no weigh-ins: empty, phase row still there', () => {
  const p = page([], [ph('2026-09-01', 'cut', 78)], '2026-10-23');
  assert.equal(p.empty, true); assert.equal(p.hero, undefined);
  assert.equal(text(p.phase), 'שלב: חיטוב · מ-1.9 · יעד 78.0');
  assert.equal(page([], [], '2026-10-23').phase[0], 'לא נבחר שלב · בחירת שלב');
});
test('#2 1–3 weigh-ins: last weigh-in as hero, raw dots, all cells "—", no last-weigh-in row', () => {
  const R = [ph('2026-01-03', 'cut', 78)], p = page(CUT.slice(0, 3), R, '2026-01-17');
  assert.deepEqual(p.hero, { kg: '81.0', label: 'שקילה אחרונה', isAvg: false });
  assert.deepEqual(p.grid.map(g => g.v), ['—', '—', '—']);
  assert.equal(p.grid[1].sub, '0.5–1%');
  assert.equal(p.note, 'מוקדם להגיד. צריך לפחות 5 שקילות.');
  assert.deepEqual(p.rows, []);
  assert.equal(p.chart.segments.length, 0); assert.equal(p.chart.raw.length, 3);
  assert.equal(p.chart.headLabel, ''); assert.equal(p.chart.target, 78);   // the target line shows already
  assert.equal(p.key, 'נקודה = שקילה');
});
test('#3 exactly 4: hero = average, still no line and no rate; last weigh-in row appears', () => {
  const R = [ph('2026-01-03', 'cut', 78)], p = page(CUT.slice(0, 4), R, '2026-01-24');
  assert.equal(p.hero.isAvg, true); assert.equal(p.chart.segments.length, 0);
  assert.deepEqual(p.grid.map(g => g.v), ['—', '—', '—']);
  assert.deepEqual(p.rows, [{ key: 'שקילה אחרונה', kg: '80.5', date: '24.1', ago: '' }]);
});
test('#4 cut with a target, in range: line, target, projection, footnote', () => {
  const R = [ph('2026-01-03', 'cut', 76)], p = page(CUT, R, '2026-02-21');
  assert.equal(p.grid[0].v, M + '0.50'); assert.equal(p.grid[1].v, M + '0.63%'); assert.equal(p.grid[2].v, '3.3');
  assert.equal(p.grid[2].lab, 'ק״ג עד היעד');
  assert.equal(p.rows[0].key, 'צפי'); assert.equal(p.rows[0].month, 'אפריל 2026'); assert.match(p.rows[0].weeks, /^\d+$/);
  assert.equal(p.cap, 'הערכה, אם הקצב יישאר כמו עכשיו');
  assert.equal(p.chart.end.label, 'אפר׳'); assert.equal(p.chart.end.kg, 76);
  assert.equal(p.chart.headLabel, 'היום'); assert.equal(p.chart.todayT, null);
  assert.ok(p.chart.t1 > p.chart.end.t, 'the arrival date fits inside the chart');
  assert.equal(p.figCap, 'מתחילת השלב עד היעד');
  assert.equal(p.key, 'נקודה = ממוצע שבועי · ○ תחילת השלב · ┄ צפי');
  assert.ok(p.chart.y.lo < 76, 'Y includes the target');
});
test('#5 bulk with a target: target above, projection', () => {
  const R = [ph('2026-05-02', 'bulk', 75)], p = page(V6, R, '2026-06-20');
  assert.deepEqual(p.rows[0], { key: 'צפי', month: 'ספטמבר 2026', weeks: '15', range: '11–23' });
  assert.equal(p.grid[2].v, '3.6'); assert.equal(p.grid[1].sub, '0.25–0.5%');
  assert.equal(p.chart.start.label, '70.4'); assert.ok(p.chart.y.hi > 75);
});
test('#6 maintenance: no target line, no projection, "בתחזוקה אין יעד"', () => {
  const R = [ph('2026-05-02', 'maintenance', 75)], p = page(V6, R, '2026-06-20');
  assert.equal(p.chart.target, null); assert.equal(p.chart.end, null);
  assert.equal(p.grid[2].v, '—'); assert.equal(p.grid[2].lab, 'בתחזוקה אין יעד'); assert.equal(p.grid[1].sub, '');
  assert.equal(p.rows.length, 1); assert.equal(p.cap, '');
  assert.equal(text(p.phase), 'שלב: תחזוקה · מ-2.5');
});
test('#7 no phase: journey from the first weigh-in', () => {
  const p = page(V6, [], '2026-06-20');
  assert.equal(p.figCap, 'מהשקילה הראשונה'); assert.equal(p.key, 'נקודה = ממוצע שבועי · ○ השקילה הראשונה');
  assert.equal(p.phase[0], 'לא נבחר שלב · בחירת שלב'); assert.equal(p.grid[2].lab, 'אין יעד');
});
test('#8 no target: no target line, no projection, "אין יעד", phase row offers one', () => {
  const R = [ph('2026-05-02', 'bulk')], p = page(V6, R, '2026-06-20');
  assert.equal(p.chart.target, null); assert.equal(p.chart.end, null); assert.equal(p.grid[2].lab, 'אין יעד');
  assert.equal(p.figCap, 'מתחילת השלב'); assert.equal(text(p.phase), 'שלב: מסה · מ-2.5 · הגדרת יעד');
});
test('#9/#10/#11/#12 target behind / moving away / stuck / provisional: no projection row', () => {
  const t = '2026-06-20';
  for (const R of [[ph('2026-05-02', 'cut', 80)], [ph('2026-05-02', 'cut', 68)]]) {
    const p = page(V6, R, t); assert.equal(p.chart.end, null); assert.ok(!p.rows.some(r => r.key === 'צפי'));
  }
  const flat = weekly('2026-01-03', [80, 80.1, 80, 80.1, 80, 80.1, 80, 80.1]);
  assert.ok(!page(flat, [ph('2026-01-03', 'cut', 75)], '2026-02-21').rows.some(r => r.key === 'צפי'));
  assert.ok(!page(CUT.slice(0, 5), [ph('2026-01-03', 'cut', 75)], '2026-01-31').rows.some(r => r.key === 'צפי'));
});
test('#13 more than a year away: reason row, no line', () => {
  const p = page(V6, [ph('2026-05-02', 'bulk', 90)], '2026-06-20');
  assert.deepEqual(p.rows[0], { key: 'צפי', reason: 'יותר משנה בקצב הנוכחי' }); assert.equal(p.chart.end, null); assert.equal(p.cap, '');
});
test('#14 target reached: "הושג", phase row offers a change', () => {
  const p = page(V6, [ph('2026-05-02', 'bulk', 71)], '2026-06-20');
  assert.equal(p.grid[2].v, 'הושג'); assert.deepEqual(p.phase, ['הגעת ליעד · שינוי שלב']); assert.equal(p.chart.end, null);
});
test('#15 last weigh-in over 10 days old: reason row, "לפני N ימים", today line; day 10 still projects', () => {
  const R = [ph('2026-05-02', 'bulk', 75)], p = page(V6, R, '2026-07-01');
  assert.deepEqual(p.rows[0], { key: 'צפי', reason: 'השקילה האחרונה ישנה מדי לצפי' });
  assert.deepEqual(p.rows[1], { key: 'שקילה אחרונה', kg: '71.8', date: '20.6', ago: 'לפני 11 ימים' });
  assert.equal(p.chart.headLabel, '20.6'); assert.equal(p.chart.todayT, day('2026-07-01'));
  assert.ok(p.chart.t1 > p.chart.todayT);
  assert.equal(page(V6, R, '2026-06-30').rows[0].month, 'ספטמבר 2026');
  assert.equal(page(V6, R, '2026-06-30').chart.todayT, null);
});
test('#16 a gap over 14 days splits the line', () => {
  const w = [...weekly('2026-01-03', [80, 80, 80, 80, 80]), { date: '2026-03-07', kg: 79 }, { date: '2026-03-14', kg: 79 }];
  assert.equal(page(w, [ph('2026-01-03', 'cut', 75)], '2026-03-14').chart.segments.length, 2);
});
test('#19 phase changed mid-history: the chart starts at the new phase', () => {
  const R = [ph('2026-05-02', 'cut'), ph('2026-06-06', 'bulk', 75)], p = page(V6, R, '2026-06-20');
  assert.equal(p.chart.t0, day('2026-06-06')); assert.equal(text(p.phase), 'שלב: מסה · מ-6.6 · יעד 75.0');
});
test('phase picked after the last weigh-in: nothing to draw, rest of the page still shown', () => {
  const p = page(V6, [ph('2026-07-01', 'cut', 68)], '2026-07-01');
  assert.equal(p.chart, null); assert.equal(p.hero.isAvg, true);
});
test('phase row text', () => {
  assert.equal(text(phaseRow(ph('2026-09-01', 'cut', 78), false)), 'שלב: חיטוב · מ-1.9 · יעד 78.0');
  assert.deepEqual(phaseRow(null, false), ['לא נבחר שלב · בחירת שלב']);
});
