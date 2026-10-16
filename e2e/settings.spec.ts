import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from './fixtures';

async function openApp(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
}

const settings = (page: Page) => page.locator('#settings');
const storedPrefs = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('hallucinate.prefs') ?? 'null'));

test('opens from the comma key, the gear and the ☰ menu; Esc closes it', async ({ page }) => {
  await openApp(page);
  await expect(settings(page)).toBeHidden();

  await page.keyboard.press(',');
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  await page.locator('#settings-btn').click();
  await expect(settings(page)).toBeVisible();
  await page.locator('#settings-close').click();
  await expect(settings(page)).toBeHidden();

  await page.locator('#widgets-menu-btn').click();
  await page.locator('#open-settings').click();
  await expect(settings(page)).toBeVisible();
  await expect(page.locator('#widgets-menu')).toBeHidden();

  // One overlay at a time: the library replaces it.
  await page.keyboard.press('Escape');
  await page.keyboard.press(',');
  await page.keyboard.press('l');
  await expect(page.locator('#library')).toBeVisible();
  await expect(settings(page)).toBeHidden();
});

test('changes are kept across a reload and left out of the export', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press(',');
  await page.locator('#settings-tab-interface').click();
  await page.locator('#pref-idle').selectOption('never');
  await page.locator('#pref-kbd').uncheck();
  await expect(page.locator('body')).toHaveAttribute('data-kbd', 'off');
  await expect(page.locator('#settings-btn .kbd')).toBeHidden();

  await expect.poll(() => storedPrefs(page)).toMatchObject({ v: 1, idleHideSeconds: null, showKeyBadges: false });
  await page.reload();
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-kbd', 'off');
  await page.keyboard.press(',');
  await page.locator('#settings-tab-interface').click();
  await expect(page.locator('#pref-idle')).toHaveValue('never');
  await expect(page.locator('#pref-kbd')).not.toBeChecked();

  // The shortcut sheet still lists every key.
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await expect(page.locator('.help-keys .kbd').first()).toBeVisible();
  await page.keyboard.press('Escape');

  const download = page.waitForEvent('download');
  await page.locator('#widgets-menu-btn').click();
  await page.locator('#export-settings').click();
  const json = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(Object.keys(json.data)).not.toContain('prefs');
  expect(JSON.stringify(json)).not.toContain('idleHideSeconds');
});

test('two tabs stay in step: a change in one is not undone by the other', async ({ page, context }) => {
  await openApp(page);
  const other = await context.newPage();
  await openApp(other);

  await page.keyboard.press(',');
  await page.locator('#settings-tab-interface').click();
  await page.locator('#pref-idle').selectOption('10');

  await other.keyboard.press(',');
  await other.locator('#settings-tab-interface').click();
  await expect(other.locator('#pref-idle')).toHaveValue('10');
  await other.locator('#pref-kbd').uncheck();
  await other.close();   // flushes its writer on pagehide

  await expect.poll(() => storedPrefs(page)).toMatchObject({ idleHideSeconds: 10, showKeyBadges: false });
  await expect(page.locator('#pref-kbd')).not.toBeChecked();
});

test.describe('on a 2× screen', () => {
  test.use({ deviceScaleFactor: 2 });

  test('pixel density caps what the main canvas renders', async ({ page }) => {
    await openApp(page);
    const ratio = () => page.locator('#gl').evaluate((c: HTMLCanvasElement) => c.width / c.clientWidth);
    await expect.poll(ratio).toBeCloseTo(2, 1);

    await page.keyboard.press(',');
    await page.locator('#pref-pixel-ratio').selectOption('1');
    await expect.poll(ratio).toBeCloseTo(1, 1);
    await page.locator('#pref-pixel-ratio').selectOption('1.5');
    await expect.poll(ratio).toBeCloseTo(1.5, 1);
  });
});

test('start resolution seeds the Look slider at the next start', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press(',');
  await page.locator('#pref-start-resolution').fill('0.5');
  await expect(page.locator('#resolution')).toHaveValue('0.75');   // the live slider isn't touched now
  await expect.poll(() => storedPrefs(page)).toMatchObject({ startResolution: 0.5 });
  await page.reload();
  await expect(page.locator('#resolution')).toHaveValue('0.5');
});
