import { expect, test, type Page } from '@playwright/test';

// Two solid-colour scenes, so what the screen shows can be told apart by colour.
const solid = (name: string, rgb: string) => ({ name, body: `void main() { fragColor = vec4(${rgb}, 1.); }` });

// The average colour of a patch in the middle of the screen. The WebGL canvas can't be read back
// after it is composited, so this decodes a screenshot in the page.
async function centreColour(page: Page): Promise<[number, number, number]> {
  const { width, height } = page.viewportSize()!;
  const png = await page.screenshot({ clip: { x: width * 0.6 - 10, y: height * 0.5 - 10, width: 20, height: 20 } });
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
// The controls fade out after 3 s without the mouse while music plays; moving it brings them back,
// as it does for a user reaching for a button.
async function clickWidget(page: Page, selector: string) {
  await page.mouse.move(640, 360);
  await page.mouse.move(650, 370);
  await page.locator(selector).click();
}
const reddish = ([r, , b]: [number, number, number]) => r > b + 40;
const bluish = ([r, , b]: [number, number, number]) => b > r + 40;

test('screen widget: the screen switches between your preview and the pinned Live slot', async ({ page }) => {
  await page.addInitScript((scenes) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('hallucinate.userScenes', JSON.stringify(scenes));
      localStorage.setItem('hallucinate.show', JSON.stringify({ cues: [{ id: 'red', name: 'Red', scene: 'Red', values: {}, look: {} }], mode: 'cut', seconds: 1 }));
      sessionStorage.setItem('seeded', '1');
    }
  }, [solid('Red', '1., 0., 0.'), solid('Blue', '0., 0., 1.')]);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#screen-status')).toContainText('Nothing is pinned Live');

  // Take Red Live in the studio; with the studio open the switch is off.
  await page.keyboard.press('o');
  await expect(page.locator('#screen-live')).toBeDisabled();
  await page.keyboard.press('t');
  await expect(page.locator('#st-live-name')).toHaveText('Red');
  await page.keyboard.press('Escape');                       // Live is pinned now

  // Browse to Blue: the screen is a preview, so it shows Blue.
  await page.keyboard.press('l');
  await page.keyboard.press('/');
  await page.keyboard.type('Blue');
  await page.keyboard.press('Enter');
  await expect(page.locator('#scene-name')).toContainText('Blue');
  await expect(page.locator('#live-pin')).toContainText('screen is a preview');
  await expect(page.locator('#screen-preview')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => centreColour(page).then(bluish), { timeout: 10_000 }).toBe(true);

  // Live: the screen shows what the projectors get (Red); the scene you browsed to stays the preview.
  await clickWidget(page, '#screen-live');
  await expect(page.locator('#screen-live')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#live-pin')).toContainText('on screen');
  await expect(page.locator('#screen-status')).toContainText('Showing Live: Red');
  await expect.poll(() => centreColour(page).then(reddish), { timeout: 10_000 }).toBe(true);
  await expect(page.locator('#scene-name')).toContainText('Blue');

  await clickWidget(page, '#screen-preview');
  await expect.poll(() => centreColour(page).then(bluish), { timeout: 10_000 }).toBe(true);
});
