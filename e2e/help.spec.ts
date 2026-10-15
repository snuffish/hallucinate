import { expect, test, type Page } from './fixtures';

const pop = (page: Page) => page.locator('#help-pop');
const openPopovers = (page: Page) => page.locator(':popover-open');

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
}

test('help: ? opens the shortcut sheet, Esc closes it, the first start hints at it', async ({ page }) => {
  await start(page);
  await expect(page.locator('#toast')).toContainText('Press ? for help');

  await page.keyboard.press('?');
  await expect(pop(page)).toBeVisible();
  await expect(pop(page)).toContainText('Help & shortcuts');
  await expect(pop(page).locator('h3', { hasText: 'Playback' })).toBeVisible();
  await expect(pop(page)).toContainText('Play / pause');
  await page.keyboard.press('Escape');
  await expect(openPopovers(page)).toHaveCount(0);

  // The hint shows once per browser.
  await page.reload();
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
  await expect(page.locator('#toast')).not.toContainText('Press ? for help');
});

test('help: a panel ? opens its topic and closes with the panel (H)', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Help: Sound sources' }).click();
  await expect(pop(page)).toBeVisible();
  await expect(pop(page)).toContainText('Tab / system audio');
  await expect(page.getByRole('button', { name: 'Help: Sound sources' })).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('h');
  await expect(page.locator('#widgets')).toHaveClass(/collapsed/);
  await expect(openPopovers(page)).toHaveCount(0);
});

test('help: switching overlays closes help; Esc closes only help', async ({ page }) => {
  await start(page);
  await page.keyboard.press('l');
  await expect(page.locator('#library')).toBeVisible();
  await page.getByRole('button', { name: 'Help: Scene library' }).click();
  await expect(pop(page)).toContainText('Scene library');

  await page.keyboard.press('e');   // the editor replaces the library
  await expect(page.locator('#editor')).toBeVisible();
  await expect(openPopovers(page)).toHaveCount(0);

  await page.locator('#ed-code').blur();   // the editor focuses its code; a key typed there is code, not a shortcut
  await page.keyboard.press('l');
  await expect(page.locator('#library')).toBeVisible();
  await page.getByRole('button', { name: 'Help: Scene library' }).click();
  await expect(pop(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(openPopovers(page)).toHaveCount(0);
  await expect(page.locator('#library')).toBeVisible();
});

test('help: a click outside closes it', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Help: The look' }).click();
  await expect(pop(page)).toBeVisible();
  await page.mouse.click(900, 600);
  await expect(openPopovers(page)).toHaveCount(0);
});
