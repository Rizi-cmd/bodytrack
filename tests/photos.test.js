// Unit tests for js/photos.js (spec docs/specs/photos.md). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POSES, nextPose, FRAME, poseMetrics, alignTransform, fitTransform, applyTransform, origSize, referenceOf,
  withoutOriginals, checkPhoto, bgMean, lightGain, defaultPair, photoCaption, compareLayout, photoBackupDue, validatePhotoBackup, photosToAdd, CHECK_HE
} from '../js/photos.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
// Landmarks (normalized) for a standing body: shoulders, hips, nose.
function body({ sx = 0.5, sy = 0.3, hx = 0.5, hy = 0.6, half = 0.1, hipHalf = 0.07, nose = 0, vis = 0.9 } = {}) {
  const L = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  L[0] = { x: sx + nose, y: sy - 0.1, visibility: vis };
  L[11] = { x: sx + half, y: sy, visibility: vis }; L[12] = { x: sx - half, y: sy, visibility: vis };
  L[23] = { x: hx + hipHalf, y: hy, visibility: vis }; L[24] = { x: hx - hipHalf, y: hy, visibility: vis };
  return L;
}
const jpeg = '/9j/' + 'A'.repeat(60); // length 64, valid base64 shape
const rec = (o = {}) => ({ id: 'p1', date: '2026-10-01', pose: 'front', ts: 1, aligned: true, img: jpeg, metrics: { ratio: 0.6, vis: 0.9, bg: [100, 110, 120], facing: 0 }, ...o });

test('session order: front → side → back → end', () => {
  assert.deepEqual(POSES.map(p => p.id), ['front', 'side', 'back']);
  assert.equal(nextPose('front'), 'side'); assert.equal(nextPose('side'), 'back');
  assert.equal(nextPose('back'), null); assert.equal(nextPose('x'), null);
});

test('poseMetrics: torso, ratio, visibility, facing', () => {
  const m = poseMetrics(body(), 1000, 2000);
  close(m.sh.x, 500); close(m.sh.y, 600); close(m.hip.y, 1200);
  close(m.torso, 600); close(m.ratio, 200 / 600); close(m.vis, 0.9);
  assert.equal(m.longSide, 2000);
  assert.equal(poseMetrics(body({ nose: 0.05 }), 1000, 2000).facing, -poseMetrics(body({ nose: -0.05 }), 1000, 2000).facing);
  assert.notEqual(poseMetrics(body({ nose: 0.05 }), 1000, 2000).facing, 0);
  assert.equal(poseMetrics(null, 10, 10), null);
  assert.equal(poseMetrics([], 10, 10), null);
  const missing = body(); missing[23] = undefined;
  assert.equal(poseMetrics(missing, 10, 10), null);
  const noVis = body(); delete noVis[11].visibility;
  close(poseMetrics(noVis, 10, 10).vis, 0.9); // missing visibility counts as 1, min over the rest
});

test('alignTransform maps shoulder and hip onto the frame points', () => {
  for (const [sh, hip] of [[{ x: 500, y: 600 }, { x: 500, y: 1200 }], [{ x: 300, y: 200 }, { x: 420, y: 900 }], [{ x: 10, y: 10 }, { x: 5, y: 40 }]]) {
    const m = alignTransform(sh, hip);
    const a = applyTransform(m, sh), b = applyTransform(m, hip);
    close(a.x, FRAME.sh.x); close(a.y, FRAME.sh.y); close(b.x, FRAME.hip.x); close(b.y, FRAME.hip.y);
  }
  assert.equal(alignTransform({ x: 1, y: 1 }, { x: 1, y: 1 }), null);
});

test('alignTransform is a similarity: same scale on both axes, no shear (body never stretched)', () => {
  const m = alignTransform({ x: 300, y: 200 }, { x: 420, y: 900 });
  const [a, b, c, d] = m;
  close(a, d); close(b, -c);                      // rotation + uniform scale
  const sx = Math.hypot(a, b), sy = Math.hypot(c, d);
  close(sx, sy);
  close(sx, 380 / Math.hypot(120, 700));          // scale = frame torso ÷ photo torso
});

test('fitTransform fits and centres the whole photo', () => {
  const m = fitTransform(1800, 1200);             // wide photo: width limits
  close(m[0], 0.5); close(m[3], 0.5); close(m[4], 0); close(m[5], (1200 - 600) / 2);
  const t = fitTransform(900, 2400);              // tall photo: height limits
  close(t[0], 0.5); close(t[4], (900 - 450) / 2); close(t[5], 0);
});

test('origSize: long side at most 2000, never enlarged', () => {
  assert.deepEqual(origSize(3024, 4032), { w: 1500, h: 2000 });
  assert.deepEqual(origSize(1080, 1920), { w: 1080, h: 1920 });
});

test('referenceOf: oldest kept aligned photo of the pose', () => {
  const ps = [
    rec({ id: 'a', date: '2026-09-01', deleted: true }),
    rec({ id: 'b', date: '2026-09-08', aligned: false }),
    rec({ id: 'c', date: '2026-09-15', ts: 5 }),
    rec({ id: 'd', date: '2026-09-15', ts: 3 }),
    rec({ id: 'e', date: '2026-09-01', pose: 'side' })
  ];
  assert.equal(referenceOf(ps, 'front').id, 'd');
  assert.equal(referenceOf(ps, 'side').id, 'e');
  assert.equal(referenceOf(ps, 'back'), null);
});

test('checkPhoto: blocks and warnings', () => {
  const m = { torso: 600, longSide: 2000, ratio: 0.5, vis: 0.9, facing: 1 };
  assert.deepEqual(checkPhoto(null, null, 'front'), { block: 'no_body', warnings: [] });
  assert.equal(checkPhoto({ ...m, torso: 150 }, null, 'front').block, 'too_small'); // < 8% of 2000
  assert.equal(checkPhoto({ ...m, torso: 160 }, null, 'front').block, null);        // exactly 8%
  assert.deepEqual(checkPhoto(m, null, 'front'), { block: null, warnings: [] });
  assert.deepEqual(checkPhoto({ ...m, vis: 0.4 }, null, 'front').warnings, ['unclear']);
  assert.deepEqual(checkPhoto({ ...m, ratio: 0.58 }, { ratio: 0.5 }, 'front').warnings, ['pose_changed']); // +16%
  assert.deepEqual(checkPhoto({ ...m, ratio: 0.57 }, { ratio: 0.5 }, 'back').warnings, []);                // +14%
  // side: ratio ignored, facing compared
  assert.deepEqual(checkPhoto({ ...m, ratio: 2 }, { ratio: 0.5, facing: 1 }, 'side').warnings, []);
  assert.deepEqual(checkPhoto({ ...m, facing: -1 }, { ratio: 0.5, facing: 1 }, 'side').warnings, ['facing_changed']);
  assert.deepEqual(checkPhoto({ ...m, facing: -1 }, { ratio: 0.5, facing: 0 }, 'side').warnings, []);
  for (const k of ['no_body', 'too_small', 'unclear', 'pose_changed', 'facing_changed']) assert.ok(CHECK_HE[k], k);
});

test('bgMean: background pixels only, falls back to all pixels', () => {
  // 4 pixels: two person (mask 1) red, two background (mask 0) grey
  const data = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 100, 100, 100, 255, 120, 120, 120, 255]);
  assert.deepEqual(bgMean(data, new Float32Array([1, 1, 0, 0]), 1), [110, 110, 110]);
  assert.deepEqual(bgMean(data, null, 1), [182.5, 55, 55]);
  assert.deepEqual(bgMean(data, new Float32Array([1, 1, 1, 1]), 1), [182.5, 55, 55]); // no background → all
  assert.deepEqual(bgMean(data, new Float32Array([1]), 1), [182.5, 55, 55]);          // wrong-size mask → all
});

test('lightGain: per channel, clamped 0.7–1.4, under 3% skipped', () => {
  assert.equal(lightGain([100, 100, 100], [102, 101, 99]), null);
  assert.deepEqual(lightGain([100, 100, 100], [120, 101, 80]), [1.2, 1, 0.8]);
  assert.deepEqual(lightGain([50, 200, 100], [100, 100, 100]), [1.4, 0.7, 1]);
  assert.deepEqual(lightGain([0, 100, 100], [100, 100, 100]), [1.4, 1, 1]); // dark channel: no divide by zero
  assert.equal(lightGain(null, [1, 1, 1]), null);
  assert.equal(lightGain([1, 1, 1], null), null);
});

test('defaultPair: oldest and newest aligned photo of the pose', () => {
  const ps = [rec({ id: 'a', date: '2026-09-01' }), rec({ id: 'b', date: '2026-10-01' }), rec({ id: 'c', date: '2026-10-08', aligned: false }), rec({ id: 'd', date: '2026-08-01', deleted: true })];
  const p = defaultPair(ps, 'front');
  assert.equal(p.before.id, 'a'); assert.equal(p.after.id, 'b');
  assert.equal(defaultPair([rec()], 'front'), null);
  assert.equal(defaultPair(ps, 'side'), null);
});

test('photoCaption: exact weigh-in, nearest within 3 days, or none', () => {
  const W = [
    { id: '1', date: '2026-10-01', kg: 80.24 },
    { id: '2', date: '2026-10-05', kg: 79.9 },
    { id: '3', date: '2026-10-09', kg: 79.5 },
    { id: '4', date: '2026-10-20', kg: 70, deleted: true }
  ];
  assert.deepEqual(photoCaption('2026-10-01', W), { date: '1.10.2026', kg: '80.2', kgDate: null });
  assert.deepEqual(photoCaption('2026-10-03', W), { date: '3.10.2026', kg: '80.2', kgDate: '1.10.2026' }); // tie 2–2: earlier wins
  assert.deepEqual(photoCaption('2026-10-12', W), { date: '12.10.2026', kg: '79.5', kgDate: '9.10.2026' });
  assert.deepEqual(photoCaption('2026-10-20', W), { date: '20.10.2026', kg: '—', kgDate: null });         // deleted ignored, nothing near
  assert.deepEqual(photoCaption('2026-10-13', W), { date: '13.10.2026', kg: '—', kgDate: null });         // 4 days away
  assert.deepEqual(photoCaption('2026-10-01', []), { date: '1.10.2026', kg: '—', kgDate: null });
});

test('compareLayout: earlier photo on the right, 3:4 photos, everything inside the image', () => {
  const L = compareLayout();
  assert.equal(L.w, 1800); assert.equal(L.h, 1440);
  assert.ok(L.before.x > L.after.x);
  for (const s of [L.before, L.after]) {
    close(s.h / s.w, 4 / 3, 0.01);
    assert.ok(s.x >= 0 && s.x + s.w <= L.w);
    assert.ok(s.y > L.rule.y + L.rule.h && s.kgY < L.h - 20 && s.dateY > s.y + s.h);
  }
  assert.ok(L.after.x + L.after.w < L.before.x); // gap between the photos
});

test('photoBackupDue: new photos and backup older than 30 days (or never)', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const ps = [rec({ ts: Date.parse('2026-10-10T00:00:00Z') })];
  assert.equal(photoBackupDue([], null, now), false);
  assert.equal(photoBackupDue(ps, null, now), true);
  assert.equal(photoBackupDue(ps, '2026-09-01T00:00:00Z', now), true);
  assert.equal(photoBackupDue(ps, '2026-10-15T00:00:00Z', now), false);  // recent backup
  assert.equal(photoBackupDue(ps, '2026-09-15T00:00:00Z', now), true);
  assert.equal(photoBackupDue([rec({ ts: Date.parse('2026-08-01T00:00:00Z') })], '2026-09-01T00:00:00Z', now), false); // nothing new
  assert.equal(photoBackupDue([rec({ ts: Date.parse('2026-10-10T00:00:00Z'), deleted: true })], '2026-09-01T00:00:00Z', now), false);
});

test('validatePhotoBackup: accepts a good file and cleans records', () => {
  const v = validatePhotoBackup({ app: 'bodytrack-photos', version: 1, photos: [rec({ orig: jpeg, extra: 'x', metrics: { ratio: 0.5, vis: 1, bg: [1, 2, 3], facing: -1, junk: 1 } })] });
  assert.equal(v.ok, true); assert.equal(v.count, 1);
  assert.deepEqual(v.photos[0], { id: 'p1', date: '2026-10-01', pose: 'front', ts: 1, aligned: true, deleted: false, metrics: { ratio: 0.5, vis: 1, bg: [1, 2, 3], facing: -1 }, img: jpeg, orig: jpeg });
  assert.equal(validatePhotoBackup({ app: 'bodytrack-photos', version: 1, photos: [rec({ metrics: 'x', deleted: 1 })] }).photos[0].deleted, false);
});

test('validatePhotoBackup: rejects wrong files and bad records', () => {
  assert.equal(validatePhotoBackup(null).ok, false);
  assert.match(validatePhotoBackup({ app: 'bodytrack', schema: 1 }).errors[0], /במסך הראשי/);
  assert.equal(validatePhotoBackup({ app: 'bodytrack-photos', version: 2, photos: [] }).ok, false);
  assert.equal(validatePhotoBackup({ app: 'bodytrack-photos', photos: [] }).ok, false);
  assert.equal(validatePhotoBackup({ app: 'bodytrack-photos', version: 1, photos: {} }).ok, false);
  assert.equal(validatePhotoBackup({ app: 'bodytrack-photos', version: 1, photos: [] }).ok, true);
  for (const bad of [rec({ id: '' }), rec({ date: '2026-02-30' }), rec({ pose: 'top' }), rec({ ts: NaN }), rec({ aligned: 'yes' }),
    rec({ img: 'iVBORw0KGgo=' }), rec({ img: '/9j/<script>' }), rec({ orig: 'abc' }), null, 5, []]) {
    const v = validatePhotoBackup({ app: 'bodytrack-photos', version: 1, photos: [bad] });
    assert.equal(v.ok, false, JSON.stringify(bad)); assert.equal(v.count, 0);
  }
});

test('validatePhotoBackup never throws on odd input (fuzz)', () => {
  const odd = [undefined, null, 0, '', 'x', [], {}, true, () => 1, { app: 'bodytrack-photos', version: 1, photos: [{ toString: null }] },
    { app: 'bodytrack-photos', version: 1, photos: [Object.create(null)] }, { app: { a: 1 } }];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const vals = [null, undefined, 1, -1, NaN, '', 'front', jpeg, '2026-10-01', [], {}, true, [1, 2, 3]];
  for (let i = 0; i < 300; i++) {
    const p = {}; for (const k of ['id', 'date', 'pose', 'ts', 'aligned', 'img', 'orig', 'metrics', 'deleted']) if (rnd() < 0.8) p[k] = pick(vals);
    odd.push({ app: 'bodytrack-photos', version: pick([1, 0, '1', null]), photos: pick([[p], p, null, [p, p]]) });
  }
  for (const o of odd) assert.doesNotThrow(() => validatePhotoBackup(o));
});

test('photosToAdd: only ids the phone does not have', () => {
  assert.deepEqual(photosToAdd([rec({ id: 'a' }), rec({ id: 'b' })], ['b', 'c']).map(p => p.id), ['a']);
});

test('validatePhotoBackup: a damaged record is reported, the good ones are kept', () => {
  const v = validatePhotoBackup({ app: 'bodytrack-photos', version: 1, photos: [rec({ id: 'a' }), rec({ id: 'b', img: 'x' }), rec({ id: 'c' })] });
  assert.equal(v.ok, false); assert.equal(v.errors.length, 1);
  assert.deepEqual(v.photos.map(p => p.id), ['a', 'c']);
});

test('withoutOriginals: only records with an original, rewritten without it, rest untouched', () => {
  const ps = [rec({ id: 'a', orig: jpeg }), rec({ id: 'b', orig: null }), rec({ id: 'c' })];
  const out = withoutOriginals(ps);
  assert.deepEqual(out.map(p => [p.id, p.orig]), [['a', null]]);
  assert.equal(out[0].img, jpeg);
  assert.equal(ps[0].orig, jpeg); // input not changed
});
