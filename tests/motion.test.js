import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ease, frameDue, heroTracks, heroAt, countAt, HERO_MS } from '../js/motion.js';

const P = (date, x, y) => ({ date, kg: 80, x, y });
const before = { points: [P('2026-01-01', .2, .5), P('2026-01-08', .4, .5), P('2026-01-15', .6, .5), P('2026-01-22', .8, .5)], avgY: .5 };
const after = { points: [P('2026-01-08', .2, .4), P('2026-01-15', .47, .5), P('2026-01-22', .73, .6), P('2026-01-29', .8, .7)], avgY: .55 };

test('ease: ends fixed, clamped, monotonic', () => {
  assert.equal(ease(0), 0); assert.equal(ease(1), 1); assert.equal(ease(-1), 0); assert.equal(ease(2), 1);
  assert.equal(ease(.5), .5);
  for (let t = 0; t < 1; t += .05) assert.ok(ease(t + .05) >= ease(t));
});

test('frameDue: at most 30 frames a second', () => {
  assert.equal(frameDue(0, 16.7), false);   // every 60 Hz frame would be too many
  assert.equal(frameDue(0, 33.4), true);    // every second one is drawn
  assert.equal(frameDue(0, 20, 60), true);
});

test('hero lasts under 1.2 s', () => assert.ok(HERO_MS <= 1200));

test('heroTracks: one in, one out, kept points slide', () => {
  const tr = heroTracks(before, after);
  assert.equal(tr.points.length, 5);
  const byDate = Object.fromEntries(tr.points.map(p => [p.date, p]));
  assert.deepEqual(byDate['2026-01-08'].from, { x: .4, y: .5, o: 1 });
  assert.deepEqual(byDate['2026-01-08'].to, { x: .2, y: .4, o: 1 });
  assert.deepEqual(byDate['2026-01-29'].from, { x: .8, y: 1.25, o: 0 }); // new: rises from under the lens
  assert.equal(byDate['2026-01-29'].last, true);
  assert.equal(byDate['2026-01-01'].to.o, 0);                           // oldest leaves
  assert.deepEqual(tr.avg, { from: { y: .5, o: 1 }, to: { y: .55, o: 1 } });
});

test('heroAt: start equals before, end equals after', () => {
  const tr = heroTracks(before, after);
  const s = heroAt(tr, 0), e = heroAt(tr, 1);
  const vis = f => f.points.filter(p => p.o > 0.999).map(p => [p.date, +p.x.toFixed(6), +p.y.toFixed(6)]).sort();
  assert.deepEqual(vis(s), before.points.map(p => [p.date, p.x, p.y]).sort());
  assert.deepEqual(vis(e), after.points.map(p => [p.date, p.x, p.y]).sort());
  assert.ok(e.points.filter(p => p.o < 1).every(p => p.o === 0));
  assert.equal(s.avg.y, .5); assert.equal(e.avg.y, .55);
  // the new point has not appeared before the old one starts leaving
  const m = heroAt(tr, .2), inP = m.points.find(p => p.date === '2026-01-29'), outP = m.points.find(p => p.date === '2026-01-01');
  assert.equal(inP.o, 0); assert.ok(outP.o < 1);
});

test('heroTracks: first weigh-in and the average appearing at the 4th', () => {
  const tr = heroTracks({ points: [], avgY: null }, { points: [P('2026-01-01', .5, .5)], avgY: null });
  assert.equal(tr.avg, null);
  assert.deepEqual(heroAt(tr, 1).points[0], { date: '2026-01-01', last: true, x: .5, y: .5, o: 1 });
  const three = { points: before.points.slice(0, 3), avgY: null };
  const t2 = heroTracks(three, before);
  assert.deepEqual(t2.avg, { from: { y: .5, o: 0 }, to: { y: .5, o: 1 } });
});

test('countAt: counts, and handles missing rates', () => {
  assert.equal(countAt(-0.2, -0.6, 0), -0.2);
  assert.equal(countAt(-0.2, -0.6, 1), -0.6);
  assert.ok(Math.abs(countAt(-0.2, -0.6, .5) - -0.4) < 1e-12);
  assert.equal(countAt(null, -0.6, .3), -0.6);
  assert.equal(countAt(-0.2, null, .3), null);
});
