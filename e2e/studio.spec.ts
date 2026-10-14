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

test('studio: the autopilot follows a saved plan instead of list order', async ({ page }) => {
  // A show of three scenes whose plan plays them in a different order than the list, with short steps.
  const cue = (name: string) => ({ id: `id-${name}`, name, scene: name, values: {}, look: {} });
  const show = {
    cues: [cue('Mandala Bloom'), cue('Hyper Tunnel'), cue('Star Nest')],
    mode: 'cut', seconds: 1, autoBeats: 16,
    plan: { steps: [{ cue: 'id-Hyper Tunnel', beats: 8, maxSeconds: 90 }, { cue: 'id-Star Nest', beats: 8, maxSeconds: 90 }], note: 'tunnel, then space', loop: true },
  };
  await page.addInitScript((saved) => { localStorage.setItem('hallucinate.show', JSON.stringify(saved)); }, show);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await page.keyboard.press('o');
  await expect(page.locator('#st-plan li')).toHaveCount(3);   // two steps and the tools chip
  await expect(page.locator('#st-director-status')).toContainText('tunnel, then space');
  await page.locator('#st-auto').check();
  // The plan starts at the next take (16 beats on the dial), then its own counts: Hyper Tunnel, then Star Nest.
  await expect(page.locator('#st-live-name')).toHaveText('Hyper Tunnel', { timeout: 30_000 });
  await expect(page.locator('#st-beats')).toContainText('/ 8 beats');
  await expect(page.locator('#st-plan li.playing')).toContainText('Hyper Tunnel');
  await expect(page.locator('#st-live-name')).toHaveText('Star Nest', { timeout: 20_000 });
  await page.locator('#st-plan-clear').click();              // drop the plan: back to the list
  await expect(page.locator('#st-plan')).toHaveCount(0);
  await expect(page.locator('#st-beats')).toContainText('/ 16 beats');
});
