// Progress photos (spec docs/specs/photos.md): pure geometry, checks, lighting and captions. No DOM, no storage.
import { isISODate } from './model.js';
import { cleanWeighins, day, fmtWeight, EMPTY } from './trend.js';
import { fmtFull } from './report.js';

export const POSES = [
  { id: 'front', he: 'חזית' },
  { id: 'side', he: 'צד' },
  { id: 'back', he: 'גב' }
];
export const POSE_HE = Object.fromEntries(POSES.map(p => [p.id, p.he]));
// Session order front → side → back; null after the last one.
export const nextPose = id => { const i = POSES.findIndex(p => p.id === id); return i >= 0 && i < POSES.length - 1 ? POSES[i + 1].id : null; };

// Every aligned photo shares this frame: mid-shoulder and mid-hip always land on the same two points (§3).
export const FRAME = { w: 900, h: 1200, sh: { x: 450, y: 390 }, hip: { x: 450, y: 770 } };
export const VIS_MIN = 0.5;       // landmark visibility below this → "unclear" warning
export const RATIO_TOL = 0.15;    // shoulder-width ÷ torso-length change vs the reference → "pose changed"
export const MIN_TORSO = 0.08;    // torso shorter than this share of the photo's long side → too small to align
export const GAIN_MIN = 0.7, GAIN_MAX = 1.4, GAIN_SKIP = 0.03; // matched lighting (§4)
export const ORIG_MAX = 2000;     // long side a gallery photo is scaled to before detection
export const NEAR_DAYS = 3;       // before/after: nearest weigh-in within this many days (§6)

// Body measurements from MediaPipe landmarks (normalized 0..1) on a W×H photo. null when the 4 torso points are missing.
export function poseMetrics(L, W, H) {
  if (!Array.isArray(L) || ![0, 11, 12, 23, 24].every(i => L[i] && Number.isFinite(L[i].x) && Number.isFinite(L[i].y))) return null;
  const P = i => ({ x: L[i].x * W, y: L[i].y * H, v: Number.isFinite(L[i].visibility) ? L[i].visibility : 1 });
  const ls = P(11), rs = P(12), lh = P(23), rh = P(24), nose = P(0);
  const sh = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }, hip = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  const torso = Math.hypot(hip.x - sh.x, hip.y - sh.y);
  const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  // Side pose: which side of the shoulder→hip line the nose is on (+1 / −1).
  const cross = (hip.x - sh.x) * (nose.y - sh.y) - (hip.y - sh.y) * (nose.x - sh.x);
  return {
    sh, hip, torso, longSide: Math.max(W, H),
    ratio: torso > 0 ? shoulderW / torso : 0,
    vis: Math.min(ls.v, rs.v, lh.v, rh.v),
    facing: cross > 0 ? 1 : cross < 0 ? -1 : 0
  };
}

// Similarity transform only (uniform scale + rotation + shift): never stretches the body.
// Returns [a, b, c, d, e, f] for ctx.setTransform, mapping sh → FRAME.sh and hip → FRAME.hip.
export function alignTransform(sh, hip, F = FRAME) {
  const v = { x: hip.x - sh.x, y: hip.y - sh.y }, t = { x: F.hip.x - F.sh.x, y: F.hip.y - F.sh.y };
  const vv = v.x * v.x + v.y * v.y;
  if (!(vv > 0)) return null;
  // z = t / v as complex numbers
  const zr = (t.x * v.x + t.y * v.y) / vv, zi = (t.y * v.x - t.x * v.y) / vv;
  return [zr, zi, -zi, zr, F.sh.x - (zr * sh.x - zi * sh.y), F.sh.y - (zi * sh.x + zr * sh.y)];
}
// Unaligned photo: the whole photo fitted inside the frame, centred.
export function fitTransform(W, H, F = FRAME) {
  const s = Math.min(F.w / W, F.h / H);
  return [s, 0, 0, s, (F.w - W * s) / 2, (F.h - H * s) / 2];
}
export const applyTransform = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

// Working size of a gallery photo: long side at most ORIG_MAX, never enlarged.
export function origSize(W, H, max = ORIG_MAX) {
  const s = Math.min(1, max / Math.max(W, H));
  return { w: Math.round(W * s), h: Math.round(H * s) };
}

// The pose's reference photo: the oldest kept aligned photo (§3.4).
export function referenceOf(photos, pose) {
  return photos.filter(p => p && !p.deleted && p.aligned && p.pose === pose)
    .sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts)[0] || null;
}

export const CHECK_HE = {
  no_body: 'לא זיהיתי גוף בתמונה. צריך שהכתפיים והאגן ייראו.',
  too_small: 'הגוף קטן מדי בתמונה. צריך להתקרב למצלמה.',
  unclear: 'הכתפיים או האגן לא ברורים, אז היישור עלול לצאת לא מדויק.',
  pose_changed: 'העמידה שונה מהתמונה הראשונה, כנראה הגוף מסובב. כדאי לצלם שוב באותה עמידה.',
  facing_changed: 'בתמונה הראשונה הפנים היו לצד השני. כדאי לצלם שוב לאותו צד.'
};
// block: the photo can't be aligned (retake, or keep it unaligned). warnings: aligned, but worth a retake.
export function checkPhoto(m, ref, pose) {
  if (!m) return { block: 'no_body', warnings: [] };
  if (!(m.torso >= MIN_TORSO * m.longSide)) return { block: 'too_small', warnings: [] };
  const warnings = [];
  if (m.vis < VIS_MIN) warnings.push('unclear');
  if (ref) {
    // Side view: shoulder width is too small and noisy for the ratio, so only the facing side is checked.
    if (pose === 'side') { if (ref.facing && m.facing && ref.facing !== m.facing) warnings.push('facing_changed'); }
    else if (ref.ratio > 0 && Math.abs(m.ratio / ref.ratio - 1) > RATIO_TOL) warnings.push('pose_changed');
  }
  return { block: null, warnings };
}

// Mean R, G, B of the background: pixels the segmentation mask marks as not-person (< 0.5).
// data = RGBA bytes, mask = one value per pixel (same size) or null. Falls back to every pixel when
// the mask is missing or leaves under 5% background. step = sample every n-th pixel.
export function bgMean(data, mask, step = 4) {
  const n = Math.floor(data.length / 4);
  const sum = (useMask) => {
    let r = 0, g = 0, b = 0, c = 0;
    for (let i = 0; i < n; i += step) {
      if (useMask && !(mask[i] < 0.5)) continue;
      r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2]; c++;
    }
    return { m: c ? [r / c, g / c, b / c] : [0, 0, 0], c };
  };
  if (mask && mask.length >= n) {
    const s = sum(true);
    if (s.c >= 0.05 * Math.ceil(n / step)) return s.m;
  }
  return sum(false).m;
}

// One gain per channel that brings this photo's background to the reference's, clamped.
// null = no change (no reference, or every channel within 3%).
export function lightGain(cur, ref) {
  if (!Array.isArray(cur) || !Array.isArray(ref) || cur.length !== 3 || ref.length !== 3) return null;
  const g = cur.map((c, i) => Math.min(GAIN_MAX, Math.max(GAIN_MIN, ref[i] / Math.max(1, c))));
  if (g.every(x => Math.abs(x - 1) < GAIN_SKIP)) return null;
  return g.map(x => (Math.abs(x - 1) < GAIN_SKIP ? 1 : x));
}

// Default before/after pair: oldest and newest aligned photo of the pose. null with fewer than 2.
export function defaultPair(photos, pose) {
  const list = photos.filter(p => p && !p.deleted && p.aligned && p.pose === pose)
    .sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
  return list.length < 2 ? null : { before: list[0], after: list[list.length - 1] };
}

// Caption under a photo in the before/after image: date, and the weigh-in of that day,
// or the nearest within ±3 days (earlier wins a tie) with its own date, or "—".
export function photoCaption(date, weighins) {
  const pts = cleanWeighins(weighins || []);
  let best = null;
  for (const p of pts) {
    const d = Math.abs(day(p.date) - day(date));
    if (d <= NEAR_DAYS && (!best || d < best.d)) best = { p, d };
  }
  return {
    date: fmtFull(date),
    kg: best ? fmtWeight(best.p.kg) : EMPTY,
    kgDate: best && best.d > 0 ? fmtFull(best.p.date) : null
  };
}

// Before/after image (§6): 1800×1440, black rule on top, two 3:4 photos, earlier one on the right (RTL),
// caption lines under each photo. Coordinates in image pixels.
export function compareLayout() {
  const w = 1800, h = 1440, pad = 40, gap = 20, rule = 6, top = 70;
  const pw = (w - 2 * pad - gap) / 2, ph = Math.round(pw * FRAME.h / FRAME.w);
  const slot = x => ({ x, y: top, w: pw, h: ph, textX: x + pw, dateY: top + ph + 70, kgY: top + ph + 130 });
  return { w, h, rule: { x: pad, y: pad, w: w - 2 * pad, h: rule }, before: slot(pad + pw + gap), after: slot(pad) };
}

// Photo backup reminder: photos newer than the last photo backup, and that backup is over 30 days old (or never made).
export function photoBackupDue(photos, lastBackup, now) {
  const last = lastBackup ? Date.parse(lastBackup) : NaN;
  const newer = photos.some(p => p && !p.deleted && (!Number.isFinite(last) || p.ts > last));
  return newer && (!Number.isFinite(last) || now - last > 30 * 864e5);
}

// ---- photo backup file (§7): images as base64 JPEG ----
export const BACKUP_APP = 'bodytrack-photos', BACKUP_VERSION = 1;
const B64_JPEG = /^\/9j\/[A-Za-z0-9+/]*={0,2}$/; // base64 of a JPEG always starts with /9j/
const okB64 = s => typeof s === 'string' && s.length > 8 && s.length % 4 === 0 && B64_JPEG.test(s);
const okDate = d => isISODate(d) && +d.slice(0, 4) >= 1900 && +d.slice(0, 4) <= 2100;
const okRgb = a => Array.isArray(a) && a.length === 3 && a.every(x => typeof x === 'number' && x >= 0 && x <= 255);

// Returns {ok, photos, errors[], count}. Never throws. Photos keep base64 strings (img, orig) for the caller to decode.
export function validatePhotoBackup(obj) {
  const errors = [], photos = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, photos, errors: ['זה לא קובץ גיבוי תקין.'], count: 0 };
  if (obj.app !== BACKUP_APP) errors.push(obj.app === 'bodytrack' ? 'זה גיבוי של הנתונים, לא של התמונות. משחזרים אותו במסך הראשי.' : 'זה לא קובץ גיבוי תמונות של BodyTrack.');
  else if (typeof obj.version !== 'number') errors.push('הקובץ פגום: חסר מספר גרסה.');
  else if (obj.version > BACKUP_VERSION) errors.push('הקובץ נוצר בגרסה חדשה יותר של האפליקציה. צריך לעדכן אותה.');
  if (errors.length) return { ok: false, photos, errors, count: 0 };
  if (!Array.isArray(obj.photos)) return { ok: false, photos, errors: ['הקובץ פגום: רשימת התמונות לא תקינה.'], count: 0 };
  obj.photos.forEach((p, i) => {
    const ok = p && typeof p === 'object' && typeof p.id === 'string' && p.id !== '' && p.id.length <= 100 &&
      okDate(p.date) && Object.prototype.hasOwnProperty.call(POSE_HE, p.pose) &&
      typeof p.ts === 'number' && Number.isFinite(p.ts) && typeof p.aligned === 'boolean' &&
      okB64(p.img) && (p.orig === undefined || p.orig === null || okB64(p.orig));
    if (!ok) { errors.push(`תמונה מספר ${i + 1} לא תקינה.`); return; }
    const m = p.metrics && typeof p.metrics === 'object' && !Array.isArray(p.metrics) ? p.metrics : {};
    photos.push({
      id: p.id, date: p.date, pose: p.pose, ts: p.ts, aligned: p.aligned, deleted: p.deleted === true,
      metrics: {
        ratio: typeof m.ratio === 'number' && Number.isFinite(m.ratio) ? m.ratio : 0,
        vis: typeof m.vis === 'number' && Number.isFinite(m.vis) ? m.vis : 0,
        bg: okRgb(m.bg) ? m.bg.slice() : null,
        facing: m.facing === 1 || m.facing === -1 ? m.facing : 0
      },
      img: p.img, orig: p.orig || null
    });
  });
  return { ok: errors.length === 0, photos, errors, count: photos.length };
}

// Records that still carry a trial-period original, rewritten without it (owner, 22.10: edited photo only).
export const withoutOriginals = photos => photos.filter(p => p && p.orig).map(p => ({ ...p, orig: null }));

// Merge: only photos this phone doesn't have yet (a photo never changes except `deleted`, and the phone's state is newer).
export function photosToAdd(backupPhotos, localIds) {
  const have = new Set(localIds);
  return backupPhotos.filter(p => !have.has(p.id));
}
