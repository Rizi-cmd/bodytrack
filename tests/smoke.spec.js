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

  const expectData = async () => {
    await expect(page.locator('#sumBody')).toBeVisible();
    await expect(page.locator('#emptyState')).toBeHidden();
    await expect(page.locator('#lastKg')).toHaveText('80.20');
    await expect(page.locator('#lastDate')).toHaveText('10.10.2026');
    await expect(page.locator('#nW')).toHaveText('16');     // the soft-deleted duplicate is not counted
    await expect(page.locator('#nM')).toHaveText('5');      // 4 full sets + 1 waist-only day
    await expect(page.locator('#since')).toHaveText('6.6.2026');
    await expect(page.locator('#listW .row')).toHaveCount(16);
    await expect(page.locator('#listW')).not.toContainText('99.90');
  };

  // 1. Fresh start: empty state.
  await page.goto(origin + '/');
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('#ver')).toContainText('גרסה');

  // 2. Restore through the real file input and confirm sheet.
  await page.locator('#importFile').setInputFiles(FIXTURE);
  await expect(page.locator('#importSheet')).toBeVisible();
  await expect(page.locator('#importSummary')).toContainText('שקילות');
  await page.locator('#impMerge').click();
  await expect(page.locator('#importSheet')).toBeHidden();
  await expect(page.locator('#toastMsg')).toContainText('שוחזרו');
  await expectData();

  // Circumferences tab shows the newest full set (waist 84 - 4.5 = 79.5).
  await page.locator('[data-list="m"]').click();
  await expect(page.locator('#listM .mday')).toHaveCount(5);
  await expect(page.locator('#listM .mday').first()).toContainText('79.5');
  await page.locator('[data-list="w"]').click();

  // No horizontal scroll at phone width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

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
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // 5. Offline reload: the service worker must serve the shell, IndexedDB still has the data.
  // Stop the server too: outside Chromium, setOffline may not block the service worker's own fetches.
  await context.setOffline(true);
  await stopServer();
  await page.reload();
  await expectData();
  await expect(page.locator('#ver')).toContainText('גרסה');

  await page.screenshot({ path: testInfo.outputPath('smoke.png'), fullPage: true }); // test-results/, git-ignored
  await context.setOffline(false);

  // 6. Gates.
  const foreign = [...hosts].filter(h => h !== new URL(origin).host);
  expect(foreign, 'requests to hosts other than the local server').toEqual([]);
  expect(problems, 'console errors / page errors').toEqual([]);
});
