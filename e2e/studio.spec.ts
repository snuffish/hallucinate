import { expect, test } from '@playwright/test';

// A fake projector: says hello like output.html does and reports the scene index of the next frame.
async function projectorSees(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve) => {
    const ch = new BroadcastChannel('hallucinate-output');
    const id = 'fake-projector';
    ch.onmessage = (e) => { if (e.data.type === 'frame') { ch.close(); resolve(e.data.state.scene); } };
    ch.postMessage({ type: 'hello', id });
    ch.postMessage({ type: 'status', id, w: 1280, h: 720, fullscreen: false, fps: 60 });
  }));
}

test('studio: Live stays pinned to the taken scene while the screen previews other scenes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await page.keyboard.press('o');
  await expect(page.locator('#studio')).toBeVisible();
  await page.selectOption('#st-add', 'Hyper Tunnel');     // becomes Preview
  await page.keyboard.press('t');                           // Take: Hyper Tunnel is Live and on screen
  await expect(page.locator('#st-live-name')).toHaveText('Hyper Tunnel');
  await expect(page.locator('#scene-name')).toContainText('Hyper Tunnel');
  expect(await projectorSees(page)).toBe(1);                // Hyper Tunnel is scene index 1

  await page.keyboard.press('Escape');                      // close the studio: Live is pinned
  await expect(page.locator('#live-pin')).toContainText('Hyper Tunnel');
  await page.keyboard.press('ArrowRight');                  // browse on screen
  await expect(page.locator('#scene-name')).toContainText('Mandala Bloom');
  expect(await projectorSees(page)).toBe(1);                // the projector still shows Hyper Tunnel

  await page.keyboard.press('o');                           // reopening puts Live back on screen
  await expect(page.locator('#scene-name')).toContainText('Hyper Tunnel');
  await expect(page.locator('#live-pin')).toHaveCount(0);
  await expect(page.locator('#st-beats')).toContainText('— / 32 beats');
  await page.locator('#st-auto').check();
  await expect(page.locator('#st-beats')).toContainText('/ 32 beats');
});
