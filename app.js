// BodyTrack – progress photos prototype.
// Privacy: photos never leave the device. They are stored in this site's IndexedDB on the phone.
// The only network requests are the app files and the open-source MediaPipe library/model
// (downloaded once, then cached by the service worker so the app works offline).

const MP_VER = '0.10.14';
const MP_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// Output frame and where the torso lands in it (every aligned photo shares this geometry).
const OUT_W = 900, OUT_H = 1200;
const SH_DST = { x: 450, y: 390 };   // mid-shoulder
const HIP_DST = { x: 450, y: 770 };  // mid-hip
const RATIO_TOL = 0.15;              // allowed change in shoulder-width / torso-length vs the reference
const VIS_MIN = 0.5;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// ---------- storage (IndexedDB, on the device only) ----------
const DB_NAME = 'bodytrack', DB_VER = 1;
let dbp;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('photos', mode), s = t.objectStore('photos');
    let out; Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const putPhoto = rec => tx('readwrite', s => { s.put(rec); });
const allPhotos = () => tx('readonly', s => new Promise(r => { const q = s.getAll(); q.onsuccess = () => r(q.result); }));
async function photosFor(angle) {
  return (await allPhotos()).filter(p => p.angle === angle && !p.deleted).sort((a, b) => a.ts - b.ts);
}

// ---------- helpers ----------
const urls = new Map();
function urlFor(rec, key = 'aligned') {
  const k = rec.id + ':' + key;
  if (!urls.has(k)) urls.set(k, URL.createObjectURL(rec[key]));
  return urls.get(k);
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmt = iso => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y.slice(2)}`; };
const ANGLE_HE = { front: 'חזית', side: 'צד', back: 'גב' };
const toBlob = (c, q) => new Promise(r => c.toBlob(r, 'image/jpeg', q));

let toastT;
function toast(msg, actLabel, act, ms = 5000) {
  const t = $('#toast'); $('#toastMsg').textContent = msg;
  const b = $('#toastAct'); b.textContent = actLabel || ''; b.hidden = !actLabel;
  b.onclick = () => { t.hidden = true; act && act(); };
  t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- pose model (runs on the phone) ----------
let posePromise = null;
function getPose() {
  if (window.__mockPose) return Promise.resolve(window.__mockPose); // test hook
  if (!posePromise) {
    posePromise = (async () => {
      const { PoseLandmarker, FilesetResolver } = await import(`${MP_CDN}/vision_bundle.mjs`);
      const fs = await FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
      const lm = await PoseLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: MP_MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE', numPoses: 1
      });
      try { localStorage.setItem('bt.modelReady', '1'); } catch {}
      updateModelState();
      return lm;
    })().catch(e => { posePromise = null; throw e; });
  }
  return posePromise;
}
function updateModelState() {
  let ready = false; try { ready = localStorage.getItem('bt.modelReady') === '1'; } catch {}
  $('#modelState').textContent = ready
    ? 'מודל זיהוי הגוף שמור במכשיר ועובד גם בלי אינטרנט.'
    : 'מודל זיהוי הגוף נטען בפעם הראשונה (צריך אינטרנט פעם אחת), ואז עובד גם בלי אינטרנט.';
}

// ---------- alignment ----------
function luminance(ctx, x, y, w, h) {
  const d = ctx.getImageData(x, y, w, h).data; let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
  return s / n;
}
function applyGain(ctx, gain) {
  if (Math.abs(gain - 1) < 0.03) return;
  const img = ctx.getImageData(0, 0, OUT_W, OUT_H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, d[i] * gain); d[i + 1] = Math.min(255, d[i + 1] * gain); d[i + 2] = Math.min(255, d[i + 2] * gain);
  }
  ctx.putImageData(img, 0, 0);
}

// src: a canvas holding the unmirrored photo. Returns everything needed to review and save.
async function processPhoto(src, angle, facing) {
  const pose = await getPose();
  const res = pose.detect(src);
  const L = res && res.landmarks && res.landmarks[0];
  const out = $('#outCanvas'); out.width = OUT_W; out.height = OUT_H;
  const o = out.getContext('2d', { willReadFrequently: true });
  o.fillStyle = '#000'; o.fillRect(0, 0, OUT_W, OUT_H);
  if (!L) return { ok: false, reason: 'לא זוהה גוף בתמונה. צריך שהכתפיים והאגן ייראו בבירור.' };

  const W = src.width, H = src.height;
  const P = i => ({ x: L[i].x * W, y: L[i].y * H, v: L[i].visibility ?? 1 });
  const ls = P(11), rs = P(12), lh = P(23), rh = P(24);
  const vis = Math.min(ls.v, rs.v, lh.v, rh.v);
  const sh = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }, hp = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  const v = { x: hp.x - sh.x, y: hp.y - sh.y }, t = { x: HIP_DST.x - SH_DST.x, y: HIP_DST.y - SH_DST.y };
  const vv = v.x * v.x + v.y * v.y;
  if (vv < 100) return { ok: false, reason: 'הגוף קטן מדי בתמונה. צריך להתקרב למצלמה.' };
  // z = t / v as complex numbers: scale + rotation that maps the torso onto the fixed frame
  const zr = (t.x * v.x + t.y * v.y) / vv, zi = (t.y * v.x - t.x * v.y) / vv;
  const e = SH_DST.x - (zr * sh.x - zi * sh.y), f = SH_DST.y - (zi * sh.x + zr * sh.y);
  o.setTransform(zr, zi, -zi, zr, e, f);
  o.imageSmoothingQuality = 'high';
  o.drawImage(src, 0, 0);
  o.setTransform(1, 0, 0, 1, 0, 0);

  const torsoLen = Math.sqrt(vv);
  const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const ratio = shoulderW / torsoLen;
  const box = [SH_DST.x - 110, SH_DST.y + 20, 220, HIP_DST.y - SH_DST.y - 40];
  const lum = luminance(o, ...box);

  const prev = await photosFor(angle);
  const ref = prev[0];
  const notes = [];
  if (vis < VIS_MIN) notes.push('הכתפיים או האגן לא זוהו בבירור, היישור עלול להיות לא מדויק.');
  if (ref) {
    const gain = Math.max(0.7, Math.min(1.4, ref.metrics.lum / Math.max(1, lum)));
    applyGain(o, gain);
    if (Math.abs(ratio / ref.metrics.ratio - 1) > RATIO_TOL)
      notes.push(`התנוחה שונה מהתמונה הראשונה (כנראה הגוף מסובב). כדאי לצלם שוב באותה עמידה.`);
  }

  const ghostC = document.createElement('canvas');
  const gs = Math.min(1, 720 / Math.max(W, H));
  ghostC.width = Math.round(W * gs); ghostC.height = Math.round(H * gs);
  ghostC.getContext('2d').drawImage(src, 0, 0, ghostC.width, ghostC.height);

  return {
    ok: true, notes,
    rec: {
      id: `${angle}-${Date.now()}`, angle, date: today(), ts: Date.now(), facing, deleted: false,
      metrics: { ratio, lum, vis },
      aligned: await toBlob(out, 0.88), ghost: await toBlob(ghostC, 0.7)
    }
  };
}

// ---------- state & tabs ----------
let angle = 'front', tab = 'shoot';
$$('[data-tab]').forEach(b => b.onclick = () => {
  tab = b.dataset.tab; $$('[data-tab]').forEach(x => x.setAttribute('aria-selected', x === b));
  $('#tab-shoot').hidden = tab !== 'shoot'; $('#tab-compare').hidden = tab !== 'compare'; render();
});
$$('[data-angle]').forEach(b => b.onclick = () => {
  angle = b.dataset.angle; $$('[data-angle]').forEach(x => x.setAttribute('aria-pressed', x === b)); render();
});

async function render() {
  const list = await photosFor(angle);
  const last = list[list.length - 1];
  $('#shootEmpty').hidden = !!last; $('#lastFrame').hidden = !last;
  if (last) {
    $('#lastImg').src = urlFor(last);
    $('#lastMeta').textContent = `אחרונה: ${fmt(last.date)} · ${list.length} תמונות ב${ANGLE_HE[angle]}`;
  } else $('#lastMeta').textContent = '';
  if (tab === 'compare') renderCompare(list);
}

// ---------- camera ----------
let stream = null, facing = 'user', timer = 5, ghostOn = true;
const TIMERS = [0, 3, 5, 10];
async function openCam() {
  $('#cam').hidden = false;
  await startStream();
  const list = await photosFor(angle), last = list[list.length - 1];
  const g = $('#ghost');
  if (last && last.ghost) { g.src = urlFor(last, 'ghost'); g.hidden = !ghostOn; } else g.hidden = true;
}
async function startStream() {
  stopStream();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1440 }, height: { ideal: 1920 } }, audio: false
    });
    const v = $('#video'); v.srcObject = stream; await v.play().catch(() => {});
    const mirror = facing === 'user';
    v.classList.toggle('mirror', mirror); $('#ghost').classList.toggle('mirror', mirror);
  } catch (e) {
    closeCam();
    toast('אין גישה למצלמה. צריך לאשר הרשאת מצלמה, או לייבא תמונה מהגלריה.');
  }
}
function stopStream() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }
function closeCam() { stopStream(); $('#cam').hidden = true; $('#count').hidden = true; }
$('#openCam').onclick = openCam;
$('#camClose').onclick = closeCam;
$('#flipBtn').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; startStream(); };
$('#ghostBtn').onclick = e => {
  ghostOn = !ghostOn; e.currentTarget.setAttribute('aria-pressed', ghostOn);
  const g = $('#ghost'); if (g.getAttribute('src')) g.hidden = !ghostOn;
};
$('#timerBtn').onclick = e => {
  timer = TIMERS[(TIMERS.indexOf(timer) + 1) % TIMERS.length];
  e.currentTarget.textContent = timer ? `טיימר ${timer}` : 'בלי טיימר';
};
let shooting = false;
$('#shutter').onclick = async () => {
  if (shooting || !stream) return; shooting = true;
  const c = $('#count');
  for (let s = timer; s > 0; s--) { c.hidden = false; c.textContent = s; await new Promise(r => setTimeout(r, 1000)); }
  c.hidden = true;
  const v = $('#video'), src = document.createElement('canvas');
  src.width = v.videoWidth; src.height = v.videoHeight;
  src.getContext('2d').drawImage(v, 0, 0);
  const usedFacing = facing;
  closeCam(); shooting = false;
  await review(src, usedFacing);
};

// ---------- import ----------
$('#filePick').onchange = async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  const img = new Image(); const u = URL.createObjectURL(file);
  img.src = u;
  try { await img.decode(); } catch { toast('לא הצלחתי לפתוח את התמונה.'); return; }
  const s = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
  const src = document.createElement('canvas');
  src.width = Math.round(img.naturalWidth * s); src.height = Math.round(img.naturalHeight * s);
  src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
  URL.revokeObjectURL(u);
  await review(src, 'import');
};

// ---------- review ----------
let pending = null;
async function review(src, usedFacing) {
  const sheet = $('#review'), note = $('#reviewNote');
  sheet.hidden = false; $('#keepBtn').disabled = true;
  note.innerHTML = '<p class="note ok"><span class="spin"></span> מיישר את התמונה…</p>';
  let r;
  try { r = await processPhoto(src, angle, usedFacing); }
  catch (e) {
    note.innerHTML = '';
    const p = document.createElement('p'); p.className = 'note warn';
    p.textContent = 'לא הצלחתי לטעון את מודל זיהוי הגוף. בפעם הראשונה צריך חיבור לאינטרנט.';
    note.append(p); return;
  }
  note.innerHTML = '';
  if (!r.ok) {
    const p = document.createElement('p'); p.className = 'note warn'; p.textContent = r.reason; note.append(p);
    pending = null; return;
  }
  pending = r.rec;
  const msgs = r.notes.length ? r.notes : ['היישור הצליח. הכתפיים והאגן במקום הקבוע.'];
  msgs.forEach(m => { const p = document.createElement('p'); p.className = 'note ' + (r.notes.length ? 'warn' : 'ok'); p.textContent = m; note.append(p); });
  $('#keepBtn').disabled = false;
}
$('#retakeBtn').onclick = () => { $('#review').hidden = true; pending = null; openCam(); };
$('#keepBtn').onclick = async () => {
  if (!pending) return;
  const rec = pending; pending = null;
  await putPhoto(rec);
  try { await navigator.storage?.persist?.(); } catch {}
  $('#review').hidden = true;
  render();
  toast('נשמר במכשיר. מומלץ לגבות לגלריה.', 'גיבוי לגלריה', () => backup(rec), 9000);
};
async function backup(rec) {
  const file = new File([rec.aligned], `bodytrack-${rec.angle}-${rec.date}.jpg`, { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch {}
  } else {
    toast('הדפדפן הזה לא תומך בשמירה לגלריה מכאן.');
  }
}

// ---------- compare ----------
let mode = 'slider', playing = null;
$$('[data-mode]').forEach(b => b.onclick = () => {
  mode = b.dataset.mode; $$('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b)); render();
});
function renderCompare(list) {
  stopPlay();
  $('#cmpEmpty').hidden = list.length >= 2; $('#cmpBody').hidden = list.length < 2;
  const grid = $('#grid'); grid.innerHTML = '';
  list.slice().reverse().forEach(p => {
    const b = document.createElement('button');
    const im = document.createElement('img'); im.src = urlFor(p); im.alt = fmt(p.date);
    const s = document.createElement('span'); s.textContent = fmt(p.date);
    b.append(im, s); b.onclick = () => askDelete(p); grid.append(b);
  });
  if (list.length < 2) return;
  const fill = (sel, idx) => {
    const keep = sel.value; sel.innerHTML = '';
    list.forEach((p, i) => { const o = document.createElement('option'); o.value = p.id; o.textContent = fmt(p.date); sel.append(o); });
    sel.value = list.some(p => p.id === keep) ? keep : list[idx].id;
  };
  fill($('#selA'), 0); fill($('#selB'), list.length - 1);
  const A = list.find(p => p.id === $('#selA').value), B = list.find(p => p.id === $('#selB').value);
  $('#slider').hidden = mode !== 'slider'; $('#side').hidden = mode !== 'side'; $('#play').hidden = mode !== 'play';
  $('#imgA').src = urlFor(A); $('#imgB').src = urlFor(B);
  $('#lblA').textContent = fmt(A.date); $('#lblB').textContent = fmt(B.date);
  $('#sideA').src = urlFor(A); $('#sideB').src = urlFor(B);
  $('#capA').textContent = fmt(A.date); $('#capB').textContent = fmt(B.date);
  $('#playImg').src = urlFor(list[list.length - 1]); $('#playLbl').textContent = fmt(list[list.length - 1].date);
  $('#playBtn').onclick = () => playing ? stopPlay() : startPlay(list);
}
$('#selA').onchange = render; $('#selB').onchange = render;
function startPlay(list) {
  let i = 0; $('#playBtn').textContent = 'עצירה';
  const step = () => { const p = list[i % list.length]; $('#playImg').src = urlFor(p); $('#playLbl').textContent = fmt(p.date); i++; };
  step(); playing = setInterval(step, 700);
}
function stopPlay() { if (playing) clearInterval(playing); playing = null; $('#playBtn').textContent = 'הפעלה'; }

// slider drag (pointer events work for touch and mouse)
(() => {
  const el = $('#slider'); let drag = false;
  const set = e => { const r = el.getBoundingClientRect(); const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); el.style.setProperty('--cut', (x * 100).toFixed(1) + '%'); };
  el.addEventListener('pointerdown', e => { drag = true; el.setPointerCapture(e.pointerId); set(e); });
  el.addEventListener('pointermove', e => { if (drag) set(e); });
  el.addEventListener('pointerup', () => { drag = false; });
  el.addEventListener('pointercancel', () => { drag = false; });
})();

// ---------- delete with undo ----------
function askDelete(p) {
  toast(`למחוק את התמונה מ-${fmt(p.date)}?`, 'מחיקה', async () => {
    p.deleted = true; await putPhoto(p); render();
    toast('התמונה נמחקה.', 'ביטול', async () => { p.deleted = false; await putPhoto(p); render(); }, 7000);
  });
}

// ---------- boot ----------
updateModelState();
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__bt = { processPhoto, photosFor, putPhoto, allPhotos }; // test hook
