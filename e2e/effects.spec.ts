import { EDGE_CLEAR, EDGE_FADE, EFFECTS } from '../src/engine/effects';
import { expect, seedScenes, test, type Page } from './fixtures';

// How far the main screen's picture is from symmetric, left to right and top to bottom: the share of
// pixels, away from the edges (where effects fade back to the scene's own picture), that differ from
// their mirror image by more than the display's grain. Read inside a rAF callback that runs after the
// app's own frame, so the drawing buffer still holds it (as smoke.spec.ts does).
async function asymmetry(page: Page): Promise<{ lr: number; tb: number }> {
  return page.evaluate((inner) => new Promise<{ lr: number; tb: number }>((resolve) => {
    requestAnimationFrame(() => {
      const gl = document.getElementById('gl') as HTMLCanvasElement;
      const w = gl.width, h = gl.height;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(gl, 0, 0);
      const d = ctx.getImageData(0, 0, w, h).data;
      const reach = inner * Math.min(w, h);
      const off = (i: number, j: number) => Math.max(Math.abs(d[i]! - d[j]!), Math.abs(d[i + 1]! - d[j + 1]!), Math.abs(d[i + 2]! - d[j + 2]!)) > 5;
      let lr = 0, tb = 0, all = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (Math.min(x, w - 1 - x, y, h - 1 - y) < reach) continue;
        all++;
        const i = (y * w + x) * 4;
        if (off(i, (y * w + (w - 1 - x)) * 4)) lr++;
        if (off(i, ((h - 1 - y) * w + x) * 4)) tb++;
      }
      resolve({ lr: lr / all, tb: tb / all });
    });
  }), EDGE_CLEAR + EDGE_FADE);
}

// How many passes the main screen draws in one frame: WebGL draw calls between two animation frames
// (the app draws in its own animation frame, which runs before ours). Needs countDraws() first.
async function passes(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve) => {
    const w = window as unknown as { __draws: number };
    requestAnimationFrame(() => { w.__draws = 0; requestAnimationFrame(() => resolve(w.__draws)); });
  }));
}
const countDraws = (page: Page) => page.addInitScript(() => {
  const w = window as unknown as { __draws: number };
  w.__draws = 0;
  const draw = WebGL2RenderingContext.prototype.drawArrays;
  WebGL2RenderingContext.prototype.drawArrays = function (...args) { w.__draws++; return draw.apply(this, args); };
});

const SYMMETRIC = 0.0005;   // a few stray pixels at most
const mirrored = (page: Page, axes: { lr: boolean; tb: boolean }) => expect.poll(async () => {
  const a = await asymmetry(page);
  return { lr: a.lr < SYMMETRIC, tb: a.tb < SYMMETRIC };
}, { timeout: 15_000 }).toEqual(axes);

const addMenu = (page: Page) => page.locator('#fx-add');
const row = (page: Page, id: string) => page.locator(`#w-effects [data-effect="${id}"]`);

// A hotkey, as from the screen: shortcuts don't reach the page while a control has the focus.
async function press(page: Page, key: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(key);
}

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
  await page.locator('#auto').uncheck();   // auto-switch must not change the scene under the test
}

test('effects: the widget docks under the Look and adds, switches, sets and removes a Mirror on the main screen', async ({ page }) => {
  await start(page);
  const left = await page.locator('.dock-zone.left > [data-widget]').evaluateAll((els) => els.map((e) => e.getAttribute('data-widget')));
  expect(left.indexOf('effects')).toBe(left.indexOf('look') + 1);

  await press(page, '2');
  await expect(page.locator('#scene-name')).toContainText('Light Sheet');   // not symmetric on its own
  await mirrored(page, { lr: false, tb: false });

  await expect(addMenu(page).locator('option', { hasText: 'Mirror' })).toHaveCount(1);
  await addMenu(page).selectOption('mirror');
  await expect(row(page, 'mirror')).toBeVisible();
  await expect(addMenu(page).locator('option', { hasText: 'Mirror' })).toHaveCount(0);   // only effects not yet added
  await mirrored(page, { lr: true, tb: false });

  await page.locator('#fx-mirror-on').uncheck();
  await mirrored(page, { lr: false, tb: false });
  await page.locator('#fx-mirror-on').check();
  await mirrored(page, { lr: true, tb: false });

  await page.locator('#fx-mirror-axis').selectOption({ label: 'Top ↕ bottom' });
  await mirrored(page, { lr: false, tb: true });
  await page.locator('#fx-mirror-axis').selectOption({ label: 'Both' });
  await mirrored(page, { lr: true, tb: true });

  await row(page, 'mirror').getByRole('button', { name: 'Remove Mirror' }).click();
  await expect(row(page, 'mirror')).toHaveCount(0);
  await expect(addMenu(page).locator('option', { hasText: 'Mirror' })).toHaveCount(1);
  await mirrored(page, { lr: false, tb: false });
});

// No crossfade runs here (that draws the outgoing picture too): the first scene, auto-switch off.
test('effects: a switched-on effect costs one pass, and none switched on costs nothing', async ({ page }) => {
  await countDraws(page);
  await start(page);
  await expect.poll(() => passes(page), { timeout: 15_000 }).toBeGreaterThan(0);   // the app draws
  const plain = await passes(page);
  await addMenu(page).selectOption('mirror');
  await expect.poll(() => passes(page), { timeout: 15_000 }).toBe(plain + 1);
  await page.locator('#fx-mirror-on').uncheck();
  await expect.poll(() => passes(page), { timeout: 15_000 }).toBe(plain);
});

test('effects: the main screen keeps them through a scene change, Randomize, Drift and a reload', async ({ page }) => {
  await start(page);
  await addMenu(page).selectOption('mirror');
  await page.locator('#fx-mirror-axis').selectOption({ label: 'Top ↕ bottom' });

  await press(page, '3');
  await expect(page.locator('#scene-name')).toContainText('Ring Run');
  await press(page, 'r');
  await page.locator('#drift').check();
  await page.waitForTimeout(500);
  await page.locator('#drift').uncheck();
  await expect(row(page, 'mirror')).toBeVisible();
  await expect(page.locator('#fx-mirror-on')).toBeChecked();
  await expect(page.locator('#fx-mirror-axis')).toHaveValue('1');

  await page.reload();
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#fx-mirror-on')).toBeChecked();
  await expect(page.locator('#fx-mirror-axis')).toHaveValue('1');
  await page.locator('#auto').uncheck();
  await press(page, '2');
  await expect(page.locator('#scene-name')).toContainText('Light Sheet');
  await mirrored(page, { lr: false, tb: true });
});

test('effects: a damaged stored stack loads cleaned up', async ({ page }) => {
  await seedScenes(page, [], {
    'hallucinate.screenEffects': JSON.stringify([
      { id: 'echo', on: true, settings: {} },
      { id: 'mirror', on: false, settings: { axis: 9 } },
      { id: 'mirror', on: true, settings: { axis: 0 } },
    ]),
  });
  await page.goto('/');
  await expect(page.locator('#w-effects [data-effect]')).toHaveCount(1);
  await expect(page.locator('#fx-mirror-on')).not.toBeChecked();
  await expect(page.locator('#fx-mirror-axis')).toHaveValue('2');
});

// Library previews show scenes, not show scenes: a Mirror on the main screen doesn't reach them.
test('effects: library previews show scenes without effects', async ({ page }) => {
  await start(page);
  await addMenu(page).selectOption('mirror');
  await page.locator('#fx-mirror-axis').selectOption({ label: 'Both' });
  await press(page, 'l');
  const preview = page.locator('.lib-card', { hasText: 'Light Sheet' }).locator('img');
  await expect(preview).toHaveAttribute('src', /^blob:/, { timeout: 30_000 });   // previews render two at a time
  const asym = await preview.evaluate((img: HTMLImageElement, inner) => {
    const { naturalWidth: w, naturalHeight: h } = img;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    const reach = inner * Math.min(w, h);
    let lr = 0, all = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (Math.min(x, w - 1 - x, y, h - 1 - y) < reach) continue;   // where a mirror would fade out
      all++;
      const i = (y * w + x) * 4, j = (y * w + (w - 1 - x)) * 4;
      if (Math.max(Math.abs(d[i]! - d[j]!), Math.abs(d[i + 1]! - d[j + 1]!), Math.abs(d[i + 2]! - d[j + 2]!)) > 5) lr++;
    }
    return lr / all;
  }, EDGE_CLEAR + EDGE_FADE);
  expect(asym, "Light Sheet's preview isn't mirrored").toBeGreaterThan(0.01);
});

// Each catalogue effect's settings become the widget's controls: the Wave's amount and wavelength
// sliders, with its ranges and defaults.
test('effects: a Wave gets amount and wavelength sliders from its catalogue ranges', async ({ page }) => {
  await start(page);
  await addMenu(page).selectOption('wave');
  await expect(row(page, 'wave')).toBeVisible();
  await expect(addMenu(page).locator('option', { hasText: 'Wave' })).toHaveCount(0);
  const wave = EFFECTS.find((e) => e.id === 'wave')!;
  for (const s of wave.settings) {
    const slider = page.locator(`#fx-wave-${s.key}`);
    await expect(slider).toHaveAttribute('type', 'range');
    await expect(slider).toHaveAttribute('min', String(s.min));
    await expect(slider).toHaveAttribute('max', String(s.max));
    await expect(slider).toHaveAttribute('step', String(s.step));
    await expect(slider).toHaveValue(String(s.default));
  }
  await expect(row(page, 'wave')).toContainText('Amount');
  await expect(row(page, 'wave')).toContainText('Wavelength');
  await page.locator('#fx-wave-amount').fill('1');
  await expect(page.locator('#fx-wave-amount')).toHaveValue('1');
});
