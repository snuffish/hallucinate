import { expect, test, type Page } from '@playwright/test';

// Reads the WebGL canvas inside a rAF callback that runs after the app's own frame, so the drawing
// buffer still holds the frame. Returns the brightest channel value seen in a coarse sample.
async function brightestPixel(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve) => {
    requestAnimationFrame(() => {
      const gl = document.getElementById('gl') as HTMLCanvasElement;
      const c = document.createElement('canvas');
      c.width = 64; c.height = 36;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(gl, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i]!, d[i + 1]!, d[i + 2]!);
      resolve(max);
    });
  }));
}

test('boots, plays the demo beat and renders a scene', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#params')).toBeHidden();   // no parameter overlay over the start screen
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
  await expect(page.locator('#params')).toBeVisible();  // the first scene has live parameters
  await page.waitForTimeout(1500);
  expect(await brightestPixel(page)).toBeGreaterThan(16);

  const before = await page.locator('#scene-name').textContent();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#scene-name')).not.toHaveText(before ?? '');
  expect(errors).toEqual([]);
});
