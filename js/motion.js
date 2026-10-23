// Motion on the dark home (redesign stage 1 §5): pure helpers for the hero moment and the frame gate. Tested in tests/motion.test.js.

export const HERO_MS = 1100;   // the hero moment stays under 1.2 s
export const FPS = 30;         // ambient galaxy cap

export const ease = t => { t = Math.min(Math.max(t, 0), 1); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };

// Ambient frames are drawn at most FPS times a second (small slack so a 60 Hz screen gives every second frame).
export const frameDue = (last, now, fps = FPS) => now - last >= 1000 / fps - 2;

// Tracks from the lens before a save to the lens after it (both from lensPoints). Points are matched by date:
// a kept point slides to its new place, a new one rises in from under the lens, one that left drifts out to the side.
export function heroTracks(before, after) {
  const old = new Map(before.points.map(p => [p.date, p]));
  const now = new Set(after.points.map(p => p.date));
  const tracks = after.points.map((p, i) => {
    const o = old.get(p.date);
    return {
      date: p.date, last: i === after.points.length - 1,
      from: o ? { x: o.x, y: o.y, o: 1 } : { x: p.x, y: 1.25, o: 0 },
      to: { x: p.x, y: p.y, o: 1 }
    };
  });
  for (const o of before.points) {
    if (!now.has(o.date)) tracks.push({ date: o.date, last: false, from: { x: o.x, y: o.y, o: 1 }, to: { x: o.x - 0.3, y: o.y, o: 0 } });
  }
  const avg = before.avgY === null && after.avgY === null ? null
    : { from: before.avgY === null ? { y: after.avgY, o: 0 } : { y: before.avgY, o: 1 },
        to: after.avgY === null ? { y: before.avgY, o: 0 } : { y: after.avgY, o: 1 } };
  return { points: tracks, avg };
}

const mix = (a, b, k) => a + (b - a) * k;
// Positions at time t (0..1). Leaving points go first, new ones arrive last, so the eye follows "one in, one out".
export function heroAt(tr, t) {
  const points = tr.points.map(p => {
    const k = ease(p.from.o === 0 ? (t - 0.25) / 0.75 : p.to.o === 0 ? t / 0.6 : t);
    return { date: p.date, last: p.last, x: mix(p.from.x, p.to.x, k), y: mix(p.from.y, p.to.y, k), o: mix(p.from.o, p.to.o, k) };
  });
  const k = ease(t);
  const avg = tr.avg && { y: mix(tr.avg.from.y, tr.avg.to.y, k), o: mix(tr.avg.from.o, tr.avg.to.o, k) };
  return { points, avg };
}

// The rate counts to its new value; with no old rate (or no new one) it just shows the end value.
export function countAt(from, to, t) {
  if (to === null || from === null || t >= 1) return to;
  return from + (to - from) * ease(t);
}
