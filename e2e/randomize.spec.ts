import { expect, seedScenes, solidScene, test } from './fixtures';

const lookValues = (page: import('@playwright/test').Page) =>
  page.locator('#w-look input[type="range"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

// Resolution is a display setting (Settings → Display & performance), not part of the Look: rolling
// and drifting leave it at its 100% default.
async function expectResolutionUntouched(page: import('@playwright/test').Page) {
  await page.keyboard.press(',');
  await expect(page.locator('#pref-resolution')).toHaveValue('1');
  await page.keyboard.press('Escape');
}

test('randomize: rolls the look without changing scene unless the random-scene box is ticked; Shift+R goes back', async ({ page }) => {
  await seedScenes(page, [solidScene('Red Room', '1., 0., 0.'), solidScene('Blue Room', '0., 0., 1.')]);   // for the random scene to pick
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
  await page.locator('#auto').uncheck();   // auto-switch must not change the scene under the test
  await expect(page.locator('#random-scene')).not.toBeChecked();
  await expect(page.locator('#mood')).toHaveCount(0);   // mood always feeds Synesthesia: no toggle to flip
  await expect(page.locator('#w-look')).toContainText('energetic mood');

  const scene = await page.locator('#scene-name').textContent();
  const before = await lookValues(page);
  await page.locator('#randomize').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => lookValues(page)).not.toEqual(before);
  await expect(page.locator('#scene-name')).toHaveText(scene ?? '');

  // Shift+R goes back to the look before that roll.
  const rolled = await lookValues(page);
  await page.locator('#randomize').blur();
  await expectResolutionUntouched(page);
  await page.keyboard.press('Shift+R');
  await expect.poll(() => lookValues(page)).toEqual(before);
  expect(rolled).not.toEqual(before);

  await page.locator('#random-scene').check();
  await page.locator('#randomize').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#scene-name')).not.toHaveText(scene ?? '');
  await page.locator('#randomize').blur();
  await page.keyboard.press('Shift+R');   // …and back to the scene it left
  await expect(page.locator('#scene-name')).toHaveText(scene ?? '');
});

test('drift: the look sliders glide on their own while it is on, and stop when it is off', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
  await expect(page.locator('#driftSpeed')).toHaveCount(0);   // the speed slider only shows while drifting

  await page.locator('#drift').check();
  await expect(page.locator('#driftSpeed')).toBeVisible();
  await page.locator('#driftSpeed').fill('4');
  const start = await lookValues(page);
  await expect.poll(() => lookValues(page), { timeout: 10_000 }).not.toEqual(start);
  await expectResolutionUntouched(page);

  await page.locator('#drift').uncheck();
  const stopped = await lookValues(page);
  await page.waitForTimeout(1000);
  expect(await lookValues(page)).toEqual(stopped);
});
