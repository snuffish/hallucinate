import { expect, test, type Page } from './fixtures';
import { SCENE_INPUTS } from '../src/engine/scene-inputs';

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
  for (const plot of ['Signals', 'Spectrum', 'Tempo candidates']) await expect(monitor(page).getByRole('img', { name: plot })).toBeVisible();

  await page.keyboard.press('Shift+L');
  await expect(monitor(page)).toBeHidden();
});

test('hearing: it shows every scene input as the screen\'s scene gets it, the frames it hears and how late the ticks land', async ({ page }) => {
  test.slow();   // tempo detection is slow on a loaded runner
  await start(page);
  await page.keyboard.press('Shift+L');
  const inputs = monitor(page).locator('#hearing-inputs [data-input]');
  await expect(inputs).toHaveCount(SCENE_INPUTS.length);
  for (const { uniform } of SCENE_INPUTS) await expect(monitor(page).locator(`[data-input="${uniform}"]`)).toContainText(uniform);
  const time = monitor(page).locator('[data-input="uTime"] output');
  const before = Number(await time.textContent());
  await expect.poll(async () => Number(await time.textContent())).toBeGreaterThan(before);   // the music's clock runs
  await expect(page.locator('#hearing-fps')).toHaveText(/^hears \d+ fps/);
  await expect(page.locator('#hearing-tick-lag')).toHaveText(/^ticks \d+ ms (after|before) the kicks$/, { timeout: 60_000 });
});

test('hearing: on a short screen it stops above the player bar and scrolls', async ({ page }) => {
  await start(page);   // 1280×720
  await page.keyboard.press('Shift+L');
  await expect(monitor(page)).toBeVisible();
  const box = (await monitor(page).boundingBox())!;
  const bar = (await page.locator('#transport').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  await monitor(page).hover();
  await page.mouse.wheel(0, 2000);
  await expect(monitor(page).getByRole('img', { name: 'Tempo candidates' })).toBeInViewport();
});

test('hearing: the signals picked for its plot and how far back it looks are kept across a reload', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Shift+L');
  const chip = (id: string) => monitor(page).locator(`[data-signal="${id}"]`);
  await expect(chip('rise')).toHaveAttribute('aria-pressed', 'true');   // the Overview preset to start
  await expect(chip('uBeat')).toHaveAttribute('aria-pressed', 'false');
  await monitor(page).getByRole('button', { name: 'Kicks → scene' }).click();
  await expect(chip('uBeat')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('bass')).toHaveAttribute('aria-pressed', 'false');
  await chip('bass').click();
  await monitor(page).getByRole('button', { name: '20 s' }).click();

  await start(page);
  await page.keyboard.press('Shift+L');
  for (const id of ['rise', 'uBeat', 'uTick', 'bass']) await expect(chip(id)).toHaveAttribute('aria-pressed', 'true');
  await expect(monitor(page).getByRole('button', { name: '20 s' })).toHaveAttribute('aria-pressed', 'true');
  await chip('uTick').dblclick();   // only this one
  await expect(monitor(page).locator('.hearing-chip[aria-pressed="true"]')).toHaveCount(1);
});

test('hearing: hovering its plot reads the values then, and the what-if threshold only shows what it would let through', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Shift+L');
  const plot = monitor(page).getByRole('img', { name: 'Signals' });
  await expect(monitor(page).locator('[data-signal="bass"] output')).toBeVisible();   // a second of samples to read
  await plot.hover({ position: { x: (await plot.boundingBox())!.width - 10, y: 20 } });
  await expect(monitor(page).locator('.hearing-tip')).toContainText(/^−\d\.\d\d s/);
  await expect(monitor(page).locator('.hearing-tip')).toContainText('bass');
  await monitor(page).getByRole('slider', { name: 'What-if threshold' }).fill('0.5');
  await expect(monitor(page).locator('.hearing-whatif')).toContainText(/\d+ rise peaks would pass it/);
  await monitor(page).locator('.hearing-whatif').getByRole('button', { name: 'reset' }).click();
  await expect(monitor(page).locator('.hearing-whatif')).toContainText('Only shown');
});

test('hearing: drag it by any part but its controls; it opens there again after a reload, and a double-click puts it back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1200 });   // room below it to move into
  await start(page);
  await page.keyboard.press('Shift+L');
  const corner = (await monitor(page).boundingBox())!;
  const grab = (await page.locator('#hearing-latency').boundingBox())!;   // the body, not the top
  await page.mouse.move(grab.x + 10, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(grab.x + 110, grab.y + 100, { steps: 8 });
  await page.mouse.move(grab.x + 210, grab.y + 150, { steps: 8 });   // 200 px right: a 620 px monitor still fits 1280
  await page.mouse.up();
  await expect(monitor(page)).toHaveClass(/\bmoved\b/);
  const moved = (await monitor(page).boundingBox())!;
  expect(moved.x).toBeCloseTo(corner.x + 200, -1);
  expect(moved.y - corner.y).toBeGreaterThan(100);   // where it was let go, or as near as keeps it above the player bar

  await start(page);
  await page.keyboard.press('Shift+L');
  const again = (await monitor(page).boundingBox())!;
  expect(again.x).toBeCloseTo(moved.x, 0);
  expect(again.y).toBeCloseTo(moved.y, 0);

  await monitor(page).locator('[data-signal="bass"]').dblclick();   // a chip's double-click shows only it ...
  await expect(monitor(page)).toHaveClass(/\bmoved\b/);           // ... and leaves the monitor where it is
  await page.locator('#hearing-tempo').dblclick();
  await expect(monitor(page)).not.toHaveClass(/\bmoved\b/);
  const back = (await monitor(page).boundingBox())!;
  expect(back.x).toBeCloseTo(corner.x, 0);
  expect(back.y).toBeCloseTo(corner.y, 0);
});

test('hearing: its ? explains what the monitor shows', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Shift+L');
  await monitor(page).getByRole('button', { name: 'Help: Hearing monitor' }).click();
  const pop = page.locator('#help-pop');
  await expect(pop).toBeVisible();
  for (const words of ['Confidence', 'chip', 'What if', 'Tempo candidates', 'drag']) await expect(pop).toContainText(words);
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
