import { expect, test, type Page } from './fixtures';
import { EFFECTS, strongest } from '../src/engine/effects';
import type { ProfilerApi } from '../src/engine/profiler';
import { DEFAULT_PREFS } from '../src/state/prefs';

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

// An effect's cost lands on every output and projector: the profiler times the frame with and without it
// at the resolution the screen renders at, the default one here. Software WebGL makes the numbers
// anything; what matters is that it reports both and a Glow's blur costs something. A small canvas and
// few frames keep it to seconds under software WebGL (PERF.md has the GPU numbers, from perf/measure.mjs).
test('perf: the profiler reports what a Glow costs per frame at the default resolution, against no effects', async ({ page }) => {
  await start(page, '/?perf');
  const cost = await page.evaluate((effects) => (window as unknown as { __profiler: ProfilerApi }).__profiler.effectsCost(effects, { size: [480, 270], frames: 4, rounds: 3 }), strongest('glow'));
  console.log(`Glow at its strongest: ${cost.with.toFixed(2)} ms a frame against ${cost.none.toFixed(2)} ms without effects (+${cost.extra.toFixed(2)} ms) at ${cost.size.join('×')}, resolution ${cost.scale}`);
  expect(cost.scale).toBe(DEFAULT_PREFS.resolution);
  expect(cost.size).toEqual([480, 270].map((x) => Math.round(x * cost.scale)));
  expect(cost.none).toBeGreaterThan(0);
  expect(cost.with).toBeGreaterThan(cost.none);
  expect(cost.extra).toBeCloseTo(cost.with - cost.none, 6);
});

// Every effect stacked, each at its strongest: what a show scene that uses them all costs per frame,
// against none, at the default resolution. Kept to seconds under software WebGL the same way.
test('perf: the profiler reports what all the effects stacked cost per frame at the default resolution, against none', async ({ page }) => {
  await start(page, '/?perf');
  const all = EFFECTS.flatMap((e) => strongest(e.id));
  const cost = await page.evaluate((effects) => (window as unknown as { __profiler: ProfilerApi }).__profiler.effectsCost(effects, { size: [480, 270], frames: 4, rounds: 3 }), all);
  console.log(`All ${all.length} effects at their strongest: ${cost.with.toFixed(2)} ms a frame against ${cost.none.toFixed(2)} ms without effects (+${cost.extra.toFixed(2)} ms) at ${cost.size.join('×')}, resolution ${cost.scale}`);
  expect(cost.scale).toBe(DEFAULT_PREFS.resolution);
  expect(cost.size).toEqual([480, 270].map((x) => Math.round(x * cost.scale)));
  expect(cost.none).toBeGreaterThan(0);
  expect(cost.with).toBeGreaterThan(cost.none);
  expect(cost.extra).toBeCloseTo(cost.with - cost.none, 6);
});
