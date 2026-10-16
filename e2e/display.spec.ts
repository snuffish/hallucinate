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

// A 40×40 patch of the canvas as it appears on screen, with everything drawn over it hidden. The
// WebGL canvas can't be read back after it is composited, so this decodes a screenshot in the page.
async function patch(page: Page, fx: number, fy: number): Promise<number[]> {
  const { width, height } = page.viewportSize()!;
  const png = await page.screenshot({
    clip: { x: Math.round(width * fx) - 20, y: Math.round(height * fy) - 20, width: 40, height: 40 },
    style: 'body * { visibility: hidden !important; } #gl { visibility: visible !important; }',
  });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const rgb: number[] = [];
    ctx.getImageData(0, 0, img.width, img.height).data.forEach((v, i) => { if (i % 4 !== 3) rgb.push(v); });
    return rgb;
  }, png.toString('base64'));
}

// The middle, where the vignette leaves the picture brightest, and an edge.
const SPOTS = [[0.5, 0.5], [0.05, 0.5]] as const;
const brightest = (px: number[]) => px.reduce((m, v) => Math.max(m, v), 0);

test('display: a scene that draws black leaves the display pass exactly black', async ({ page }) => {
  await playUserScene(page, BLACK);
  await page.waitForTimeout(500);   // let any start-up crossfade and trails settle
  for (const [fx, fy] of SPOTS) {
    const px = await patch(page, fx, fy);
    expect(px.length).toBe(40 * 40 * 3);
    expect(brightest(px)).toBe(0);
  }
});

test('display: lit pixels still get grain', async ({ page }) => {
  await playUserScene(page, GREY);
  await page.waitForTimeout(500);
  // Grain moves every frame; the rest of a flat grey scene's display pass holds still.
  const a = await patch(page, 0.5, 0.5);
  expect(brightest(a)).toBeGreaterThan(0);
  await expect.poll(async () => (await patch(page, 0.5, 0.5)).some((v, i) => v !== a[i]), { timeout: 30_000 }).toBe(true);
});
