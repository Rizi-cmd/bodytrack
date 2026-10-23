// Weight page ("המסע", docs/specs/weight-page.md §10): one screen check per state, in WebKit at iPhone sizes.
// The clock is fixed so "today" relative to the invented fixture (last weigh-in 10.10.2026) never drifts.
import { test, expect } from '@playwright/test';
import { startServer, FIXTURE } from './server.js';

let server, origin;
test.beforeAll(async () => { server = await startServer(); origin = `http://127.0.0.1:${server.address().port}`; });
test.afterAll(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));

const M = '−';
async function open(page, when = '2026-10-12T08:42:00') {
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await page.clock.setFixedTime(new Date(when));
  await page.goto(origin + '/');
  await expect(page.locator('#homeView')).toBeVisible();
  return problems;
}
async function seed(page) {
  await page.locator('#hMore').click();
  await page.locator('[data-more="backup"]').click();
  await page.locator('#importFile').setInputFiles(FIXTURE);
  await page.locator('#impMerge').click();
  await expect(page.locator('#toastMsg')).toContainText('שוחזרו');
  await page.locator('#mainBack').click();
  await page.locator('#toast').evaluate(e => { e.hidden = true; });
}
async function phase(page, which, target = '') {
  await page.locator('#wtPhase').click();
  await page.locator(`[data-phase="${which}"]`).click();
  await page.locator('#targetKg').fill(target);
  await page.locator('#phaseSave').click();
  await expect(page.locator('#phaseSheet')).toBeHidden();
}
// layout gates shared by every state: no sideways scroll, no text under 12px, "+ שקילה" on screen
async function gates(page, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal scroll`).toBe(true);
  const small = await page.evaluate(() => [...document.querySelectorAll('#wtView *')]
    .filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 12)
    .map(e => e.textContent.trim().slice(0, 20)));
  expect(small, `${name}: text under 12px`).toEqual([]);
}
// every shot: no toast over the page, and when the figure is shown the canvas really has a drawing on it
async function shot(page, name) {
  await page.locator('#toast').evaluate(e => { e.hidden = true; });
  if (await page.locator('#wtChart').isVisible()) await expect.poll(() => page.locator('#wtChart').evaluate(c => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  }), `${name}: empty chart`).toBeGreaterThan(500);
  await page.screenshot({ path: test.info().outputPath(`weight-${name}.png`), scale: 'css' });
}

test('weight page: every state', async ({ page }) => {
  const problems = await open(page);
  // #1 empty: no figure, the phase row and "+ שקילה" stay.
  await page.locator('#lensBtn').click();
  await expect(page.locator('#wtView')).toBeVisible();
  await expect(page.locator('#wtEmpty')).toBeVisible();
  await expect(page.locator('#wtBody')).toBeHidden();
  await expect(page.locator('#wtPhaseText')).toHaveText('לא נבחר שלב · בחירת שלב');
  await expect(page.locator('#wtAdd')).toBeVisible();
  await expect(page.locator('#wtDate')).toHaveText('יום שני, 12 באוקטובר');
  await expect(page.locator('#wtTime')).toHaveText('08:42');
  await gates(page, 'empty'); await shot(page, 'empty');
  await page.locator('#wtBack').click();

  // #7 no phase: journey from the first weigh-in.
  await seed(page);
  await page.locator('#lensBtn').click();
  await expect(page.locator('#wtHeroK')).toHaveText('ממוצע 4 השקילות האחרונות');
  await expect(page.locator('#wtKg')).toHaveText('80.6');
  await expect(page.locator('#wtFigCap')).toHaveText('מהשקילה הראשונה');
  await expect(page.locator('#wtGrid > div')).toHaveCount(3);
  await expect(page.locator('#wtGrid b').first()).toHaveText(M + '0.33');
  await expect(page.locator('#wtRows')).toContainText('80.2 · 10.10');
  await expect(page.locator('#wtChart')).toHaveAttribute('aria-label', /גרף המסע/);
  for (const id of ['wtBack', 'wtPhase', 'wtAdd']) expect((await page.locator('#' + id).boundingBox()).height, `#${id} tap size`).toBeGreaterThanOrEqual(44);
  await gates(page, 'no phase'); await shot(page, 'nophase');

  // #4 cut with a target: projection row, footnote, phase row with the target.
  await phase(page, 'cut', '78.5');
  await expect(page.locator('#wtPhaseText')).toContainText('שלב: חיטוב · מ-');
  await expect(page.locator('#wtPhaseText')).toContainText('יעד 78.5');
  await expect(page.locator('#wtFigCap')).toHaveText('מתחילת השלב עד היעד');
  await expect(page.locator('#wtKey')).toHaveText('נקודה = ממוצע שבועי · ○ תחילת השלב · ┄ צפי');
  await expect(page.locator('#wtRows .r').first()).toContainText('צפי');
  await expect(page.locator('#wtRows .r').first()).toContainText('שבועות');
  await expect(page.locator('#wtCap')).toHaveText('הערכה, אם הקצב יישאר כמו עכשיו');
  await expect(page.locator('#wtGrid > div').nth(1)).toContainText('יעד 0.5–1%');
  await expect(page.locator('#wtGrid b').nth(2)).toHaveText('2.1');
  for (const [w, h] of [[440, 956], [375, 812], [375, 667]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    await gates(page, `cut ${w}x${h}`);
    const add = await page.locator('#wtAdd').boundingBox();
    expect(add.y + add.height, `cut ${w}x${h}: + שקילה off screen`).toBeLessThanOrEqual(h + 1);
    await shot(page, `cut-${w}x${h}`);
  }
  await page.setViewportSize({ width: 440, height: 956 });
  // the line is live while the page is shown, and stops when it is left
  await expect.poll(() => page.locator('#wtChart').getAttribute('data-motion')).toBe('running');

  // "+ שקילה" → weigh-in → save → back on the weight page, the new weigh-in counted.
  await page.locator('#wtAdd').click();
  await expect(page.locator('#checkinView')).toBeVisible();
  await page.locator('#ciKg').fill('79.6');
  await page.locator('#ciSave').click();
  await expect(page.locator('#wtView')).toBeVisible();
  await expect(page.locator('#wtRows')).toContainText('79.6 · 12.10');
  await page.locator('#toastAct').click();                               // undo
  await expect(page.locator('#wtRows')).toContainText('80.2 · 10.10');

  // #8 no target; #6 maintenance.
  await phase(page, 'cut', '');
  await expect(page.locator('#wtGrid > div').nth(2)).toContainText('אין יעד');
  await expect(page.locator('#wtPhaseText')).toContainText('הגדרת יעד');
  await expect(page.locator('#wtCap')).toBeHidden();
  await shot(page, 'notarget');
  await phase(page, 'maintenance', '');
  await expect(page.locator('#wtGrid > div').nth(2)).toContainText('בתחזוקה אין יעד');
  await expect(page.locator('#wtPhaseText')).not.toContainText('יעד');
  await shot(page, 'maintenance');
  // #14 reached: cut with a target above the trend.
  await phase(page, 'cut', '82');
  await expect(page.locator('#wtGrid b').nth(2)).toHaveText('הושג');
  await expect(page.locator('#wtPhaseText')).toHaveText('הגעת ליעד · שינוי שלב');
  await shot(page, 'reached');
  await page.locator('#wtBack').click();
  await expect(page.locator('#homeView')).toBeVisible();
  await expect.poll(() => page.locator('#wtChart').getAttribute('data-motion')).not.toBe('running');
  expect(problems).toEqual([]);
});

test('weight page: last weigh-in over 10 days old', async ({ page }) => {
  const problems = await open(page, '2026-10-23T08:42:00');
  await seed(page);
  await page.locator('#lensBtn').click();
  await phase(page, 'cut', '78.5');
  await expect(page.locator('#wtRows .r').first()).toContainText('השקילה האחרונה ישנה מדי לצפי');
  await expect(page.locator('#wtRows')).toContainText('לפני 13 ימים');
  await expect(page.locator('#wtCap')).toBeHidden();
  await gates(page, 'stale'); await shot(page, 'stale');
  expect(problems).toEqual([]);
});

test('weight page: data cannot be read → error with retry', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { IDBObjectStore.prototype.getAll = () => { throw new Error('test: read fails'); }; });
  await page.locator('#lensBtn').click();
  await expect(page.locator('#wtErr')).toBeVisible();
  await expect(page.locator('#wtAdd')).toBeHidden();
  await gates(page, 'error'); await shot(page, 'error');
});

test('weight page under Reduce Motion: one still frame', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'he-IL' });
  const page = await ctx.newPage();
  await open(page);
  await seed(page);
  await page.locator('#lensBtn').click();
  await expect.poll(() => page.locator('#wtChart').getAttribute('data-motion')).toBe('still');
  await ctx.close();
});

test('weight page: long press shows the real weigh-in nearest the finger, lifting hides it', async ({ page }) => {
  const problems = await open(page);
  await seed(page);
  await page.locator('#lensBtn').click();
  await page.waitForTimeout(800);
  const b = await page.locator('#wtChart').boundingBox();
  // a short tap shows nothing
  await page.mouse.move(b.x + b.width * .5, b.y + b.height * .5); await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
  await expect(page.locator('#wtRead')).not.toHaveClass(/on/);
  // held: the box shows a date, a weight and the average; it follows the finger to the newest weigh-in
  await page.mouse.down(); await page.waitForTimeout(500);
  await expect(page.locator('#wtRead')).toHaveClass(/on/);
  await expect(page.locator('#wtRead')).toContainText('ק״ג');
  await page.mouse.move(b.x + b.width - 14, b.y + b.height * .5, { steps: 6 });
  await expect(page.locator('#wtRead')).toContainText('10.10.2026');
  await expect(page.locator('#wtRead b')).toHaveText('80.2 ק״ג');
  await expect(page.locator('#wtRead')).toContainText('ממוצע 4 שקילות 80.6');
  const box = await page.locator('#wtRead').boundingBox();
  expect(box.x, 'box inside the chart').toBeGreaterThanOrEqual(b.x); expect(box.x + box.width).toBeLessThanOrEqual(b.x + b.width);
  expect(box.x + box.width, 'finger on the right: box on the left of it').toBeLessThan(b.x + b.width - 14);
  await gates(page, 'readout'); await shot(page, 'readout');
  await page.mouse.up();
  await expect(page.locator('#wtRead')).not.toHaveClass(/on/);
  expect(problems).toEqual([]);
});
