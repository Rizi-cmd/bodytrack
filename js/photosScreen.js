// Photos screen (DOM, camera, canvas). Geometry, checks, lighting maths and captions come from js/photos.js (pure, tested).
// Privacy: photos stay in IndexedDB on this phone. Body detection runs here, from the app's own files (vendor/mediapipe).
import { getAll, put, putMany, getMeta, setMeta, requestPersistence } from './db.js';
import { todayISO, isISODate } from './model.js';
import { fmtFull } from './report.js';
import {
  POSES, POSE_HE, nextPose, FRAME, poseMetrics, alignTransform, fitTransform, origSize, withoutOriginals, referenceOf, CHECK_HE, checkPhoto,
  bgMean, lightGain, defaultPair, photoCaption, compareLayout, photoBackupDue, validatePhotoBackup, photosToAdd, BACKUP_APP, BACKUP_VERSION
} from './photos.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const num = (text, cls = 'n') => { const s = el('span', cls, text); s.dir = 'ltr'; return s; };

// Set by app.js: toast(msg, ms, undo) and the live weigh-ins (for the before/after captions).
const host = { toast: () => {}, weighins: () => [] };
export function initPhotos(opts) { Object.assign(host, opts); }

const view = { pose: 'front', photos: [], urls: [], cmpUrl: null, cmpBlob: null, pair: { before: null, after: null }, drawToken: 0 };

// ---- body detection (MediaPipe, self-hosted, loaded only on this screen) ----
const MP = new URL('../vendor/mediapipe/0.10.14/', import.meta.url).href;
let poseP = null, modelState = 'idle';
function getPose() {
  if (window.__mockPose) return Promise.resolve(window.__mockPose); // test hook (smoke test): no model download
  if (!poseP) {
    modelState = 'loading'; showModel();
    poseP = (async () => {
      const { PoseLandmarker } = await import(MP + 'vision_bundle.mjs');
      const lm = await PoseLandmarker.createFromOptions(
        { wasmLoaderPath: MP + 'vision_wasm_internal.js', wasmBinaryPath: MP + 'vision_wasm_internal.wasm' },
        { baseOptions: { modelAssetPath: MP + 'pose_landmarker_lite.task', delegate: 'CPU' }, runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: true }
      );
      modelState = 'ready'; showModel();
      return lm;
    })().catch(e => { poseP = null; modelState = 'failed'; showModel(); throw e; });
  }
  return poseP;
}
function showModel() {
  $('#pModel').textContent = {
    idle: '', loading: 'טוען את זיהוי הגוף… בפעם הראשונה זה לוקח קצת זמן וצריך אינטרנט.',
    ready: 'זיהוי הגוף מוכן ועובד גם בלי אינטרנט.',
    failed: 'לא הצלחתי לטעון את זיהוי הגוף. בפעם הראשונה צריך אינטרנט.'
  }[window.__mockPose ? 'ready' : modelState];
}

// Landmarks + a copy of the person mask. The mask is only valid inside the callback.
function detect(lm, src) {
  return new Promise(res => lm.detect(src, r => {
    const L = r && r.landmarks && r.landmarks[0];
    const mk = r && r.segmentationMasks && r.segmentationMasks[0];
    let mask = null;
    if (mk) { try { mask = { data: mk.getAsFloat32Array().slice(), w: mk.width, h: mk.height }; } catch { mask = null; } }
    res({ L: L ? L.map(p => ({ x: p.x, y: p.y, visibility: p.visibility })) : null, mask });
  }));
}
// Background colour of the source photo, measured at the mask's size (or small, without a mask).
function measureBg(src, mask) {
  const w = mask ? mask.w : Math.max(1, Math.round(200 * src.width / Math.max(src.width, src.height)));
  const h = mask ? mask.h : Math.max(1, Math.round(200 * src.height / Math.max(src.width, src.height)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, w, h);
  return bgMean(x.getImageData(0, 0, w, h).data, mask ? mask.data : null).map(v => Math.round(v * 10) / 10);
}

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const toBlob = (c, q) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', q));

// Detect, check, and draw the edited photo. Never throws for a photo without a body; throws only if the model can't load.
async function processPhoto(src, pose) {
  const lm = await getPose();
  const d = await detect(lm, src);
  const m = d.L ? poseMetrics(d.L, src.width, src.height) : null;
  const ref = referenceOf(view.photos, pose);
  const chk = checkPhoto(m, ref && ref.metrics, pose);
  const bg = measureBg(src, d.mask);
  return { src, pose, m, chk, bg, ref };
}
function drawEdited(p, aligned) {
  const out = canvas(FRAME.w, FRAME.h), o = out.getContext('2d', { willReadFrequently: true });
  o.fillStyle = '#000'; o.fillRect(0, 0, FRAME.w, FRAME.h);
  o.setTransform(...(aligned ? alignTransform(p.m.sh, p.m.hip) : fitTransform(p.src.width, p.src.height)));
  o.imageSmoothingQuality = 'high';
  o.drawImage(p.src, 0, 0);
  o.setTransform(1, 0, 0, 1, 0, 0);
  const gain = aligned && p.ref ? lightGain(p.bg, p.ref.metrics.bg) : null;
  if (gain) {
    const img = o.getImageData(0, 0, FRAME.w, FRAME.h), a = img.data;
    for (let i = 0; i < a.length; i += 4) { a[i] *= gain[0]; a[i + 1] *= gain[1]; a[i + 2] *= gain[2]; } // clamped by the array
    o.putImageData(img, 0, 0);
  }
  return out;
}

// ---- screen ----
// Originals from the trial period are dropped (owner, 22.10): only the edited photo is kept.
async function load() {
  view.photos = (await getAll('photos')).filter(p => p && p.id);
  const strip = withoutOriginals(view.photos);
  if (strip.length) {
    try { await putMany('photos', strip); view.photos = view.photos.map(p => (p.orig ? { ...p, orig: null } : p)); }
    catch { /* tried again next time */ }
  }
}
const live = pose => view.photos.filter(p => !p.deleted && p.pose === pose)
  .sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts); // newest first
// Photos are stored as JPEG bytes (ArrayBuffer): Blobs in IndexedDB are not reliable on every WebKit build.
const jpg = x => (x instanceof Blob ? x : new Blob([x], { type: 'image/jpeg' }));
const bytes = async c => (await toBlob(c.canvas, c.q)).arrayBuffer();
function url(data) { const u = URL.createObjectURL(jpg(data)); view.urls.push(u); return u; }

export async function renderPhotos() {
  await load();
  view.urls.forEach(u => URL.revokeObjectURL(u)); view.urls = [];
  const pose = view.pose, he = POSE_HE[pose], list = live(pose);
  document.querySelectorAll('[data-pose]').forEach(b => b.setAttribute('aria-pressed', b.dataset.pose === pose));

  const last = list[0];
  $('#pLastTitle').textContent = `איור 1 · ${he}, התמונה האחרונה`;
  $('#pLastFig').hidden = !last; $('#pLastEmpty').hidden = !!last;
  $('#pLastEmpty').textContent = `אין עדיין תמונות ${he}.`;
  if (last) {
    $('#pLast').src = url(last.img); $('#pLast').alt = `${he}, ${fmtFull(last.date)}`;
    const cap = $('#pLastCap'); cap.replaceChildren(num(fmtFull(last.date)));
    if (!last.aligned) cap.append(' · לא מיושרת');
  }

  const grid = $('#pGrid'); grid.replaceChildren();
  $('#pAllTitle').replaceChildren(`איור 3 · כל התמונות, ${he} `, num(`(${list.length})`));
  if (!list.length) grid.append(el('p', 'empty', 'אין תמונות.'));
  for (const p of list) {
    const b = el('button', 'thumb'); b.type = 'button';
    const im = el('img'); im.src = url(p.img); im.alt = fmtFull(p.date); im.loading = 'lazy';
    const cap = el('span', 'lab'); cap.append(num(fmtFull(p.date)));
    if (!p.aligned) cap.append(' · לא מיושרת');
    b.append(im, cap); b.onclick = () => openDetail(p);
    grid.append(b);
  }

  await renderCompare();

  const lb = await getMeta('lastPhotoBackup');
  const n = view.photos.filter(p => !p.deleted).length;
  const info = $('#pBackupInfo'); info.replaceChildren();
  info.append(n === 1 ? 'תמונה אחת במכשיר. ' : n ? `${n} תמונות במכשיר. ` : 'אין תמונות במכשיר. ');
  if (lb) info.append('גיבוי תמונות אחרון: ', num(fmtFull(lb.slice(0, 10))));
  else info.append('עוד לא נשמר גיבוי תמונות.');
  const due = photoBackupDue(view.photos, lb, Date.now());
  $('#pNag').hidden = !due;
  $('#pNag').textContent = lb ? 'יש תמונות חדשות, ועבר יותר מחודש מגיבוי התמונות האחרון.' : 'יש תמונות במכשיר ואין להן גיבוי עדיין.';
}

// ---- before / after ----
const aligned = pose => live(pose).filter(p => p.aligned).reverse(); // oldest first
function fillSelect(sel, list, id) {
  sel.replaceChildren(...list.map(p => { const o = el('option', null, fmtFull(p.date)); o.value = p.id; return o; }));
  sel.value = id;
}
async function renderCompare() {
  const list = aligned(view.pose);
  const def = defaultPair(view.photos, view.pose);
  $('#pCmpBox').hidden = !def; $('#pCmpEmpty').hidden = !!def;
  $('#pCmpEmpty').textContent = `צריך לפחות 2 תמונות ${POSE_HE[view.pose]} מיושרות.`;
  if (!def) return;
  const keep = id => (list.some(p => p.id === id) ? id : null);
  const before = keep(view.pair.before) || def.before.id, after = keep(view.pair.after) || def.after.id;
  view.pair = { before, after };
  fillSelect($('#pBefore'), list, before); fillSelect($('#pAfter'), list, after);
  const same = before === after;
  $('#pCmp').hidden = $('#pCmpCap').hidden = $('#pCmpSave').hidden = same;
  $('#pCmpNote').hidden = !same;
  if (same) { $('#pCmpNote').textContent = 'אותה תמונה נבחרה פעמיים. צריך לבחור שתי תמונות שונות.'; return; }
  // The earlier photo always goes on the right, whichever box it was picked in (spec §6).
  const pair = [list.find(p => p.id === before), list.find(p => p.id === after)]
    .sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
  const token = ++view.drawToken;
  try { await drawCompare(pair[0], pair[1], token); }
  catch {
    if (token !== view.drawToken) return;
    $('#pCmp').hidden = $('#pCmpCap').hidden = $('#pCmpSave').hidden = true;
    $('#pCmpNote').hidden = false; $('#pCmpNote').textContent = 'לא הצלחתי להכין את התמונה.';
  }
}
// The same captions as in the image, as page text (the image is shown much smaller than its real size).
function cmpCaption(before, after) {
  const W = host.weighins();
  const cell = p => {
    const c = photoCaption(p.date, W), d = el('div');
    d.append(el('b', null), el('span', 'lab'));
    d.firstChild.append(num(c.date));
    if (c.kg === '—') d.lastChild.append('אין שקילה קרובה');
    else {
      d.lastChild.append(num(c.kg), ' ק״ג');
      if (c.kgDate) d.lastChild.append(' (שקילה מ־', num(c.kgDate), ')');
    }
    return d;
  };
  $('#pCmpCap').replaceChildren(cell(before), cell(after)); // RTL grid: first cell on the right
}
function loadImg(blob) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(blob), im = new Image();
    im.onload = () => { URL.revokeObjectURL(u); res(im); };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('image')); };
    im.src = u;
  });
}
async function drawCompare(before, after, token) {
  const L = compareLayout(), c = canvas(L.w, L.h), x = c.getContext('2d');
  try { await Promise.all(['800 48px Heebo', '500 40px Heebo', '500 30px Heebo'].map(f => document.fonts.load(f, 'אב 0.9'))); } catch { /* system font */ }
  x.fillStyle = '#F7F7F5'; x.fillRect(0, 0, L.w, L.h);
  x.fillStyle = '#111'; x.fillRect(L.rule.x, L.rule.y, L.rule.w, L.rule.h);
  const W = host.weighins();
  for (const [p, s] of [[before, L.before], [after, L.after]]) {
    x.drawImage(await loadImg(jpg(p.img)), s.x, s.y, s.w, s.h);
    const cap = photoCaption(p.date, W);
    x.direction = 'rtl'; x.textAlign = 'right'; x.fillStyle = '#111';
    x.font = '800 48px Heebo, -apple-system, sans-serif';
    x.fillText(cap.date, s.textX, s.dateY);
    x.font = '500 40px Heebo, -apple-system, sans-serif';
    const kg = cap.kg === '—' ? '—' : `${cap.kg} ק״ג`;
    x.fillText(kg, s.textX, s.kgY);
    if (cap.kgDate) {
      const kw = x.measureText(kg).width;
      x.font = '500 30px Heebo, -apple-system, sans-serif'; x.fillStyle = '#5E5E5A';
      x.fillText(`(שקילה מ־${cap.kgDate})`, s.textX - kw - 16, s.kgY);
    }
  }
  const blob = await toBlob(c, 0.9);
  if (token !== view.drawToken) return; // a newer pick is being drawn
  view.cmpBlob = blob;
  cmpCaption(before, after);
  view.cmpName = `bodytrack-${view.pose}-${before.date}-${after.date}.jpg`;
  if (view.cmpUrl) URL.revokeObjectURL(view.cmpUrl);
  view.cmpUrl = URL.createObjectURL(view.cmpBlob);
  $('#pCmp').src = view.cmpUrl;
}
$('#pBefore').onchange = e => { view.pair.before = e.target.value; renderCompare(); };
$('#pAfter').onchange = e => { view.pair.after = e.target.value; renderCompare(); };
$('#pCmpSave').onclick = async () => {
  if (!view.cmpBlob) return;
  const r = await shareFile(new File([view.cmpBlob], view.cmpName, { type: 'image/jpeg' }));
  if (r === 'shared') host.toast('צריך לבחור "שמירת תמונה" כדי שתיכנס לגלריה.');
};
// iOS share sheet; a download link where sharing files isn't supported. → 'shared' | 'cancelled' | 'downloaded'
async function shareFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; throw e; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}

document.querySelectorAll('[data-pose]').forEach(b => b.onclick = () => {
  view.pose = b.dataset.pose; view.pair = { before: null, after: null }; renderPhotos();
});

// ---- one photo: view or delete (soft, with undo) ----
let detail = null;
function openDetail(p) {
  detail = p;
  $('#pdTitle').textContent = `${POSE_HE[p.pose]} · ${fmtFull(p.date)}`;
  $('#pdImg').src = url(p.img); $('#pdImg').alt = `${POSE_HE[p.pose]}, ${fmtFull(p.date)}`;
  $('#pdInfo').textContent = p.aligned ? 'מיושרת למסגרת הקבועה.' : 'לא מיושרת, ולכן לא מופיעה ב"לפני ואחרי".';
  $('#pDetail').hidden = false;
}
$('#pdClose').onclick = () => { $('#pDetail').hidden = true; };
$('#pdDelete').onclick = async () => {
  const p = detail; if (!p) return;
  try { await put('photos', { ...p, deleted: true }); } catch { host.toast('לא הצלחתי למחוק. שום דבר לא השתנה.'); return; }
  $('#pDetail').hidden = true;
  await renderPhotos();
  host.toast('התמונה נמחקה.', 8000, async () => {
    try { await put('photos', { ...p, deleted: false }); } catch { host.toast('לא הצלחתי לבטל את המחיקה.'); return; }
    await renderPhotos(); host.toast('המחיקה בוטלה.');
  });
};

// ---- camera session: front → side → back, each can be skipped ----
let timerSec = 10;
try { const t = +localStorage.getItem('bt.photoTimer'); if ([3, 5, 10].includes(t)) timerSec = t; } catch { /* default */ }
const TIMERS = [3, 5, 10];
// gen: bumped on open and close, so a countdown from a closed session can never shoot.
const cam = { stream: null, facing: 'user', pose: 'front', shooting: false, saved: 0, gen: 0 };
const setShooting = on => { cam.shooting = on; $('#camFlip').disabled = $('#camTimer').disabled = $('#camSkip').disabled = on; };
const showTimer = () => { $('#camTimer').textContent = `טיימר ${timerSec} שניות`; };
const showStep = () => {
  const i = POSES.findIndex(p => p.id === cam.pose);
  $('#camStep').replaceChildren(num(`${i + 1}/${POSES.length}`), ` · ${POSE_HE[cam.pose]}`);
  $('#camSkip').textContent = nextPose(cam.pose) ? 'דילוג' : 'דילוג וסיום';
};
async function startStream() {
  stopStream();
  cam.stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: cam.facing, width: { ideal: 1440 }, height: { ideal: 1920 } }, audio: false
  });
  const v = $('#camVideo'); v.srcObject = cam.stream;
  v.classList.toggle('mirror', cam.facing === 'user'); // the preview is mirrored like a mirror; saved photos never are
  try { await v.play(); } catch { /* autoplay */ }
}
function stopStream() { if (cam.stream) { cam.stream.getTracks().forEach(t => t.stop()); cam.stream = null; } }
async function openSession() {
  cam.pose = 'front'; cam.saved = 0; cam.gen++; setShooting(false);
  $('#cam').hidden = false; showStep(); showTimer();
  try { await startStream(); }
  catch { closeSession(); host.toast('אין גישה למצלמה. אפשר לאשר אותה בהגדרות, או לבחור תמונה מהגלריה.', 6000); }
}
function closeSession() {
  stopStream(); $('#cam').hidden = true; $('#camCount').hidden = true; cam.gen++; setShooting(false);
  if (cam.saved) host.toast(cam.saved === 1 ? 'תמונה אחת נשמרה.' : `${cam.saved} תמונות נשמרו.`);
  cam.saved = 0;
  renderPhotos();
}
function advance() {
  const next = nextPose(cam.pose);
  if (!next) { closeSession(); return; }
  cam.pose = next; showStep();
}
// iOS stops the camera when the app goes to the background: restart it on the way back.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || $('#cam').hidden) return;
  if (cam.shooting) { cam.gen++; setShooting(false); $('#camCount').hidden = true; }
  try { await startStream(); } catch { closeSession(); host.toast('המצלמה נסגרה. אפשר לפתוח אותה שוב.'); }
});
$('#shootBtn').onclick = () => { getPose().catch(() => {}); openSession(); };
$('#camClose').onclick = closeSession;
$('#camSkip').onclick = () => { if (!cam.shooting) advance(); };
$('#camFlip').onclick = async () => {
  cam.facing = cam.facing === 'user' ? 'environment' : 'user';
  try { await startStream(); } catch { host.toast('לא הצלחתי להחליף מצלמה.'); }
};
$('#camTimer').onclick = () => {
  timerSec = TIMERS[(TIMERS.indexOf(timerSec) + 1) % TIMERS.length]; showTimer();
  try { localStorage.setItem('bt.photoTimer', String(timerSec)); } catch { /* not remembered */ }
};
$('#camShoot').onclick = async () => {
  if (cam.shooting || !cam.stream) return;
  setShooting(true);
  const gen = cam.gen, c = $('#camCount');
  for (let s = timerSec; s > 0; s--) {
    if (gen !== cam.gen) return; // closed during the countdown
    c.hidden = false; c.textContent = s; await new Promise(r => setTimeout(r, 1000));
  }
  if (gen !== cam.gen) return;
  c.hidden = true;
  const v = $('#camVideo');
  setShooting(false);
  if (!v.videoWidth || !v.videoHeight) { host.toast('המצלמה עוד לא מוכנה. אפשר לנסות שוב.'); return; }
  const src = canvas(v.videoWidth, v.videoHeight);
  src.getContext('2d').drawImage(v, 0, 0); // the raw frame: not mirrored
  review(src, cam.pose, 'camera');
};

// ---- gallery: one old photo, for the pose that is selected ----
$('#pFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  let im;
  try { im = await loadImg(file); } catch { host.toast('לא הצלחתי לפתוח את התמונה.'); return; }
  const s = origSize(im.naturalWidth, im.naturalHeight), src = canvas(s.w, s.h);
  src.getContext('2d').drawImage(im, 0, 0, s.w, s.h);
  getPose().catch(() => {});
  review(src, view.pose, 'gallery');
};

// ---- review: the edited result, then save / retake ----
let pending = null, reviewToken = 0;
const note = text => el('p', 'note', text);
async function review(src, pose, from) {
  const sheet = $('#pReview'), token = ++reviewToken;
  const stale = () => token !== reviewToken || sheet.hidden; // cancelled, or a newer photo is being reviewed
  pending = null;
  $('#prTitle').textContent = `${POSE_HE[pose]} · בדיקה`;
  $('#prImg').hidden = true;
  $('#prNotes').replaceChildren(note('מיישר את התמונה…'));
  $('#prKeep').disabled = true; $('#prKeep').textContent = 'שמירה';
  $('#prRetake').hidden = from !== 'camera';
  $('#prDateBox').hidden = from !== 'gallery';
  $('#prDate').value = todayISO(); $('#prDate').max = todayISO(); $('#prDate').min = '2000-01-01'; $('#prDateErr').hidden = true;
  sheet.hidden = false;

  let p, block, warnings = [];
  try {
    p = await processPhoto(src, pose);
    block = p.chk.block; warnings = p.chk.warnings;
  } catch {
    p = { src, pose, m: null, bg: null, ref: null }; block = 'model';
  }
  if (stale()) return;
  const ok = !block;
  const out = drawEdited(p, ok);
  const msgs = block === 'model' ? ['לא הצלחתי לטעון את זיהוי הגוף, אז התמונה לא יושרה. בפעם הראשונה צריך אינטרנט.']
    : block ? [CHECK_HE[block]] : warnings.length ? warnings.map(w => CHECK_HE[w]) : ['היישור הצליח: הכתפיים והאגן במקום הקבוע.'];
  if (!ok) msgs.push(from === 'camera' ? 'אפשר לצלם שוב, או לשמור את התמונה בלי יישור. היא לא תופיע ב"לפני ואחרי".'
    : 'אפשר לבחור תמונה אחרת, או לשמור אותה בלי יישור. היא לא תופיע ב"לפני ואחרי".');
  $('#prNotes').replaceChildren(...msgs.map(note));
  const preview = await toBlob(out, 0.88);
  if (stale()) return;
  $('#prImg').src = url(preview); $('#prImg').hidden = false;
  $('#prKeep').textContent = ok ? 'שמירה' : 'שמירה בלי יישור';
  $('#prKeep').disabled = false;
  const m = p.m;
  pending = { out, src, pose, from, aligned: ok,
    metrics: { ratio: m ? m.ratio : 0, vis: m ? m.vis : 0, bg: p.bg, facing: m ? m.facing : 0 } };
}
$('#prKeep').onclick = async () => {
  const p = pending; if (!p) return;
  let date = todayISO();
  if (p.from === 'gallery') {
    date = $('#prDate').value;
    const bad = !isISODate(date) || date < '2000-01-01' || date > todayISO();
    $('#prDateErr').hidden = !bad;
    if (bad) return;
  }
  $('#prKeep').disabled = true;
  try {
    const ts = Date.now();
    const rec = { id: `ph-${date}-${p.pose}-${ts}`, date, pose: p.pose, ts, aligned: p.aligned,
      img: await bytes({ canvas: p.out, q: 0.88 }), orig: null, metrics: p.metrics, deleted: false };
    await put('photos', rec);
    view.photos.push(rec);
  } catch { $('#prKeep').disabled = false; host.toast('לא הצלחתי לשמור את התמונה.'); return; }
  pending = null;
  $('#pReview').hidden = true;
  await requestPersistence();
  if (p.from === 'camera') { cam.saved++; advance(); }
  else { view.pose = p.pose; await renderPhotos(); host.toast('התמונה נשמרה.'); }
};
const closeReview = () => { pending = null; reviewToken++; $('#pReview').hidden = true; };
$('#prRetake').onclick = closeReview;
$('#prCancel').onclick = closeReview;

// ---- photo backup: a separate file (spec §7) ----
const b64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).slice(String(r.result).indexOf(',') + 1));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
function fromB64(s) {
  const bin = atob(s), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a.buffer;
}
$('#pExport').onclick = async () => {
  const btn = $('#pExport'); btn.disabled = true;
  try {
    const all = await getAll('photos');
    if (!all.length) { host.toast('אין תמונות לגבות.'); return; }
    const at = new Date().toISOString();
    // Built in parts so a year of photos never becomes one huge string.
    const parts = [`{"app":"${BACKUP_APP}","version":${BACKUP_VERSION},"exported":"${at}","photos":[`];
    for (const [i, p] of all.entries()) {
      const rec = { id: p.id, date: p.date, pose: p.pose, ts: p.ts, aligned: p.aligned, deleted: !!p.deleted, metrics: p.metrics,
        img: await b64(jpg(p.img)) };
      parts.push((i ? ',' : '') + JSON.stringify(rec));
    }
    parts.push(']}');
    const r = await shareFile(new File(parts, `bodytrack-photos-${at.slice(0, 10)}.json`, { type: 'application/json' }));
    if (r === 'cancelled') return;
    await setMeta('lastPhotoBackup', at);
    if (r === 'shared') host.toast('הגיבוי מוכן. צריך לבחור "שמירה בקבצים".');
    await renderPhotos();
  } catch { host.toast('לא הצלחתי ליצור את קובץ הגיבוי.'); }
  finally { btn.disabled = false; }
};
$('#pImport').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  let obj; try { obj = JSON.parse(await f.text()); } catch { obj = null; }
  const v = validatePhotoBackup(obj);
  if (!v.photos.length) { host.toast(v.errors[0] || 'בקובץ אין תמונות.', 7000); return; }
  // A damaged photo doesn't block the rest: the good ones are restored, the count of skipped ones is reported.
  const skipped = v.errors.length ? ` ${v.errors.length === 1 ? 'תמונה אחת פגומה בקובץ לא שוחזרה.' : `${v.errors.length} תמונות פגומות בקובץ לא שוחזרו.`}` : '';
  await load();
  const add = photosToAdd(v.photos, view.photos.map(p => p.id));
  // Counts are of photos the owner sees; photos deleted on the old phone come back still deleted (undo state).
  const inFile = v.photos.filter(p => !p.deleted).length, newOnes = add.filter(p => !p.deleted).length;
  if (!newOnes) { host.toast('כל התמונות בקובץ כבר נמצאות במכשיר.' + skipped, 7000); return; }
  const ask = inFile === 1 ? 'בקובץ תמונה אחת, והיא חסרה במכשיר. להוסיף אותה?'
    : newOnes === 1 ? `בקובץ ${inFile} תמונות. אחת מהן חסרה במכשיר. להוסיף אותה?`
    : `בקובץ ${inFile} תמונות. ${newOnes} מהן חסרות במכשיר. להוסיף אותן?`;
  if (!confirm(ask)) return;
  try {
    await putMany('photos', add.map(p => ({ ...p, img: fromB64(p.img), orig: null }))); // originals in old backups are not kept
  } catch { host.toast('השחזור נכשל, שום דבר לא השתנה.'); return; }
  await requestPersistence();
  await renderPhotos();
  host.toast((newOnes === 1 ? 'שוחזרה תמונה אחת.' : `שוחזרו ${newOnes} תמונות.`) + skipped, skipped ? 8000 : 3500);
};

// Opening the screen starts loading the model in the background.
export function openPhotos() {
  showModel();
  getPose().catch(() => {});
  return renderPhotos();
}
