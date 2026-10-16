import { expect, seedScenes, solidScene, test } from './fixtures';

const SCENES = [solidScene('Red Room', '1., 0., 0.'), solidScene('Green Room', '0., 1., 0.'), solidScene('Blue Room', '0., 0., 1.')];

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
  await seedScenes(page, SCENES);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await page.keyboard.press('o');
  await expect(page.locator('#studio')).toBeVisible();
  await page.selectOption('#st-add', 'Red Room');         // becomes Preview
  await page.keyboard.press('t');                           // Take: Red Room is Live and on screen
  await expect(page.locator('#st-live-name')).toHaveText('Red Room');
  await expect(page.locator('#scene-name')).toContainText('Red Room');
  const red = await projectorSees(page);                    // Red Room's scene index

  await page.keyboard.press('Escape');                      // close the studio: Live is pinned
  await expect(page.locator('#live-pin')).toContainText('Red Room');
  await page.keyboard.press('ArrowRight');                  // browse on screen
  await expect(page.locator('#scene-name')).toContainText('Green Room');
  expect(await projectorSees(page)).toBe(red);              // the projector still shows Red Room

  await page.keyboard.press('o');                           // reopening puts Live back on screen
  await expect(page.locator('#scene-name')).toContainText('Red Room');
  await expect(page.locator('#live-pin')).toHaveCount(0);
  await expect(page.locator('#st-beats')).toContainText('— / 32 beats');
  await page.locator('#st-auto').check();
  await expect(page.locator('#st-beats')).toContainText('/ 32 beats', { timeout: 30_000 });   // tempo detection is slow on a loaded runner
});

test('studio: the autopilot follows a saved plan instead of list order', async ({ page }) => {
  test.slow();   // at a slow runner's frame rate the demo's 124 BPM reads as 17-31 BPM, so beats come slowly
  // A show of three scenes whose plan plays them in a different order than the list, with short steps.
  const cue = (name: string) => ({ id: `id-${name}`, name, scene: name, values: {}, look: {} });
  const show = {
    cues: [cue('Red Room'), cue('Green Room'), cue('Blue Room')],
    mode: 'cut', seconds: 1, autoBeats: 16,
    plan: { steps: [{ cue: 'id-Green Room', beats: 8, maxSeconds: 90 }, { cue: 'id-Blue Room', beats: 8, maxSeconds: 90 }], note: 'green, then blue', loop: true },
  };
  await seedScenes(page, SCENES, { 'hallucinate.show': JSON.stringify(show) });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await page.keyboard.press('o');
  await expect(page.locator('#st-plan li')).toHaveCount(3);   // two steps and the tools chip
  await expect(page.locator('#st-director-status')).toContainText('green, then blue');
  await expect(page.locator('#st-director')).toBeVisible();   // the footer stays in view at 720p; the list scrolls instead
  await page.locator('#st-auto').check();
  // The plan starts at the next take (16 beats on the dial), then its own counts: Green Room, then Blue Room.
  await expect(page.locator('#st-live-name')).toHaveText('Green Room', { timeout: 90_000 });
  await expect(page.locator('#st-beats')).toContainText('/ 8 beats');
  await expect(page.locator('#st-plan li.playing')).toContainText('Green Room');
  await expect(page.locator('#st-live-name')).toHaveText('Blue Room', { timeout: 45_000 });
  await page.locator('#st-plan-clear').click();              // drop the plan: back to the list
  await expect(page.locator('#st-plan')).toHaveCount(0);
  await expect(page.locator('#st-beats')).toContainText('/ 16 beats');
});
