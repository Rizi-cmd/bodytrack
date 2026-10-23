// Photos screen (spec docs/specs/photos.md), WebKit at iPhone size.
// Test 1 uses a mocked body detector (no model download): gallery photo → review → save, before/after, delete + undo,
// photo backup out and back in. Test 2 loads the real self-hosted model once and runs it on a photo with no body.
// Both fail on any console error, page error, or request to a host other than the local test server.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { startServer, ROOT, FIXTURE } from './server.js';

const PHOTO = path.join(ROOT, 'icons', 'icon-512.png'); // stands in for a photo; the mock decides where the "body" is

let server, origin;
test.beforeAll(async () => {
  server = await startServer();
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));

function watch(page, context) {
  const problems = [], hosts = new Set();
  // MediaPipe prints one INFO line to the error console when it starts; anything else counts.
  page.on('console', m => { if (m.type() === 'error' && !/^INFO: Created TensorFlow Lite XNNPACK delegate/.test(m.text())) problems.push(`console.error: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  context.on('request', r => {
    const u = new URL(r.url());
    if (!['data:', 'blob:', 'about:'].includes(u.protocol)) hosts.add(u.host);
  });
  return { problems, hosts };
}
async function layoutOk(page, name) {
  for (const width of [375, 440]) {
    await page.setViewportSize({ width, height: width === 440 ? 956 : 812 });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} @${width}: horizontal scroll`).toBe(true);
  }
  const small = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .filter(e => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 12)
    .map(e => e.tagName + ':' + e.textContent.trim().slice(0, 20)));
  expect(small, `${name}: text under 12px`).toEqual([]);
}
async function addPhoto(page, date) {
  await page.locator('#pFile').setInputFiles(PHOTO);
  await expect(page.locator('#pReview')).toBeVisible();
  await expect(page.locator('#prKeep')).toBeEnabled();
  await expect(page.locator('#prRetake')).toBeHidden();      // gallery: no retake
  await expect(page.locator('#prDateBox')).toBeVisible();
  await page.locator('#prDate').fill(date);
  await page.locator('#prKeep').click();
  await expect(page.locator('#pReview')).toBeHidden();
}

test('photos: gallery photo, before/after, delete + undo, photo backup round trip (mocked detector)', async ({ page, context }, testInfo) => {
  const { problems, hosts } = watch(page, context);
  await context.addInitScript(() => {
    const body = () => {
      const L = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
      L[0] = { x: 0.5, y: 0.2, visibility: 0.9 };
      L[11] = { x: 0.6, y: 0.3, visibility: 0.9 }; L[12] = { x: 0.4, y: 0.3, visibility: 0.9 };
      L[23] = { x: 0.57, y: 0.6, visibility: 0.9 }; L[24] = { x: 0.43, y: 0.6, visibility: 0.9 };
      return L;
    };
    window.__mockPose = { detect(img, cb) { cb(window.__noBody ? { landmarks: [] } : { landmarks: [body()], segmentationMasks: [] }); } };
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // files go out as a download in the test
  });

  await page.goto(origin + '/');
  await page.locator('#importFile').setInputFiles(FIXTURE);           // invented weigh-ins for the captions
  await page.locator('#impMerge').click();
  await expect(page.locator('#toastMsg')).toContainText('שוחזרו');

  // Empty screen.
  await page.locator('#hMore').click(); await page.locator('[data-more="photos"]').click();
  await expect(page.locator('#phoView')).toBeVisible();
  await expect(page.locator('#homeView')).toBeHidden();
  await expect(page.locator('#pLastEmpty')).toHaveText('אין עדיין תמונות חזית.');
  await expect(page.locator('#pCmpEmpty')).toBeVisible();
  await expect(page.locator('#pBackupInfo')).toContainText('עוד לא נשמר גיבוי תמונות');
  await expect(page.locator('#pNag')).toBeHidden();
  await expect(page.locator('#pModel')).toContainText('מוכן');
  await layoutOk(page, 'photos empty');

  // Camera: there is none in the test browser → a message, no error.
  await page.locator('#shootBtn').click();
  await expect(page.locator('#toastMsg')).toContainText('אין גישה למצלמה');
  await expect(page.locator('#cam')).toBeHidden();

  // A future date is refused.
  await page.locator('#pFile').setInputFiles(PHOTO);
  await expect(page.locator('#prNotes')).toContainText('היישור הצליח');
  await page.locator('#prDate').fill('2099-01-01');
  await page.locator('#prKeep').click();
  await expect(page.locator('#prDateErr')).toBeVisible();
  await page.locator('#prCancel').click();

  // Two aligned photos → latest figure, grid, before/after with the weigh-ins of those days.
  await addPhoto(page, '2026-10-03');
  await expect(page.locator('#toastMsg')).toHaveText('התמונה נשמרה.');
  await expect(page.locator('#pLastCap')).toHaveText('3.10.2026');
  await expect(page.locator('#pCmpEmpty')).toBeVisible();              // one photo is not a pair
  await addPhoto(page, '2026-10-10');
  await expect(page.locator('#pLastCap')).toHaveText('10.10.2026');
  await expect(page.locator('#pGrid .thumb')).toHaveCount(2);
  await expect(page.locator('#pAllTitle')).toContainText('(2)');
  await expect(page.locator('#pCmpBox')).toBeVisible();
  await expect(page.locator('#pBefore')).toHaveValue(/2026-10-03/);
  await expect(page.locator('#pAfter')).toHaveValue(/2026-10-10/);
  await expect.poll(() => page.locator('#pCmp').evaluate(i => i.complete ? i.naturalWidth : 0)).toBe(1800);
  await expect(page.locator('#pCmpCap div').first()).toContainText('3.10.2026');   // readable captions as page text, earlier first (right)
  await expect(page.locator('#pCmpCap div').last()).toContainText('10.10.2026');
  await expect(page.locator('#pCmpCap')).toContainText('ק״ג');
  // Picked the other way round: still earlier on the right. Same photo twice: a note, no image.
  await page.locator('#pBefore').selectOption({ label: '10.10.2026' });
  await page.locator('#pAfter').selectOption({ label: '3.10.2026' });
  await expect(page.locator('#pCmpCap div').first()).toContainText('3.10.2026');
  await page.locator('#pAfter').selectOption({ label: '10.10.2026' });
  await expect(page.locator('#pCmpNote')).toBeVisible();
  await expect(page.locator('#pCmp')).toBeHidden();
  await page.locator('#pBefore').selectOption({ label: '3.10.2026' });
  await expect(page.locator('#pCmpNote')).toBeHidden();
  await expect(page.locator('#pCmp')).toBeVisible();
  await expect(page.locator('#pNag')).toBeVisible();                   // photos without a backup
  await page.locator('#pAllSec summary').click();
  await layoutOk(page, 'photos with two');
  await page.screenshot({ path: testInfo.outputPath('photos.png'), fullPage: true });

  // Other pose is still empty.
  await page.locator('[data-pose="side"]').click();
  await expect(page.locator('#pLastEmpty')).toHaveText('אין עדיין תמונות צד.');
  await expect(page.locator('#pGrid .thumb')).toHaveCount(0);
  await page.locator('[data-pose="front"]').click();

  // No body → keep unaligned; it's marked and not offered in before/after.
  await page.evaluate(() => { window.__noBody = true; });
  await page.locator('#pFile').setInputFiles(PHOTO);
  await expect(page.locator('#prNotes')).toContainText('לא זיהיתי גוף');
  await expect(page.locator('#prKeep')).toHaveText('שמירה בלי יישור');
  await page.locator('#prDate').fill('2026-10-12');
  await page.locator('#prKeep').click();
  await expect(page.locator('#pLastCap')).toContainText('לא מיושרת');
  await expect(page.locator('#pGrid .thumb')).toHaveCount(3);
  await expect(page.locator('#pBefore option')).toHaveCount(2);
  await page.evaluate(() => { window.__noBody = false; });

  // Delete (soft) and undo.
  await page.locator('#pGrid .thumb').first().click();
  await expect(page.locator('#pdInfo')).toContainText('לא מיושרת');
  await page.locator('#pdDelete').click();
  await expect(page.locator('#pGrid .thumb')).toHaveCount(2);
  await page.locator('#toastAct').click();
  await expect(page.locator('#pGrid .thumb')).toHaveCount(3);
  await expect(page.locator('#toastMsg')).toHaveText('המחיקה בוטלה.');

  // Photo backup out.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#pExport').click()]);
  const file = testInfo.outputPath('photos-backup.json');
  await dl.saveAs(file);
  const backup = JSON.parse(await readFile(file, 'utf8'));
  expect(backup.app).toBe('bodytrack-photos');
  expect(backup.photos).toHaveLength(3);
  for (const p of backup.photos) { expect(p.img.startsWith('/9j/')).toBe(true); expect(p.orig).toBeUndefined(); } // edited photo only (owner, 22.10)
  await expect(page.locator('#pBackupInfo')).toContainText('גיבוי תמונות אחרון');
  await expect(page.locator('#pNag')).toBeHidden();

  // A data backup is refused here with a clear message.
  await page.locator('#pImport').setInputFiles(FIXTURE);
  await expect(page.locator('#toastMsg')).toContainText('במסך הראשי');

  // Fresh phone: empty the photo store, restore the photo backup.
  await page.evaluate(() => new Promise((res, rej) => {
    const q = indexedDB.open('bodytrack-data');
    q.onsuccess = () => { const t = q.result.transaction('photos', 'readwrite'); t.objectStore('photos').clear(); t.oncomplete = () => { q.result.close(); res(); }; t.onerror = () => rej(t.error); };
    q.onerror = () => rej(q.error);
  }));
  await page.reload();
  await page.locator('#hMore').click(); await page.locator('[data-more="photos"]').click();
  await expect(page.locator('#pLastEmpty')).toBeVisible();
  page.once('dialog', d => d.accept());
  await page.locator('#pImport').setInputFiles(file);
  await expect(page.locator('#toastMsg')).toHaveText('שוחזרו 3 תמונות.');
  await expect(page.locator('#pGrid .thumb')).toHaveCount(3);
  await expect.poll(() => page.locator('#pCmp').evaluate(i => i.complete ? i.naturalWidth : 0)).toBe(1800);
  // Same file again: nothing new.
  await page.locator('#pImport').setInputFiles(file);
  await expect(page.locator('#toastMsg')).toHaveText('כל התמונות בקובץ כבר נמצאות במכשיר.');

  // A photo still carrying a trial-period original: opening the screen removes the original, keeps the photo.
  const idb = fn => page.evaluate(fn);
  await idb(() => new Promise((res, rej) => {
    const q = indexedDB.open('bodytrack-data');
    q.onsuccess = () => {
      const t = q.result.transaction('photos', 'readwrite'), os = t.objectStore('photos');
      os.getAll().onsuccess = e => { const p = e.target.result[0]; os.put({ ...p, orig: new Uint8Array([1, 2, 3]).buffer }); };
      t.oncomplete = () => { q.result.close(); res(); }; t.onerror = () => rej(t.error);
    };
  }));
  await page.locator('[data-pose="side"]').click();
  await expect.poll(() => idb(() => new Promise(res => {
    const q = indexedDB.open('bodytrack-data');
    q.onsuccess = () => { q.result.transaction('photos').objectStore('photos').getAll().onsuccess = e => { q.result.close(); res(e.target.result.filter(p => p.orig).length); }; };
  }))).toBe(0);
  await page.locator('[data-pose="front"]').click();
  await expect(page.locator('#pGrid .thumb')).toHaveCount(3);

  await page.locator('#phoBack').click();
  await expect(page.locator('#homeView')).toBeVisible();

  expect(problems).toEqual([]);
  expect([...hosts]).toEqual([new URL(origin).host]);
});

test('photos: the real self-hosted model loads and reports a photo with no body', async ({ page, context }) => {
  test.setTimeout(180_000);
  const { problems, hosts } = watch(page, context);
  await page.goto(origin + '/');
  await page.locator('#hMore').click(); await page.locator('[data-more="photos"]').click();
  await expect(page.locator('#pModel')).toContainText('מוכן', { timeout: 150_000 });
  await page.locator('#pFile').setInputFiles(PHOTO);
  await expect(page.locator('#prNotes')).toContainText('לא זיהיתי גוף', { timeout: 60_000 });
  await expect(page.locator('#prKeep')).toHaveText('שמירה בלי יישור');
  expect(problems).toEqual([]);
  expect([...hosts]).toEqual([new URL(origin).host]);
});
