// Smoke test: restore the invented fixture through the real UI, reload, reload offline.
// Fails on any console error, page error, or request to a host other than the local test server.
import { test, expect } from '@playwright/test';
import { startServer, FIXTURE } from './server.js';

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
  // No horizontal scroll at phone width (440 and 375), and no text smaller than 12px (charts included).
  const layoutOk = async name => {
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
  };
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
  // The light report (history, backup, chart) opens from "עוד" on the dark home.
  const toReport = async () => {
    await page.locator('#hMore').click();
    await page.locator('[data-more="history"]').click();
    await expect(page.locator('#main')).toBeVisible();
  };
  const expectCut = async () => {
    await expect(page.locator('#hWord')).toHaveText('↓ יורד');
    await expect(page.locator('#hWord')).toHaveClass(/good/);
    await expect(page.locator('#hLabel')).toHaveText('לכיוון היעד');
    await expect(page.locator('#vWord')).toHaveText('↓ יורד');
    await expect(page.locator('#vWord')).toHaveClass(/good/);
    await expect(page.locator('#vLabel')).toHaveText('לכיוון היעד');
    await expect(page.locator('#phaseBtn')).toHaveText('חיטוב ▾');
    await expect(page.locator('#mcBox')).toHaveClass(/good/);
  };

  // 1. Fresh start: empty state.
  await page.goto(origin + '/');
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#main')).toBeHidden();
  await expect(page.locator('#hWord')).toHaveText('מוקדם להגיד');
  await expect(page.locator('#hRate')).toHaveText('—');
  await expect(page.locator('#hWhen')).toHaveText('עוד אין שקילות');
  await layoutOk('home empty');
  await toReport();
  await expect(page.locator('#vWord')).toHaveText('מוקדם להגיד');
  await expect(page.locator('#vLabel')).toHaveText('אין עדיין שקילות');
  await expect(page.locator('#rate')).toHaveText('—');
  await expect(page.locator('#chartEmpty')).toBeVisible();
  await expect(page.locator('#ver')).toContainText('גרסה');
  // Analytics with no data: empty states, no errors.
  await page.locator('#anaBtn').click();
  await expect(page.locator('#aChartEmpty')).toBeVisible();
  await expect(page.locator('#aBarsEmpty')).toBeVisible();
  await expect(page.locator('#aCircEmpty')).toBeVisible();
  await expect(page.locator('#aKg')).toHaveText('—');
  await expect(page.locator('#aRateWord')).toHaveText('אין עדיין שקילות');
  await layoutOk('analytics empty');
  await page.locator('#anaBack').click();

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
  await page.locator('#anaBtn').click();
  await expect(page.locator('#aZone')).toContainText('לא נבחר שלב');
  await expect(page.locator('#aRateWord')).toContainText('לא נבחר שלב');
  await expect(page.locator('#aKgBox')).toHaveClass(/ink/);
  await expect(page.locator('#aChart svg .phase-a')).toHaveCount(0);
  await page.locator('#anaBack').click();
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
  // Long press on the chart, slide to the right end: readout of the last weigh-in; lifting hides it.
  const cb = await page.locator('#chart svg').boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await expect(page.locator('#chartRead')).toBeVisible();
  await page.mouse.move(cb.x + cb.width - 2, cb.y + cb.height / 2, { steps: 5 });
  await expect(page.locator('#chartRead')).toContainText('10.10.2026');
  await expect(page.locator('#chartRead')).toContainText('80.2');
  await expect(page.locator('#chartRead')).toContainText('80.6');
  await page.mouse.up();
  await expect(page.locator('#chartRead')).toBeHidden();
  await expect(page.locator('#chart svg circle')).toHaveCount(16);
  // A quick tap shows nothing.
  await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.waitForTimeout(500);
  await expect(page.locator('#chartRead')).toBeHidden();
  await page.locator('[data-range="half"]').click();
  await expect(page.locator('[data-range="half"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-range="quarter"]').click();

  // Check-in: weight starts at the previous weigh-in; save shows on the verdict, "סיום" closes, undo puts it back.
  await page.locator('#checkinBtn').click();
  await expect(page.locator('#checkinView')).toBeVisible();
  await expect(page.locator('#main')).toBeHidden();
  await expect(page.locator('#ciKg')).toHaveValue('80.2');
  await expect(page.locator('#ciKgInfo')).toContainText('10.10');
  await expect(page.locator('#ciSites tr')).toHaveCount(11);
  await expect(page.locator('#ciSites')).toContainText('קודם');
  await expect(page.locator('#ciEditing')).toBeHidden();
  await page.locator('#ciKg').fill('');
  await page.locator('#ciSave').click();
  await expect(page.locator('#ciKgErr')).toBeVisible();           // weight is required
  await expect(page.locator('#checkinView')).toBeVisible();
  await page.locator('#ciKg').fill('80.0');
  await page.locator('[data-for="ciKg"][data-step="-0.1"]').click();
  await expect(page.locator('#ciKg')).toHaveValue('79.9');
  await layoutOk('weigh-in');
  await page.screenshot({ path: testInfo.outputPath('weighin.png') });
  // Circumferences are their own screen; a bad value is named there, nothing saved.
  await expect(page.locator('#ciCircBtn')).toHaveText('+ היקפים');
  await expect(page.locator('#ciNoteBtn')).toHaveText('+ סוג שבוע והערה');
  await page.locator('#ciCircBtn').click();
  await expect(page.locator('#ciC')).toBeVisible();
  await expect(page.locator('#ciW')).toBeHidden();
  // −/+ start from the previous value; an untouched row stays empty (not measured).
  await expect(page.locator('#ci-hips')).toHaveValue('');
  await expect(page.locator('#ci-hips')).toHaveAttribute('placeholder', '94.5');
  await page.locator('[data-for="ci-hips"][data-step="-0.5"]').click();
  await expect(page.locator('#ci-hips')).toHaveValue('94.0');
  await page.locator('[data-for="ci-hips"][data-step="0.5"]').click();
  await page.locator('[data-for="ci-hips"][data-step="0.5"]').click();
  await expect(page.locator('#ci-hips')).toHaveValue('95.0');
  await page.locator('#ci-hips').fill('');
  await page.locator('#ci-waist').fill('7.9.1');
  await page.locator('#ciCircDone').click();
  await page.locator('#ciSave').click();
  await expect(page.locator('#ci-err-waist')).toBeVisible();       // bad circumference is named, nothing saved
  await page.locator('#ci-waist').fill('79');
  await expect(page.locator('#ci-err-waist')).toBeHidden();        // fixing the value clears the error
  await layoutOk('circumferences');
  await page.screenshot({ path: testInfo.outputPath('circumferences.png'), fullPage: true });
  await page.locator('#ciCircDone').click();
  await expect(page.locator('#ciCircBtn')).toHaveText('היקפים · 1 מתוך 11');
  await page.locator('#ciNoteBtn').click();
  await page.locator('[data-tag="vacation"]').click();
  await expect(page.locator('[data-tag="vacation"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#ciNote').fill('SAMPLE note');
  await page.locator('#ciNoteDone').click();
  await expect(page.locator('#ciNoteBtn')).toHaveText('חופשה · SAMPLE note');
  await page.locator('#ciSave').click();
  await expect(page.locator('#homeView')).toBeVisible();             // saving goes back to the dark home
  await expect(page.locator('#hWhen')).toContainText('שקילה אחרונה');
  await expect(page.locator('#lensDots .ldot')).toHaveCount(4);
  await toReport();
  await expect(page.locator('#lastKg')).toHaveText('79.9');
  await expect(page.locator('#listW .row')).toHaveCount(17);
  await expect(page.locator('#notes')).toContainText('חופשה');
  // Long press on the newest weigh-in shows that day's week type and note.
  await page.locator('#chart').scrollIntoViewIfNeeded();
  const nb = await page.locator('#chart svg').boundingBox();
  await page.mouse.move(nb.x + nb.width - 2, nb.y + nb.height / 2);
  await page.mouse.down();
  await expect(page.locator('#chartRead')).toContainText('79.9');
  await expect(page.locator('#chartRead')).toContainText('חופשה · SAMPLE note');
  await page.mouse.up();
  await page.locator('#toastAct').click();
  await expect(page.locator('#toastMsg')).toHaveText('השמירה בוטלה.');
  await expect(page.locator('#lastKg')).toHaveText('80.2');
  await expect(page.locator('#listW .row')).toHaveCount(16);
  await expect(page.locator('#notes')).not.toContainText('חופשה');

  // Quick weigh-in: weight only, undo puts it back.
  await page.locator('#quickBtn').click();
  await expect(page.locator('#quickSheet')).toBeVisible();
  await expect(page.locator('#qKg')).toHaveValue('80.2');
  await page.locator('[data-for="qKg"][data-step="0.1"]').click();
  await page.locator('#qSave').click();
  await expect(page.locator('#quickSheet')).toBeHidden();
  await expect(page.locator('#lastKg')).toHaveText('80.3');
  await page.locator('#toastAct').click();
  await expect(page.locator('#lastKg')).toHaveText('80.2');
  await expect(page.locator('#listW .row')).toHaveCount(16);

  // Typo guard: more than 2 kg from the previous weigh-in asks first. "No" saves nothing; "yes" saves.
  await page.locator('#quickBtn').click();
  await page.locator('#qKg').fill('85');
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.locator('#qSave').click();
  await expect.poll(() => asked).toContain('4.8 ק״ג יותר');
  await expect(page.locator('#quickSheet')).toBeVisible();
  await expect(page.locator('#lastKg')).toHaveText('80.2');
  page.once('dialog', d => d.accept());
  await page.locator('#qSave').click();
  await expect(page.locator('#lastKg')).toHaveText('85.0');
  await page.locator('#toastAct').click();
  await expect(page.locator('#lastKg')).toHaveText('80.2');

  // Circumferences tab shows the newest full set (waist 84 - 4.5 = 79.5).
  await expect(page.locator('#histSec')).toHaveAttribute('open', '');       // "היסטוריה" in "עוד" opens it
  await expect(page.locator('#circSec')).not.toHaveAttribute('open', '');
  await page.locator('#circSec summary').click();
  await expect(page.locator('#circTable')).toBeVisible();
  await page.locator('[data-list="m"]').click();
  await expect(page.locator('#listM .mday')).toHaveCount(5);
  await expect(page.locator('#listM .mday').first()).toContainText('79.5');
  // History: fix a day of circumferences, then undo.
  await page.locator('#listM .mday').first().click();
  await expect(page.locator('#editSheet')).toBeVisible();
  await expect(page.locator('#eSites tr')).toHaveCount(11);
  await expect(page.locator('#e-waist')).toHaveValue('79.5');
  await page.locator('#e-waist').fill('79.1');
  await page.locator('#eSave').click();
  await expect(page.locator('#editSheet')).toBeHidden();
  await expect(page.locator('#listM .mday').first()).toContainText('79.1');
  await page.locator('#toastAct').click();
  await expect(page.locator('#listM .mday').first()).toContainText('79.5');
  await page.locator('[data-list="w"]').click();
  // History: fix the newest weigh-in, then undo; delete it, then undo.
  await page.locator('#listW .row').first().click();
  await expect(page.locator('#eKg')).toHaveValue('80.2');
  await page.locator('#eKg').fill('80.4');
  await page.locator('#eSave').click();
  await expect(page.locator('#lastKg')).toHaveText('80.4');
  await page.locator('#toastAct').click();
  await expect(page.locator('#lastKg')).toHaveText('80.2');
  await page.locator('#listW .row').first().click();
  await page.locator('#eDelete').click();
  await expect(page.locator('#listW .row')).toHaveCount(15);
  await expect(page.locator('#toastMsg')).toHaveText('השקילה נמחקה.');
  await page.locator('#toastAct').click();
  await expect(page.locator('#listW .row')).toHaveCount(16);
  await expect(page.locator('#lastKg')).toHaveText('80.2');

  // Analytics screen: same numbers as the verdict, phase band, tables filled; back returns to the verdict.
  await page.locator('#anaBtn').click();
  await expect(page.locator('#anaView')).toBeVisible();
  await expect(page.locator('#main')).toBeHidden();
  await expect(page.locator('#aKg')).toHaveText(M + '0.33');
  await expect(page.locator('#aKgBox')).toHaveClass(/good/);
  await expect(page.locator('#aPct')).toContainText('%');
  await expect(page.locator('#aZone')).toContainText('טווח היעד לחיטוב');
  await expect(page.locator('#aChart svg .phase-a')).toHaveCount(1);
  await expect(page.locator('#aChart svg .phase-t')).toContainText('חיטוב');
  await expect(page.locator('#aBars svg .bar').first()).toBeVisible();
  await expect(page.locator('#aCirc tr')).toHaveCount(12);           // header + 11 sites
  await expect(page.locator('#aLow')).not.toHaveText('—');
  await expect(page.locator('#aProjLab')).not.toBeEmpty();
  await page.locator('[data-arange="all"]').click();
  await expect(page.locator('[data-arange="all"]')).toHaveAttribute('aria-pressed', 'true');
  await layoutOk('analytics');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('#toast').evaluate(e => { e.hidden = true; });
  await page.screenshot({ path: testInfo.outputPath('analytics-375.png'), fullPage: true });
  for (const id of ['aChart', 'aScale', 'aBars', 'aCirc']) await page.locator('#' + id).screenshot({ path: testInfo.outputPath(`ana-${id}.png`) });
  await page.setViewportSize({ width: 440, height: 956 });
  await page.screenshot({ path: testInfo.outputPath('analytics.png'), fullPage: true });
  await page.locator('#anaBack').click();
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.locator('#anaView')).toBeHidden();

  await layoutOk('verdict');
  await page.screenshot({ path: testInfo.outputPath('verdict.png'), fullPage: true });
  // Smaller iPhone (375pt): still no horizontal scroll, hero number fits.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => { const h = document.querySelector('.hero'); return h.scrollWidth <= h.clientWidth + 1; })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('verdict-375.png') });
  await page.setViewportSize({ width: 440, height: 956 });

  // Dark home: same numbers, lens with the last 4 weigh-ins, fits on both phone sizes.
  await page.locator('#mainBack').click();
  await expect(page.locator('#homeView')).toBeVisible();
  await expectCut();
  await expect(page.locator('#hRate')).toHaveText(M + '0.33');
  await expect(page.locator('#hWhen')).toContainText('10.10.2026');
  await expect(page.locator('#lensDots .ldot')).toHaveCount(4);
  await expect(page.locator('#lensDots .lavg')).toHaveCount(1);
  await page.locator('#toast').evaluate(e => { e.hidden = true; });
  await layoutOk('home');
  for (const [width, height] of [[375, 667], [375, 812], [440, 956]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    const fits = await page.evaluate(() => document.querySelector('#hAna').getBoundingClientRect().bottom <= innerHeight + 1);
    expect(fits, `home @${width}x${height}: ניתוח button below the fold`).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`home-${width}x${height}.png`) });
  }
  // "עוד" → phase opens the phase sheet; the lens opens the weigh-in form; back returns home.
  await page.locator('#hMore').click();
  await page.locator('[data-more="phase"]').click();
  await expect(page.locator('#phaseSheet')).toBeVisible();
  await page.locator('#phaseCancel').click();
  await page.locator('#lensBtn').click();
  await expect(page.locator('#checkinView')).toBeVisible();
  await page.locator('#ciCancelTop').click();
  await expect(page.locator('#homeView')).toBeVisible();
  await page.locator('#hAna').click();
  await expect(page.locator('#anaView')).toBeVisible();
  await page.locator('#anaBack').click();
  await expect(page.locator('#homeView')).toBeVisible();

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
