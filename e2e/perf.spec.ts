import { expect, test, type Page } from './fixtures';

const overlay = (page: Page) => page.locator('#perf');

async function start(page: Page, url = '/') {
  await page.goto(url);
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
}

const report = (page: Page) => page.evaluate(() => (window as { __profiler?: { report(): { scale: number; size: number[] } | null } }).__profiler?.report() ?? null);

test('perf: Shift+P shows where the frame time goes, and hides it again', async ({ page }) => {
  await start(page);
  await expect(overlay(page)).toBeHidden();
  await page.keyboard.press('Shift+P');
  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page)).toContainText('fps');
  for (const stage of ['Audio analysis', 'Draw calls', 'Studio & Preview', 'React & microtasks']) await expect(overlay(page)).toContainText(stage);
  await expect(overlay(page).locator('.perf-verdict')).not.toHaveAttribute('data-kind', 'warming-up', { timeout: 15_000 });
  // P collapses the parameters; Shift+P must not.
  await expect(page.locator('.widget-params')).not.toHaveClass(/collapsed/);

  await page.keyboard.press('Shift+P');
  await expect(overlay(page)).toBeHidden();
  expect(await report(page)).toBeNull();
});

test('perf: ?perf starts with it on and offers window.__profiler', async ({ page }) => {
  await start(page, '/?perf');
  await expect(overlay(page)).toBeVisible();
  const r = await report(page);
  expect(r?.size[0]).toBeGreaterThan(0);
});

test('perf: Test GPU measures at half resolution and puts the resolution back', async ({ page }) => {
  await start(page, '/?perf');
  await expect(overlay(page)).toBeVisible();
  const before = await report(page);
  await overlay(page).getByRole('button', { name: 'Test GPU' }).click();
  await expect(overlay(page).getByRole('button', { name: 'Testing GPU…' })).toBeDisabled();
  // Software rendering makes the gain anything; what matters is that it finishes and restores.
  await expect(page.locator('#perf-fill-result')).toContainText('fps at half resolution', { timeout: 30_000 });
  await expect(overlay(page).getByRole('button', { name: 'Test GPU' })).toBeEnabled();
  expect((await report(page))?.scale).toBe(before?.scale);
});
