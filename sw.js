// Offline support: caches the app files. User data never passes through here (it lives in IndexedDB).
const VERSION = 'bt-0.12.1';
const SHELL = ['./', './index.html', './css/app.css', './js/app.js', './js/db.js', './js/model.js', './js/backup.js', './js/trend.js', './js/report.js', './js/checkin.js', './js/analytics.js', './js/analyticsView.js', './js/analyticsScreen.js', './js/photos.js', './js/photosScreen.js', './js/galaxy.js', './js/motion.js', './js/journey.js', './js/weightView.js', './js/weightScreen.js',
  './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './fonts/heebo-hebrew-400-normal.woff2', './fonts/heebo-latin-400-normal.woff2', './fonts/heebo-hebrew-500-normal.woff2', './fonts/heebo-latin-500-normal.woff2', './fonts/heebo-hebrew-700-normal.woff2', './fonts/heebo-latin-700-normal.woff2', './fonts/heebo-hebrew-800-normal.woff2', './fonts/heebo-latin-800-normal.woff2', './fonts/heebo-hebrew-900-normal.woff2', './fonts/heebo-latin-900-normal.woff2'];
// Body-detection model (~15 MB): not part of the shell. Cached the first time the photos screen loads it,
// in its own cache that app updates keep. The folder carries the version, so cached files never go stale.
const MODEL = 'bt-model-0.10.14';
const MODEL_PATH = '/vendor/mediapipe/0.10.14/';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== MODEL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Model files: cache first.
  if (url.pathname.includes(MODEL_PATH)) {
    e.respondWith(caches.open(MODEL).then(c => c.match(req.url).then(hit => hit || fetch(req.url, { credentials: 'same-origin' }).then(res => {
      if (res.ok) c.put(req.url, res.clone());
      return res;
    }))));
    return;
  }
  // Everything else: network first (so updates arrive), cache when offline.
  e.respondWith(
    // no-cache: always ask the server (cheap ETag check), so a new version shows up on the next open
    // instead of after GitHub Pages' 10-minute browser cache runs out.
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
