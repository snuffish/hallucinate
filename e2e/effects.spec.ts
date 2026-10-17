import { EDGE_CLEAR, EDGE_FADE } from '../src/engine/effects';
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
  await expect(preview).toHaveAttribute('src', /^blob:/);
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
