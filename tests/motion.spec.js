// Motion on the dark home (redesign stage 1 §5): galaxy runs only on the home and while visible,
// a still frame under Reduce Motion, hero moment after a save (instant under Reduce Motion).
import { test, expect } from '@playwright/test';
import { startServer, FIXTURE } from './server.js';

let server, origin;
test.beforeAll(async () => { server = await startServer(); origin = `http://127.0.0.1:${server.address().port}`; });
test.afterAll(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));

const M = '−';
async function seed(page) {
  await page.goto(origin + '/');
  await page.locator('#importFile').setInputFiles(FIXTURE);
  await page.locator('#impMerge').click();
  await expect(page.locator('#toastMsg')).toContainText('שוחזרו');
  if (await page.locator('#mainBack').isVisible()) await page.locator('#mainBack').click();
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#hRate')).toHaveText(M + '0.33');
}
async function save(page, kg) {
  await page.locator('#lensBtn').click();
  await page.locator('#ciKg').fill(kg);
  await page.locator('#ciSave').click();
}
const gl = page => page.evaluate(() => document.documentElement.classList.contains('gl'));
const galaxy = page => page.evaluate(() => document.documentElement.dataset.galaxy);

test('galaxy: runs on the home and the weight screen only, stops when hidden; hero moment plays after a save', async ({ page }) => {
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await seed(page);
  if (await gl(page)) {
    await expect.poll(() => galaxy(page)).toBe('running');
    await page.locator('#hAna').click();
    await expect.poll(() => galaxy(page)).toBe('off');                 // not on other screens
    await page.locator('#anaBack').click();
    await expect.poll(() => galaxy(page)).toBe('running');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => galaxy(page)).toBe('still');               // app hidden: no more frames
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => galaxy(page)).toBe('running');
    await page.locator('#lensBtn').click();
    await expect.poll(() => galaxy(page)).toBe('running');             // weight screen: around the weight
    await page.locator('#ciCircBtn').click();
    await expect.poll(() => galaxy(page)).toBe('off');                 // not behind the circumference list
    await page.locator('#ciCircBack').click();
    await expect.poll(() => galaxy(page)).toBe('running');
    await page.locator('#ciCancelTop').click();
  } else {
    test.info().annotations.push({ type: 'note', description: 'no WebGL2 in this browser: static fallback checked' });
    expect(await page.locator('#gal').isVisible()).toBe(false);        // fallback = CSS gradient on .home
  }
  // Hero: mid-way the oldest point is still leaving while the new one arrives (5 dots), then 4.
  await save(page, '79.0');
  await expect(page.locator('#homeView')).toBeVisible();
  await expect.poll(() => page.locator('#lensDots .ldot').count(), { intervals: [50] }).toBe(5);
  await expect(page.locator('#lensDots .ldot')).toHaveCount(4, { timeout: 3000 });
  await expect(page.locator('#hRate')).not.toHaveText(M + '0.33');
  expect(problems).toEqual([]);
});

test('Reduce Motion: still galaxy, hero is instant', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'he-IL' });
  const page = await ctx.newPage();
  await seed(page);
  if (await gl(page)) await expect.poll(() => galaxy(page)).toBe('still');
  const rate = await page.locator('#hRate').textContent();
  await save(page, '79.0');
  await expect(page.locator('#homeView')).toBeVisible();
  // straight to the end state: 4 dots, final rate, no 5th dot ever drawn
  const seen = await page.evaluate(() => new Promise(res => {
    let max = 0; const t0 = performance.now();
    const f = () => { max = Math.max(max, document.querySelectorAll('#lensDots .ldot').length); performance.now() - t0 < 600 ? requestAnimationFrame(f) : res(max); };
    f();
  }));
  expect(seen).toBe(4);
  expect(await page.locator('#hRate').textContent()).not.toBe(rate);
  await ctx.close();
});
