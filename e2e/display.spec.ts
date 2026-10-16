import { expect, test, type Page } from './fixtures';

const BLACK = 'void main() { fragColor = vec4(0., 0., 0., 1.); }';
const GREY = 'void main() { fragColor = vec4(.25, .25, .25, 1.); }';

// Start on a user scene, so the spec doesn't depend on which built-ins exist.
async function playUserScene(page: Page, body: string) {
  await page.goto('/');
  await page.evaluate((body) => {
    localStorage.setItem('hallucinate.userScenes', JSON.stringify([{ name: 'Probe', body }]));
    localStorage.setItem('hallucinate.lastScene', 'user:Probe');
  }, body);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#scene-name')).toContainText('Probe');
  await page.locator('#auto').uncheck();   // stay on the probe scene
}

// The canvas as it appears on screen, with everything drawn over it hidden.
async function canvasPixels(page: Page): Promise<number[]> {
  const png = await page.locator('#gl').screenshot({
    style: 'body * { visibility: hidden !important; } #gl { visibility: visible !important; }',
  });
  return page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    const rgb: number[] = [];
    d.forEach((v, i) => { if (i % 4 !== 3) rgb.push(v); });
    return rgb;
  }, png.toString('base64'));
}

test('display: a scene that draws black leaves the display pass exactly black', async ({ page }) => {
  await playUserScene(page, BLACK);
  await page.waitForTimeout(500);   // let any start-up crossfade and trails settle
  for (let shot = 0; shot < 3; shot++) {
    const px = await canvasPixels(page);
    expect(px.length).toBeGreaterThan(0);
    expect(px.reduce((m, v) => Math.max(m, v), 0)).toBe(0);
  }
});

test('display: lit pixels still get grain', async ({ page }) => {
  await playUserScene(page, GREY);
  await page.waitForTimeout(500);
  // Grain moves every frame; the rest of a flat grey scene's display pass holds still.
  const a = await canvasPixels(page);
  await page.waitForTimeout(100);
  const b = await canvasPixels(page);
  expect(a.reduce((m, v) => Math.max(m, v), 0)).toBeGreaterThan(0);
  expect(a.some((v, i) => v !== b[i])).toBe(true);
});
