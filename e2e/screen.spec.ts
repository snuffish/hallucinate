import { centreColour, expect, solidScene, test, type Page } from './fixtures';

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
  }, [solidScene('Red', '1., 0., 0.'), solidScene('Blue', '0., 0., 1.')]);
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
  await expect.poll(() => centreColour(page, 20).then(bluish), { timeout: 30_000 }).toBe(true);

  // Live: the screen shows what the projectors get (Red); the scene you browsed to stays the preview.
  await clickWidget(page, '#screen-live');
  await expect(page.locator('#screen-live')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#live-pin')).toContainText('on screen');
  await expect(page.locator('#screen-status')).toContainText('Showing Live: Red');
  await expect.poll(() => centreColour(page, 20).then(reddish), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('#scene-name')).toContainText('Blue');

  await clickWidget(page, '#screen-preview');
  await expect.poll(() => centreColour(page, 20).then(bluish), { timeout: 30_000 }).toBe(true);
});
