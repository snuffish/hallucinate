import { centreColour, expect, test } from './fixtures';

// A My Shader that shows the tick: red is how far through the current tick, blue flips on every other tick.
const TICK_SHADER = 'void main() { fragColor = vec4(uTick, 0., mod(uTicks, 2.), 1.); }';

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
    const [r, , b] = await centreColour(page, 8);
    reds.push(r); blues.push(b);
    return Math.min(...reds) < 80 && Math.max(...reds) > 150 && Math.min(...blues) < 40 && Math.max(...blues) > 160;   // a full channel tonemaps to ~185, with no saturation boost
  }, { timeout: 120_000, intervals: [100] }).toBe(true);
});
