import { expect, seedScenes, test, type Page } from './fixtures';

// A scene that is black but for a white bar down the middle: whatever shows left and right of it is the
// background.
const NIGHT = { name: 'Night', body: 'void main() { float x = gl_FragCoord.x / uRes.x; fragColor = vec4(vec3(step(abs(x - .5), .02)), 1.); }' };

// An 8×8 white PNG.
const WHITE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGP4jwMwDC0JALoev0Ewkwr8AAAAAElFTkSuQmCC', 'base64');

type Rgb = [number, number, number];

// The main screen's pixel at (fx, fy), shares of its width and height from the top left. Read inside a
// rAF callback that runs after the app's own frame, so the drawing buffer still holds it.
function pixel(page: Page, fx: number, fy: number): Promise<Rgb> {
  return page.evaluate(([fx, fy]) => new Promise<Rgb>((resolve) => {
    requestAnimationFrame(() => {
      const gl = document.getElementById('gl') as HTMLCanvasElement;
      const c = document.createElement('canvas');
      c.width = gl.width; c.height = gl.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(gl, 0, 0);
      const d = ctx.getImageData(Math.floor(fx! * (gl.width - 1)), Math.floor(fy! * (gl.height - 1)), 1, 1).data;
      resolve([d[0]!, d[1]!, d[2]!]);
    });
  }), [fx, fy]);
}

const isBlack = ([r, g, b]: Rgb) => r + g + b <= 6;   // the display's grain stays off black, but allow a little
const isBlue = ([r, g, b]: Rgb) => b > 30 && b > 2 * r && b > 2 * g;
const isRed = ([r, g, b]: Rgb) => r > 30 && r > 2 * g && r > 2 * b;
const isGrey = ([r, g, b]: Rgb) => Math.min(r, g, b) > 30;

// A hotkey, as from the screen: shortcuts don't reach the page while a control has the focus.
async function press(page: Page, key: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(key);
}

async function start(page: Page, storage: Record<string, string> = {}) {
  await seedScenes(page, [NIGHT], { 'hallucinate.lastScene': 'user:Night', ...storage });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
  await page.locator('#auto').uncheck();   // auto-switch must not change the scene under the test
  await expect(page.locator('#scene-name')).toContainText('Night');
}

// Brightest and still: Breathe would dim it with the demo beat's mood.
async function brightest(page: Page) {
  await page.locator('#bg-brightness').fill('1');
  await page.locator('#bg-breathe').fill('0');
}

test('background: the widget docks under Effects and puts a colour behind the lines, black at the edges', async ({ page }) => {
  await start(page);
  const left = await page.locator('.dock-zone.left > [data-widget]').evaluateAll((els) => els.map((e) => e.getAttribute('data-widget')));
  expect(left.indexOf('background')).toBe(left.indexOf('effects') + 1);
  await expect(page.locator('#bg-kind')).toHaveValue('none');
  await expect(page.locator('#bg-brightness')).toHaveCount(0);   // nothing to set for none
  await expect.poll(() => pixel(page, 0.25, 0.5).then(isBlack), { timeout: 15_000 }).toBe(true);
  const line = await pixel(page, 0.5, 0.5);

  await page.locator('#bg-kind').selectOption('colour');
  await page.locator('#bg-colour').fill('#0000ff');
  await brightest(page);
  await expect.poll(() => pixel(page, 0.25, 0.5).then(isBlue), { timeout: 15_000 }).toBe(true);
  const lit = await pixel(page, 0.5, 0.5);
  // The grade drifts with the music's tone and mood, so compare how blue the line is, not its exact value:
  // a background showing through it would tint it blue.
  expect(lit[2] - lit[0], 'the line keeps its own colour').toBeLessThanOrEqual(line[2] - line[0] + 12);
  expect(Math.min(...lit), 'the line stays bright').toBeGreaterThan(120);
  expect(isBlack(await pixel(page, 0, 0.5)), 'the edge stays black').toBe(true);
  expect(isBlack(await pixel(page, 0.25, 0)), 'the top edge too').toBe(true);

  await page.locator('#bg-brightness').fill('0');
  await expect.poll(() => pixel(page, 0.25, 0.5).then(isBlack), { timeout: 15_000 }).toBe(true);
  await page.locator('#bg-brightness').fill('1');
  await page.locator('#bg-kind').selectOption('none');
  await expect.poll(() => pixel(page, 0.25, 0.5).then(isBlack), { timeout: 15_000 }).toBe(true);
});

test('background: a gradient blends from one colour to the other at its angle', async ({ page }) => {
  await start(page);
  await page.locator('#bg-kind').selectOption('gradient');
  await page.locator('#bg-colour').fill('#ff0000');
  await page.locator('#bg-colour2').fill('#0000ff');
  await page.locator('#bg-angle').fill('0');   // left to right
  await brightest(page);
  await expect.poll(async () => [isRed(await pixel(page, 0.15, 0.5)), isBlue(await pixel(page, 0.85, 0.5))], { timeout: 15_000 }).toEqual([true, true]);
  await page.locator('#bg-angle').fill('180');   // right to left
  await expect.poll(async () => [isBlue(await pixel(page, 0.15, 0.5)), isRed(await pixel(page, 0.85, 0.5))], { timeout: 15_000 }).toEqual([true, true]);
});

test('background: media shows the dropped image behind the lines, and the scene on screen stays', async ({ page }) => {
  await start(page);
  await page.locator('#bg-kind').selectOption('media');
  await brightest(page);
  await expect.poll(() => pixel(page, 0.25, 0.5).then(isBlack), { timeout: 15_000 }).toBe(true);   // no media yet: nothing
  await page.locator('#media-file').setInputFiles({ name: 'white.png', mimeType: 'image/png', buffer: WHITE_PNG });
  await expect(page.locator('#toast')).toContainText('shows behind the lines');
  await expect(page.locator('#scene-name')).toContainText('Night');
  await expect.poll(() => pixel(page, 0.25, 0.5).then(isGrey), { timeout: 15_000 }).toBe(true);
  expect(isBlack(await pixel(page, 0, 0.5)), 'the edge stays black').toBe(true);
});

test('background: the main screen keeps it through a scene change, Randomize, Drift and a reload', async ({ page }) => {
  await start(page);
  await page.locator('#bg-kind').selectOption('colour');
  await page.locator('#bg-colour').fill('#0000ff');
  await page.locator('#bg-brightness').fill('0.8');

  await press(page, '3');
  await expect(page.locator('#scene-name')).toContainText('Ring Run');
  await press(page, 'r');
  await page.locator('#drift').check();
  await page.waitForTimeout(500);
  await page.locator('#drift').uncheck();
  await expect(page.locator('#bg-kind')).toHaveValue('colour');
  await expect(page.locator('#bg-brightness')).toHaveValue('0.8');

  await page.reload();
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#bg-kind')).toHaveValue('colour');
  await expect(page.locator('#bg-colour')).toHaveValue('#0000ff');
  await expect(page.locator('#bg-brightness')).toHaveValue('0.8');
});

test('background: a damaged stored one loads cleaned up', async ({ page }) => {
  await start(page, { 'hallucinate.screenBackground': JSON.stringify({ kind: 'gradient', colour: 'red', colour2: '#00FF00', angle: 999, brightness: 'max' }) });
  await expect(page.locator('#bg-kind')).toHaveValue('gradient');
  await expect(page.locator('#bg-colour2')).toHaveValue('#00ff00');
  await expect(page.locator('#bg-angle')).toHaveValue('360');
  await expect(page.locator('#bg-brightness')).toHaveValue('0.5');
});

// Library previews show scenes, not show scenes: a background on the main screen doesn't reach them.
test('background: library previews show scenes without a background', async ({ page }) => {
  test.setTimeout(2 * 60_000);
  await start(page);
  await page.locator('#bg-kind').selectOption('colour');
  await page.locator('#bg-colour').fill('#0000ff');
  await brightest(page);
  await press(page, 'l');
  const preview = page.locator('.lib-card', { hasText: 'Night' }).locator('img');
  await expect(preview).toHaveAttribute('src', /^blob:/, { timeout: 60_000 });   // previews render two at a time
  const px = await preview.evaluate((img: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(Math.floor(img.naturalWidth / 4), Math.floor(img.naturalHeight / 2), 1, 1).data.slice(0, 3)] as Rgb;
  });
  expect(isBlack(px), "Night's preview stays black beside its line").toBe(true);
});

// With the studio open the main screen is the Live monitor: a take puts the show scene's background on
// it, and capturing Live keeps it in the show scene.
test("background: a Take brings the show scene's background to the screen, and capturing Live keeps it", async ({ page }) => {
  const BLUE = { kind: 'colour', colour: '#0000ff', colour2: '#000000', angle: 90, brightness: 1, breathe: 0 };
  const cue = (name: string, background?: unknown) => ({ id: `id-${name}`, name, scene: 'Night', values: {}, look: {}, ...(background ? { background } : {}) });
  await start(page, { 'hallucinate.show': JSON.stringify({ cues: [cue('Night blue', BLUE), cue('Night plain')], mode: 'cut' }) });
  const storedCues = () => page.evaluate(() => JSON.parse(localStorage.getItem('hallucinate.show') ?? '{}').cues as { name: string; background?: { kind: string } }[]);

  await press(page, 'o');
  await expect(page.locator('#studio')).toBeVisible();
  await press(page, 't');
  await expect(page.locator('#st-live-name')).toHaveText('Night blue');
  await expect(page.locator('#bg-kind')).toHaveValue('colour');
  await expect(page.locator('#bg-colour')).toHaveValue('#0000ff');

  await page.selectOption('#st-add', '@live');
  await expect.poll(async () => (await storedCues()).at(-1)?.background?.kind).toBe('colour');

  await page.locator('#st-cues li', { hasText: 'Night plain' }).click();
  await press(page, 't');
  await expect(page.locator('#st-live-name')).toHaveText('Night plain');
  await expect(page.locator('#bg-kind')).toHaveValue('none');
});
