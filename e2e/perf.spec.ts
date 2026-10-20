import { expect, startDemo, test, type Page } from './fixtures';
import { EFFECTS, strongest, type EffectStack } from '../src/engine/effects';
import type { ProfilerApi } from '../src/engine/profiler';
import { DEFAULT_PREFS } from '../src/state/prefs';

const overlay = (page: Page) => page.locator('#perf');

const report = (page: Page) => page.evaluate(() => (window as { __profiler?: { report(): { scale: number; size: number[] } | null } }).__profiler?.report() ?? null);

test('perf: Shift+P shows where the frame time goes, and hides it again', async ({ page }) => {
  await startDemo(page);
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

test('perf: its ? explains the verdict, the stages and Test GPU', async ({ page }) => {
  await startDemo(page);
  await page.keyboard.press('Shift+P');
  await overlay(page).getByRole('button', { name: 'Help: Performance monitor' }).click();
  const pop = page.locator('#help-pop');
  await expect(pop).toBeVisible();
  for (const words of ['budget', 'Draw calls', 'Test GPU', 'Resolution']) await expect(pop).toContainText(words);
});

test('perf: ?perf starts with it on and offers window.__profiler', async ({ page }) => {
  await startDemo(page, '/?perf');
  await expect(overlay(page)).toBeVisible();
  const r = await report(page);
  expect(r?.size[0]).toBeGreaterThan(0);
});

test('perf: Test GPU measures at half resolution and puts the resolution back', async ({ page }) => {
  await startDemo(page, '/?perf');
  await expect(overlay(page)).toBeVisible();
  const before = await report(page);
  await overlay(page).getByRole('button', { name: 'Test GPU' }).click();
  await expect(overlay(page).getByRole('button', { name: 'Testing GPU…' })).toBeDisabled();
  // Software rendering makes the gain anything; what matters is that it finishes and restores.
  await expect(page.locator('#perf-fill-result')).toContainText('fps at half resolution', { timeout: 30_000 });
  await expect(overlay(page).getByRole('button', { name: 'Test GPU' })).toBeEnabled();
  expect((await report(page))?.scale).toBe(before?.scale);
});

// An effect's cost lands on every output and projector: the profiler times the frame with and without
// `effects` at the resolution the screen renders at, the default one here. Software WebGL makes the
// numbers anything; what matters is that it reports both and the effects cost something. A small canvas
// and few frames keep it to seconds under software WebGL (PERF.md has the GPU numbers, from
// perf/measure.mjs).
async function reportsCost(page: Page, what: string, effects: EffectStack) {
  await startDemo(page, '/?perf');
  const cost = await page.evaluate((effects) => (window as unknown as { __profiler: ProfilerApi }).__profiler.effectsCost(effects, { size: [480, 270], frames: 4, rounds: 3 }), effects);
  console.log(`${what}: ${cost.with.toFixed(2)} ms a frame against ${cost.none.toFixed(2)} ms without effects (+${cost.extra.toFixed(2)} ms) at ${cost.size.join('×')}, resolution ${cost.scale}`);
  expect(cost.scale).toBe(DEFAULT_PREFS.resolution);
  expect(cost.size).toEqual([480, 270].map((x) => Math.round(x * cost.scale)));
  expect(cost.none).toBeGreaterThan(0);
  expect(cost.with).toBeGreaterThan(cost.none);
  expect(cost.extra).toBeCloseTo(cost.with - cost.none, 6);
}

test('perf: the profiler reports what a Glow costs per frame at the default resolution, against no effects', async ({ page }) => {
  await reportsCost(page, 'Glow at its strongest', strongest('glow'));
});

// Every effect stacked, each at its strongest: what a show scene that uses them all costs.
test('perf: the profiler reports what all the effects stacked cost per frame at the default resolution, against none', async ({ page }) => {
  await reportsCost(page, `All ${EFFECTS.length} effects at their strongest`, EFFECTS.flatMap((e) => strongest(e.id)));
});

test('perf: drag it by any part but its buttons, resize it by its corner; both are kept after a reload, and a double-click puts it back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await startDemo(page);
  await page.keyboard.press('Shift+P');
  await expect(overlay(page)).toBeVisible();
  const corner = (await overlay(page).boundingBox())!;
  const grab = (await overlay(page).locator('.perf-meta').boundingBox())!;
  await page.mouse.move(grab.x + 10, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(grab.x + 210, grab.y + 160, { steps: 12 });
  await page.mouse.up();
  await expect(overlay(page)).toHaveClass(/\bmoved\b/);
  const moved = (await overlay(page).boundingBox())!;
  expect(moved.x).toBeCloseTo(corner.x + 200, -1);
  expect(moved.y).toBeCloseTo(corner.y + 160, -1);

  const grip = (await overlay(page).locator('.grip.corner').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 80, grip.y + grip.height / 2 + 60, { steps: 10 });
  await page.mouse.up();
  await expect(overlay(page)).toHaveClass(/\bsized\b/);
  await expect.poll(async () => Math.round((await overlay(page).boundingBox())!.width - moved.width)).toBe(80);
  const sized = (await overlay(page).boundingBox())!;

  await startDemo(page);
  await page.keyboard.press('Shift+P');
  const again = (await overlay(page).boundingBox())!;
  expect(again.x).toBeCloseTo(sized.x, 0);
  expect(again.y).toBeCloseTo(sized.y, 0);
  expect(again.width).toBeCloseTo(sized.width, 0);
  expect(again.height).toBeCloseTo(sized.height, 0);

  await overlay(page).locator('.perf-meta').dblclick();
  await expect(overlay(page)).not.toHaveClass(/\bmoved\b/);
  await expect(overlay(page)).not.toHaveClass(/\bsized\b/);
  const back = (await overlay(page).boundingBox())!;
  expect(back.x).toBeCloseTo(corner.x, 0);
  expect(back.width).toBeCloseTo(corner.width, 0);
});
