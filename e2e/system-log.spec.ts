import { expect, test, type Page } from './fixtures';

const panel = (page: Page) => page.locator('#system-log');
const lines = (page: Page) => panel(page).locator('.syslog-line');
const command = (page: Page) => panel(page).getByRole('textbox', { name: 'Command' });

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
}

async function run(page: Page, line: string) {
  await command(page).fill(line);
  await command(page).press('Enter');
}

test('system log: Shift+S shows what the app and the console said before it opened, and hides it again', async ({ page }) => {
  await start(page);
  await expect(panel(page)).toBeHidden();
  await page.evaluate(() => console.warn('a warning from the page'));
  await page.keyboard.press('Shift+S');
  await expect(panel(page)).toBeVisible();
  await expect(lines(page).filter({ hasText: 'Music: demo' })).toHaveAttribute('data-source', 'app');
  await expect(lines(page).filter({ hasText: 'a warning from the page' })).toHaveAttribute('data-level', 'warn');
  await page.keyboard.press('Shift+S');
  await expect(panel(page)).toBeHidden();
});

test('system log: while closed, a badge counts the errors; opening the log sees them', async ({ page }) => {
  await start(page);
  const badge = page.locator('#log-badge');
  await expect(badge).toBeHidden();
  await page.evaluate(() => { console.error('boom'); console.error(new Error('bang')); });
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('2 errors');
  await badge.click();
  await expect(panel(page)).toBeVisible();
  await expect(badge).toBeHidden();
  const bang = lines(page).filter({ hasText: 'Error: bang' });
  await bang.getByRole('button').click();   // its stack opens with a click
  await expect(bang.locator('pre')).toContainText('at ');
});

test('system log: the levels, the source and the search narrow it; clear empties it', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Shift+S');
  await page.evaluate(() => { console.error('needle error'); console.info('needle info'); console.info('hay'); });
  await expect(lines(page).filter({ hasText: 'needle info' })).toBeVisible();
  await panel(page).getByRole('button', { name: /^Info/ }).click();
  await expect(lines(page).filter({ hasText: 'needle info' })).toHaveCount(0);
  await expect(lines(page).filter({ hasText: 'needle error' })).toBeVisible();
  await panel(page).getByRole('button', { name: /^Info/ }).click();
  await panel(page).getByRole('searchbox', { name: 'Search the log' }).fill('needle');
  await expect(lines(page)).toHaveCount(2);
  await panel(page).getByRole('combobox', { name: 'Source' }).selectOption('app');
  await expect(lines(page)).toHaveCount(0);
  await panel(page).getByRole('combobox', { name: 'Source' }).selectOption('all');
  await panel(page).getByRole('searchbox', { name: 'Search the log' }).fill('');
  await run(page, 'clear');
  await expect(lines(page)).toHaveCount(0);
  await expect(panel(page)).toContainText('Nothing logged yet.');
});

test('system log: commands run the assistant\'s tools by name, and ↑ brings a command back after a reload', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Shift+S');
  await run(page, 'help switch_scene');
  await expect(lines(page).filter({ hasText: 'help switch_scene' }).last()).toBeVisible();
  await run(page, 'switch_scene scene=Vortex');
  await expect(lines(page).filter({ hasText: 'Scene: Vortex' })).toBeVisible();
  await run(page, 'switch_scene scene="No Such Scene"');
  await expect(lines(page).filter({ hasText: 'There\'s no scene called "No Such Scene"' })).toHaveAttribute('data-level', 'error');
  await run(page, 'set_look {"hue": 0.42}');
  await expect(lines(page).filter({ hasText: '"applied"' })).toBeVisible();
  await run(page, 'undo');
  await expect(lines(page).filter({ hasText: 'Undid: ' })).toBeVisible();
  await run(page, 'nonsense');
  await expect(lines(page).filter({ hasText: 'Unknown command "nonsense"' })).toBeVisible();

  await start(page);
  await page.keyboard.press('Shift+S');
  await command(page).press('ArrowUp');
  await command(page).press('ArrowUp');
  await expect(command(page)).toHaveValue('undo');
});

test('system log: it follows the local server\'s lines', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Shift+S');
  await page.evaluate(() => fetch('/api/settings'));
  await expect(lines(page).filter({ hasText: 'GET /api/settings' }).first()).toHaveAttribute('data-source', 'server');
});

test('system log: drag it by its top; it opens there again after a reload, and a double-click puts it back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await start(page);
  await page.keyboard.press('Shift+S');
  const corner = (await panel(page).boundingBox())!;
  const grab = (await panel(page).locator('.syslog-head b').boundingBox())!;
  await page.mouse.move(grab.x + 5, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(grab.x + 105, grab.y + 100, { steps: 8 });
  await page.mouse.move(grab.x + 205, grab.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect(panel(page)).toHaveClass(/\bmoved\b/);
  const moved = (await panel(page).boundingBox())!;
  expect(moved.x).toBeCloseTo(corner.x + 200, -1);

  await start(page);
  await page.keyboard.press('Shift+S');
  const again = (await panel(page).boundingBox())!;
  expect(again.x).toBeCloseTo(moved.x, 0);
  expect(again.y).toBeCloseTo(moved.y, 0);
  await panel(page).locator('.syslog-head b').dblclick();
  await expect(panel(page)).not.toHaveClass(/\bmoved\b/);
});
