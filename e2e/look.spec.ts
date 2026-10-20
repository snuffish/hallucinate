import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// The Look widget's controls beyond the plain sliders: typed values and reset, locks, the XY pads, fine
// tuning, and the Look kept across a reload.

const look = (page: Page) => page.locator('#w-look');
// The widgets show once the app has started: start it with the demo beat.
async function open(page: Page) {
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
  await page.locator('#auto').uncheck();   // the scene stays put under the test
}
const value = (page: Page, id: string) => page.locator(`#${id}`).inputValue().then(Number);
const field = (page: Page, label: string) => look(page).getByLabel(`${label} value`, { exact: true });

async function type(page: Page, label: string, text: string) {
  const f = field(page, label);
  await f.click();
  await f.fill(text);
  await f.press('Enter');
}

async function roll(page: Page) {
  await page.locator('#randomize').focus();
  await page.keyboard.press('Enter');
  await page.locator('#randomize').blur();
}

// A drag of `dx` px, `dy` px from a point, with Shift held when `fine`.
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, fine = false) {
  if (fine) await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
  if (fine) await page.keyboard.up('Shift');
}

const centre = async (l: Locator) => { const b = (await l.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

test('each slider shows its value, takes a typed one, and goes back on a double-click', async ({ page }) => {
  await page.goto('/');
  await open(page);
  await expect(field(page, 'Reactivity')).toHaveValue('100');
  await expect(field(page, 'Colour')).toHaveValue('0');

  await type(page, 'Reactivity', '50');
  expect(await value(page, 'reactivity')).toBe(0.5);
  await type(page, 'Colour', '90');   // degrees round the wheel
  expect(await value(page, 'hue')).toBe(0.25);
  await type(page, 'Fringing', '0,5');   // a decimal comma works too
  expect(await value(page, 'aberration')).toBe(0.005);
  await type(page, 'Trails', '500');   // clamped to the range
  expect(await value(page, 'trails')).toBe(0.97);

  const f = field(page, 'Reactivity');
  await f.click();
  await f.fill('70');
  await f.press('Escape');   // cancels
  expect(await value(page, 'reactivity')).toBe(0.5);
  await expect(f).toHaveValue('50');

  await page.locator('#reactivity').dblclick();
  expect(await value(page, 'reactivity')).toBe(1);
  await expect(look(page).locator('label[for="synesthesia"]')).toHaveAttribute('title', /energetic mood/);
});

test('a locked slider holds through Randomize, Shift+R and Drift while the others move', async ({ page }) => {
  await page.goto('/');
  await open(page);
  await type(page, 'Colour', '120');
  const lock = look(page).getByRole('button', { name: 'Lock Colour', exact: true });
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await look(page).getByRole('button', { name: 'Lock Trails', exact: true }).click();

  const reactivity = new Set<number>();
  for (let i = 0; i < 6; i++) {
    await roll(page);
    expect(await value(page, 'hue')).toBeCloseTo(1 / 3, 3);
    expect(await value(page, 'trails')).toBe(0.35);
    reactivity.add(await value(page, 'reactivity'));
  }
  expect(reactivity.size).toBeGreaterThan(1);   // the unlocked ones rolled
  await page.keyboard.press('Shift+R');
  expect(await value(page, 'hue')).toBeCloseTo(1 / 3, 3);

  await page.locator('#drift').check();
  await page.locator('#driftSpeed').fill('4');
  const speed = await value(page, 'speed');
  await expect.poll(() => value(page, 'speed'), { timeout: 10_000 }).not.toBe(speed);
  expect(await value(page, 'hue')).toBeCloseTo(1 / 3, 3);
  expect(await value(page, 'trails')).toBe(0.35);

  await lock.click();   // unlocked: Drift takes it along again
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => value(page, 'hue'), { timeout: 10_000 }).not.toBeCloseTo(1 / 3, 3);
});

test('an XY pad moves two sliders: a press jumps there, Shift-drag is finer, and the axes are yours to pick', async ({ page }) => {
  await page.goto('/');
  await open(page);
  const pad = look(page).getByRole('group', { name: /^XY pad 1/ });
  await expect(pad).toHaveAccessibleName('XY pad 1: Speed across, Reactivity up');
  const b = (await pad.boundingBox())!;
  const inset = 7;
  await page.mouse.click(b.x + inset + 0.8 * (b.width - 2 * inset), b.y + inset + 0.25 * (b.height - 2 * inset));
  expect(await value(page, 'speed')).toBeCloseTo(2, 1);        // 80% across 0–2.5
  expect(await value(page, 'reactivity')).toBeCloseTo(1.5, 1); // 75% up 0–2

  await pad.dblclick();   // both back
  expect(await value(page, 'speed')).toBe(1);
  expect(await value(page, 'reactivity')).toBe(1);

  const mid = await centre(pad);
  await drag(page, mid, 30, 0, true);   // starts where the sliders are, not under the pointer
  const fine = (await value(page, 'speed')) - 1;
  expect(fine).toBeGreaterThan(0);
  await pad.dblclick();
  await drag(page, mid, 30, 0);
  const coarse = (await value(page, 'speed')) - 1;
  expect(fine).toBeLessThan(coarse / 4);

  await look(page).getByLabel('XY pad 1 across').selectOption('trails');
  await expect(pad).toHaveAccessibleName('XY pad 1: Trails across, Reactivity up');
  await expect(look(page).locator('label[for="trails"] .look-tag')).toHaveText('1↔');
  await expect(look(page).locator('label[for="speed"] .look-tag')).toHaveCount(0);
  await look(page).getByLabel('XY pad 1 across').selectOption('reactivity');   // the other axis's slider: they swap
  await expect(pad).toHaveAccessibleName('XY pad 1: Reactivity across, Trails up');

  await page.locator('#xy-toggle').click();
  await expect(pad).toHaveCount(0);
  await expect(look(page).locator('.look-tag')).toHaveCount(0);
});

test('Shift-drag on a slider moves it ten times finer, without jumping to the pointer', async ({ page }) => {
  await page.goto('/');
  await open(page);
  const trails = page.locator('#trails');
  const b = (await trails.boundingBox())!;
  const thumb = { x: b.x + 8 + (0.35 / 0.97) * (b.width - 16), y: b.y + b.height / 2 };
  await drag(page, thumb, 40, 0, true);
  const fine = (await value(page, 'trails')) - 0.35;
  await trails.dblclick();
  await drag(page, thumb, 40, 0);
  const coarse = (await value(page, 'trails')) - 0.35;
  expect(fine).toBeGreaterThan(0);
  expect(coarse).toBeGreaterThan(0.2);
  expect(fine).toBeLessThan(coarse / 4);
});

test('the Look comes back as it was left after a reload: sliders, locks and XY pads', async ({ page }) => {
  await page.goto('/');
  await open(page);
  await type(page, 'Reactivity', '140');
  await look(page).getByRole('button', { name: 'Lock Colour', exact: true }).click();
  await look(page).getByLabel('XY pad 2 up').selectOption('synesthesia');
  await page.locator('#xy-toggle').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hallucinate.look') ?? '{}').xyOpen)).toBe(false);

  await page.reload();
  await open(page);
  expect(await value(page, 'reactivity')).toBe(1.4);
  await expect(look(page).getByRole('button', { name: 'Lock Colour', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(look(page).getByRole('group', { name: /^XY pad/ })).toHaveCount(0);
  await page.locator('#xy-toggle').click();
  await expect(look(page).getByRole('group', { name: /^XY pad 2/ })).toHaveAccessibleName('XY pad 2: Colour across, Synesthesia up');
});
