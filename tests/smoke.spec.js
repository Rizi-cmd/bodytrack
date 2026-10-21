// Smoke test: restore the invented fixture through the real UI, reload, reload offline.
// Fails on any console error, page error, or request to a host other than the local test server.
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'sample-backup.json');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml'
};

// Tiny static server for the repo root. Only the app's own files; nothing outside ROOT.
function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, path.normalize(p));
      if (!file.startsWith(ROOT + path.sep) || /(^|[\\/])(\.git|node_modules|tests)([\\/]|$)/.test(path.relative(ROOT, file))) {
        res.writeHead(403).end('forbidden'); return;
      }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let server, origin;
test.beforeAll(async () => {
  server = await startServer();
  origin = `http://127.0.0.1:${server.address().port}`;
});
const stopServer = () => new Promise(r => { if (!server) return r(); server.closeAllConnections(); server.close(r); server = null; });
test.afterAll(stopServer);

test('restore fixture, reload, reload offline; no errors, no outside network', async ({ page, context }, testInfo) => {
  const problems = [];
  const hosts = new Set();
  page.on('console', m => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  context.on('request', r => {
    const u = new URL(r.url());
    if (!['data:', 'blob:', 'about:'].includes(u.protocol)) hosts.add(u.host);
  });

  const M = '\u2212';
  const expectData = async () => {
    await expect(page.locator('#lastKg')).toHaveText('80.2');
    await expect(page.locator('#lastLab')).toContainText('10.10');
    await expect(page.locator('#avg')).toHaveText('80.6');
    await expect(page.locator('#rate')).toHaveText(M + '0.33');
    await expect(page.locator('#mc')).toHaveText(M + '1.3');
    await expect(page.locator('#listW .row')).toHaveCount(16);   // the soft-deleted duplicate is not counted
    await expect(page.locator('#listW')).not.toContainText('99.9');
    await expect(page.locator('#chart svg circle')).toHaveCount(11); // "3 months" view
    await expect(page.locator('#circTable tr')).toHaveCount(11);
    await expect(page.locator('#notes')).toContainText('מחלה');    // invented sick-tagged weigh-in in the window
  };
  const expectCut = async () => {
    await expect(page.locator('#vWord')).toHaveText('↓ יורד');
    await expect(page.locator('#vWord')).toHaveClass(/good/);
    await expect(page.locator('#vLabel')).toHaveText('לכיוון היעד');
    await expect(page.locator('#phaseBtn')).toHaveText('חיטוב ▾');
    await expect(page.locator('#mcBox')).toHaveClass(/good/);
  };

  // 1. Fresh start: empty state.
  await page.goto(origin + '/');
  await expect(page.locator('#vWord')).toHaveText('מוקדם להגיד');
  await expect(page.locator('#vLabel')).toHaveText('אין עדיין שקילות');
  await expect(page.locator('#rate')).toHaveText('—');
  await expect(page.locator('#chartEmpty')).toBeVisible();
  await expect(page.locator('#ver')).toContainText('גרסה');

  // 2. Restore through the real file input and confirm sheet.
  await page.locator('#importFile').setInputFiles(FIXTURE);
  await expect(page.locator('#importSheet')).toBeVisible();
  await expect(page.locator('#importSummary')).toContainText('שקילות');
  await page.locator('#impMerge').click();
  await expect(page.locator('#importSheet')).toBeHidden();
  await expect(page.locator('#toastMsg')).toContainText('שוחזרו');
  await expectData();
  // No phase yet: rate shown, no colour.
  await expect(page.locator('#vLabel')).toHaveText('לא נבחר שלב');
  await expect(page.locator('#vWord')).toHaveClass(/ink/);
  // Pick "cut": green toward the goal.
  await expect(page.locator('#phaseBtn')).toHaveText('בחירת שלב ▾');
  await page.locator('#phaseBtn').click();
  await page.locator('[data-phase="cut"]').click();
  await page.locator('#targetKg').fill('abc');
  await page.locator('#phaseSave').click();
  await expect(page.locator('#targetErr')).toBeVisible();          // bad target is not saved
  await page.locator('#targetKg').fill('78,5');
  await page.locator('#phaseSave').click();
  await expect(page.locator('#phaseSheet')).toBeHidden();
  await expectCut();
  await page.locator('#phaseBtn').click();
  await expect(page.locator('#targetKg')).toHaveValue('78.5');
  await page.locator('#phaseCancel').click();
  await page.locator('[data-range="all"]').click();
  await expect(page.locator('#chart svg circle')).toHaveCount(16);
  await page.locator('[data-range="quarter"]').click();

  // Circumferences tab shows the newest full set (waist 84 - 4.5 = 79.5).
  await expect(page.locator('#histSec')).not.toHaveAttribute('open', '');   // closed by default
  await expect(page.locator('#circSec')).not.toHaveAttribute('open', '');
  await page.locator('#circSec summary').click();
  await expect(page.locator('#circTable')).toBeVisible();
  await page.locator('#histSec summary').click();
  await page.locator('[data-list="m"]').click();
  await expect(page.locator('#listM .mday')).toHaveCount(5);
  await expect(page.locator('#listM .mday').first()).toContainText('79.5');
  await page.locator('[data-list="w"]').click();

  // No horizontal scroll at phone width, and no text smaller than 12px (charts included).
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const small = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .filter(e => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 12)
    .map(e => e.tagName + ':' + e.textContent.trim().slice(0, 20)));
  expect(small, 'text under 12px').toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('verdict.png'), fullPage: true });
  // Smaller iPhone (375pt): still no horizontal scroll, hero number fits.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => { const h = document.querySelector('.hero'); return h.scrollWidth <= h.clientWidth + 1; })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('verdict-375.png') });
  await page.setViewportSize({ width: 440, height: 956 });

  // 3. Wait until the service worker controls the page and has cached the shell.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async () => {
    const keys = await caches.keys();
    for (const k of keys) if (await (await caches.open(k)).match('./index.html')) return true;
    return false;
  })).toBe(true);

  // 4. Online reload: data persisted in IndexedDB.
  await page.reload();
  await expectData();
  await expectCut();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // 5. Offline reload: the service worker must serve the shell, IndexedDB still has the data.
  // "Offline" = the server is gone. Playwright's setOffline is not used: in WebKit it makes the reload fail
  // with an internal error before the service worker can answer, and outside Chromium it may not block
  // the worker's own fetches anyway.
  await stopServer();
  await page.reload();
  await expectData();
  await expectCut();
  await expect(page.locator('#ver')).toContainText('גרסה');

  await page.screenshot({ path: testInfo.outputPath('smoke.png'), fullPage: true }); // test-results/, git-ignored

  // 6. Gates.
  const foreign = [...hosts].filter(h => h !== new URL(origin).host);
  expect(foreign, 'requests to hosts other than the local server').toEqual([]);
  expect(problems, 'console errors / page errors').toEqual([]);
});
