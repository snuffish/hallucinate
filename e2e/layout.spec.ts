import { expect, test, type Locator, type Page } from './fixtures';

type Box = { x: number; y: number; width: number; height: number };

async function start(page: Page) {
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
}

// Drags by a point near the left of the handle (the title, not a header button) to (x, y), in steps
// so pointermove fires along the way.
async function dragTo(page: Page, handle: Locator, x: number, y: number) {
  await handle.scrollIntoViewIfNeeded();
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + 16, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 30, b.y + b.height / 2, { steps: 3 });
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
}

const box = async (l: Locator) => (await l.boundingBox()) as Box;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('layout: dock a widget to an edge, it stays there after a reload, and no overlay covers it', async ({ page }) => {
  await page.goto('/');
  await start(page);
  await dragTo(page, page.locator('#w-look > header'), 1270, 360);
  await expect(page.locator('.dock-zone.right #w-look')).toBeVisible();
  await expect(page.locator('.dock-zone.left #w-look')).toHaveCount(0);

  await page.locator('#w-media .widget-collapse').click();
  await expect(page.locator('#w-media .widget-body')).toBeHidden();

  await page.reload();
  await start(page);
  await expect(page.locator('.dock-zone.right #w-look')).toBeVisible();
  await expect(page.locator('#w-media .widget-body')).toBeHidden();

  // Editor and studio inset themselves by the docks.
  for (const [key, id] of [['e', '#editor'], ['o', '#studio']] as const) {
    await page.keyboard.press(key);
    await expect(page.locator(id)).toBeVisible();
    await expect.poll(async () => overlaps(await box(page.locator('#w-look')), await box(page.locator(id)))).toBe(false);
    await expect.poll(async () => overlaps(await box(page.locator('#w-source')), await box(page.locator(id)))).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.locator(id)).toBeHidden();
  }
  // The library and the visual maker take the whole screen: the widgets step aside.
  for (const [key, id] of [['l', '#library'], ['n', '#nodes']] as const) {
    await page.keyboard.press(key);
    await expect(page.locator(id)).toBeVisible();
    await expect(page.locator('#w-source')).toBeHidden();
    await expect(page.locator('#hub')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#w-source')).toBeVisible();
  }

  await page.keyboard.press('Shift+H');
  await expect(page.locator('.dock-zone.left #w-look')).toBeVisible();
  await expect(page.locator('#w-media .widget-body')).toBeVisible();
});

test('layout: reorder inside a dock, close a widget and bring it back from the menu', async ({ page }) => {
  await page.goto('/');
  await start(page);
  // Drop Scene just above Source (between the Hallucinate widget and Source).
  await page.locator('#w-scene > header').scrollIntoViewIfNeeded();
  const source = await box(page.locator('#w-source'));
  await dragTo(page, page.locator('#w-scene > header'), source.x + 100, source.y + 10);
  await expect.poll(() => page.locator('.dock-zone.left > .widget').evaluateAll((els) => els.map((e) => e.id).slice(0, 3))).toEqual(['hub', 'w-scene', 'w-source']);

  await page.locator('#w-audio .widget-close').click();
  await expect(page.locator('#w-audio')).toHaveCount(0);
  await page.locator('#widgets-menu-btn').click();
  await expect(page.locator('#widgets-menu')).toBeVisible();
  await page.locator('[data-widget-toggle="audio"]').check();
  await expect(page.locator('#w-audio')).toBeVisible();

  // The assistant's bubble is switched off and on from the same menu, and stays off after a reload.
  await page.locator('[data-widget-toggle="assistant"]').uncheck();
  await expect(page.locator('#assistant-bubble')).toHaveCount(0);
  await page.reload();
  await start(page);
  await expect(page.locator('#assistant-bubble')).toHaveCount(0);
  await page.locator('#widgets-menu-btn').click();
  await page.locator('[data-widget-toggle="assistant"]').check();
  await expect(page.locator('#assistant-bubble')).toBeVisible();

  // The assistant's bubble is switched off and on from the same menu, and stays off after a reload.
  await page.locator('[data-widget-toggle="assistant"]').uncheck();
  await expect(page.locator('#assistant-bubble')).toHaveCount(0);
  await page.reload();
  await start(page);
  await expect(page.locator('#assistant-bubble')).toHaveCount(0);
  await page.locator('#widgets-menu-btn').click();
  await page.locator('[data-widget-toggle="assistant"]').check();
  await expect(page.locator('#assistant-bubble')).toBeVisible();
});

test('layout: a floating widget stays on screen when the window shrinks', async ({ page }) => {
  await page.goto('/');
  await start(page);
  await dragTo(page, page.locator('#w-scene > header'), 1000, 500);
  await expect(page.locator('#w-scene.floating')).toBeVisible();
  await page.setViewportSize({ width: 800, height: 600 });
  await expect.poll(async () => {
    const b = await box(page.locator('#w-scene > header'));
    return b.x >= 0 && b.y >= 0 && b.x + b.width <= 800 && b.y + b.height <= 600;
  }).toBe(true);
});

test('layout: the assistant bubble can be moved; a drag does not open the chat', async ({ page }) => {
  await page.goto('/');
  await start(page);
  const bubble = page.locator('#assistant-bubble');
  await dragTo(page, bubble, 1200, 60);
  await expect(page.locator('#ai')).toBeHidden();
  await expect(bubble).toHaveClass(/moved/);

  await bubble.click();
  await expect(page.locator('#ai')).toBeVisible();
  const chat = await box(page.locator('#ai'));
  const b = await box(bubble);
  expect(chat.x).toBeGreaterThanOrEqual(0);
  expect(chat.x + chat.width).toBeLessThanOrEqual(1280);
  expect(chat.y).toBeGreaterThan(b.y + b.height - 1);   // opens below a bubble at the top
  expect(chat.y + chat.height).toBeLessThanOrEqual(720);
  await page.keyboard.press('Escape');

  await page.reload();
  await start(page);
  await expect(bubble).toHaveClass(/moved/);
  const after = await box(bubble);
  expect(after.x).toBeGreaterThan(1000);
  expect(after.y).toBeLessThan(150);

  await page.keyboard.press('Shift+H');
  await expect(bubble).not.toHaveClass(/moved/);
});

async function dragBy(page: Page, grip: Locator, dx: number, dy: number) {
  await grip.scrollIntoViewIfNeeded();
  const b = (await grip.boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

test('layout: widgets and docks resize, and keep their size after a reload', async ({ page }) => {
  test.slow();   // many drags before the reload; a CI runner needs more than 60 s
  await page.goto('/');
  await start(page);
  // A floating widget, by its corner.
  await dragTo(page, page.locator('#w-scene > header'), 900, 300);
  const before = await box(page.locator('#w-scene'));
  await dragBy(page, page.locator('#w-scene > .grip.corner'), 90, 70);
  await expect.poll(async () => Math.round((await box(page.locator('#w-scene'))).width - before.width)).toBe(90);
  await expect.poll(async () => Math.round((await box(page.locator('#w-scene'))).height - before.height)).toBe(70);

  // The left dock, by its inner edge: every widget in it gets wider, and the studio makes room.
  const source = await box(page.locator('#w-source'));
  await dragBy(page, page.locator('#w-source > .grip.width'), 60, 0);
  await expect.poll(async () => Math.round((await box(page.locator('#w-source'))).width - source.width)).toBe(60);
  await expect.poll(async () => Math.round((await box(page.locator('#w-media'))).width - source.width)).toBe(60);

  // A docked widget's height, by its bottom edge: shorter, and its body scrolls.
  const look = await box(page.locator('#w-look'));
  await dragBy(page, page.locator('#w-look > .grip.height'), 0, -150);
  await expect.poll(async () => Math.round(look.height - (await box(page.locator('#w-look'))).height)).toBe(150);
  expect(await page.locator('#w-look .widget-body').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  await page.reload();
  await start(page);
  expect(Math.round((await box(page.locator('#w-scene'))).width - before.width)).toBe(90);
  expect(Math.round((await box(page.locator('#w-source'))).width - source.width)).toBe(60);
  expect(Math.round(look.height - (await box(page.locator('#w-look'))).height)).toBe(150);
  await page.keyboard.press('o');
  await expect.poll(async () => Math.round((await box(page.locator('#studio'))).x)).toBe(Math.round(source.x + source.width + 60 + 16));
  await page.keyboard.press('Escape');

  // Double-click a grip: back to the natural size. (Move the mouse first: the controls fade out and
  // ignore the pointer after 3 s without it.)
  await page.mouse.move(640, 360);
  await page.mouse.move(650, 370);
  await page.locator('#w-scene > .grip.corner').dblclick();
  await expect.poll(async () => Math.round((await box(page.locator('#w-scene'))).width)).toBe(Math.round(before.width));
});
