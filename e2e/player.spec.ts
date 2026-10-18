import { expect, test, type Locator, type Page } from './fixtures';

type Box = { x: number; y: number; width: number; height: number };
const box = async (l: Locator) => (await l.boundingBox()) as Box;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// 20 s of 8-bit silence: long enough to seek ±10 s.
function silentWav(seconds = 20): Buffer {
  const rate = 8000, samples = rate * seconds;
  const b = Buffer.alloc(44 + samples);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(samples, 40); b.fill(128, 44);
  return b;
}

async function playFile(page: Page) {
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'quiet.wav', mimeType: 'audio/wav', buffer: silentWav() });
  await expect(page.locator('#tp-dur')).toHaveText('0:20');
}

test('player bar: runs along the bottom, and the demo beat shows whether it plays', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#transport')).toBeHidden();   // nothing to control on the start screen
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  const bar = page.locator('#transport');
  await expect(bar).toBeVisible();
  const b = await box(bar), view = page.viewportSize()!;
  expect(b.x).toBe(0);
  expect(b.width).toBe(view.width);
  expect(b.y + b.height).toBe(view.height);
  await expect(page.locator('#tp-seek')).toBeHidden();      // the demo beat can't seek
  await expect(page.locator('#tp-cur')).toBeHidden();
  await expect(page.locator('#w-source #transport')).toHaveCount(0);

  const play = page.locator('#tp-play');
  await expect(play).toHaveAttribute('title', /^Pause/);
  await play.click();
  await expect(play).toHaveAttribute('title', /^Play/);
  await play.click();
  await expect(play).toHaveAttribute('title', /^Pause/);

  // The assistant bubble keeps clear of it.
  expect(overlaps(await box(page.locator('.ai-bubble')), await box(bar))).toBe(false);
});

test('player bar: a file seeks, stops, loops, sets the volume, and keeps tempo and pitch in a popover', async ({ page }) => {
  await playFile(page);
  await expect(page.locator('#tp-title')).toContainText('quiet');
  // The seek line runs along the bar's top edge, edge to edge.
  const seek = await box(page.locator('#tp-seek')), bar = await box(page.locator('#transport'));
  expect(seek.y).toBeLessThanOrEqual(bar.y + 1);
  expect(seek.width).toBe(bar.width);
  await page.locator('#tp-fwd').click();
  await expect(page.locator('#tp-cur')).toHaveText(/^0:1\d$/);
  await page.locator('#tp-stop').click();
  await expect(page.locator('#tp-cur')).toHaveText('0:00');
  await expect(page.locator('#tp-play')).toHaveAttribute('title', /^Play/);
  await page.locator('#tp-loop').click();
  await expect(page.locator('#tp-loop')).toHaveClass(/active/);
  await page.locator('#tp-volume').fill('0.5');
  await expect(page.locator('#tp-volume')).toHaveAttribute('title', /Volume 50%/);

  await expect(page.locator('#tp-tempo')).toBeHidden();
  await page.locator('#tp-rate-val').click();
  await expect(page.locator('#tp-tempo')).toBeVisible();
  await page.locator('#tp-rate').fill('1.5');
  await expect(page.locator('#tp-rate-val')).toHaveText('1.50×');
  await page.locator('#tp-pitch').check();
  await page.locator('#tp-rate-reset').click();
  await expect(page.locator('#tp-rate-val')).toHaveText('1.00×');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tp-tempo')).toBeHidden();
});

test('player bar: hides with the controls, and a widget docked at the bottom sits on top of it', async ({ page }) => {
  await playFile(page);
  const bar = page.locator('#transport');
  await page.keyboard.press('h');
  await expect(bar).toHaveCSS('opacity', '0');
  await page.keyboard.press('h');
  await expect(bar).toHaveCSS('opacity', '1');

  const handle = page.locator('#w-look > header');
  await handle.scrollIntoViewIfNeeded();
  const h = await box(handle), b = await box(bar);
  await page.mouse.move(h.x + 16, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 30, h.y + h.height / 2, { steps: 3 });
  await page.mouse.move(720, b.y - 6, { steps: 12 });
  await page.mouse.up();
  const look = page.locator('.dock-zone.bottom #w-look');
  await expect(look).toBeVisible();
  const l = await box(look);
  expect(l.y + l.height).toBeLessThanOrEqual(b.y);
});
