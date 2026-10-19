import { expect, test, type Page } from './fixtures';

const monitor = (page: Page) => page.locator('#hearing');

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
}

// Which tempo is heard is the Listener's tests' business: a loaded runner at a low frame rate misses kicks,
// and the monitor then shows exactly that. Here: that it shows a tempo, a state and the delay at all.
test('hearing: Shift+L shows the demo beat\'s tempo and how it is heard, with the delay to the speakers, and hides it again', async ({ page }) => {
  test.slow();   // tempo detection is slow on a loaded runner
  await start(page);
  await expect(monitor(page)).toBeHidden();
  await page.keyboard.press('Shift+L');
  await expect(monitor(page)).toBeVisible();
  await expect(page.locator('#hearing-tempo')).toHaveText(/^\d+\.\d BPM/, { timeout: 60_000 });
  await expect(page.locator('#hearing-state')).toHaveText(/^(hearing kicks|holding)$/);
  await expect(page.locator('#hearing-latency')).toHaveText(/^\d+ ms to the speakers$/);
  for (const plot of ['Spectrum', 'Kick signal', 'Tempo candidates']) await expect(monitor(page).getByRole('img', { name: plot })).toBeVisible();

  await page.keyboard.press('Shift+L');
  await expect(monitor(page)).toBeHidden();
});

test('hearing: the Hearing monitor and the performance monitor open together, one above the other', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Shift+P');
  await page.keyboard.press('Shift+L');
  await expect(page.locator('#perf')).toBeVisible();
  await expect(monitor(page)).toBeVisible();
  const perf = (await page.locator('#perf').boundingBox())!;
  const hearing = (await monitor(page).boundingBox())!;
  expect(hearing.y).toBeGreaterThanOrEqual(perf.y + perf.height);
});

test('hearing: the shortcut sheet lists it, and it and the player call [ and ] the playback speed, not the tempo', async ({ page }) => {
  await start(page);
  await expect(page.locator('#tp-rate-val')).toHaveAttribute('title', /^Playback speed: 124 BPM/);
  await page.locator('#tp-rate-val').click();
  await expect(page.getByRole('slider', { name: 'Playback speed' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  const sheet = page.locator('#help-pop');
  await expect(sheet).toContainText('Hearing monitor');
  await expect(sheet).toContainText('Playback speed −5 %');
  await expect(sheet).not.toContainText('Tempo −5 %');
});
