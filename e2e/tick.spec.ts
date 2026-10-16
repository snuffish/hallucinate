import { expect, test, type Page } from './fixtures';

// A My Shader that shows the tick: red is how far through the current tick, blue flips on every other tick.
const TICK_SHADER = 'void main() { fragColor = vec4(uTick, 0., mod(uTicks, 2.), 1.); }';

// The average colour of a patch in the middle of the screen, decoded from a screenshot in the page
// (the WebGL canvas can't be read back after it is composited).
async function centreColour(page: Page): Promise<[number, number, number]> {
  const { width, height } = page.viewportSize()!;
  const png = await page.screenshot({ clip: { x: width * 0.6 - 4, y: height * 0.5 - 4, width: 8, height: 8 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height).getContext('2d')!;
    c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, img.width, img.height).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k]! += d[i + k]!;
    return sum.map((v) => v / (d.length / 4)) as [number, number, number];
  }, png.toString('base64'));
}

test('My Shader follows the ticks: uTick sweeps through each beat and uTicks counts them', async ({ page }) => {
  test.slow();   // tempo detection is slow on a loaded runner
  await page.addInitScript((code) => {
    localStorage.setItem('hallucinate.customShader', code);
    localStorage.setItem('hallucinate.lastScene', 'custom');
  }, TICK_SHADER);
  await page.goto('/');
  await expect(page.locator('#scene-name')).toContainText('My Shader');
  await page.getByRole('button', { name: 'Play demo beat' }).click();

  // Once the tempo is heard the red sweeps from dark to bright through every tick, and the blue flips.
  const reds: number[] = [], blues: number[] = [];
  await expect.poll(async () => {
    const [r, , b] = await centreColour(page);
    reds.push(r); blues.push(b);
    return Math.min(...reds) < 80 && Math.max(...reds) > 150 && Math.min(...blues) < 40 && Math.max(...blues) > 200;
  }, { timeout: 120_000, intervals: [100] }).toBe(true);
});
