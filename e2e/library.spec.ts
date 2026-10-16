import { expect, seedScenes, solidScene, test } from './fixtures';

const SCENES = [solidScene('Red Room', '1., 0., 0.'), solidScene('Night Nest', '0., 0., .6'), solidScene('Green Field', '0., 1., 0.')];

test('library: L opens it, / focuses search, arrows move through hits, Enter plays', async ({ page }) => {
  await seedScenes(page, SCENES);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');

  await page.keyboard.press('l');
  await expect(page.locator('#library')).toBeVisible();
  await expect(page.locator('#lib-search')).not.toBeFocused();   // no auto-focus on open
  await page.keyboard.press('/');
  await expect(page.locator('#lib-search')).toBeFocused();
  // Escape leaves the field, the library stays; Tab cycles the categories.
  await page.keyboard.press('Escape');
  await expect(page.locator('#lib-search')).not.toBeFocused();
  await expect(page.locator('#library')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('#lib-filters button.active')).toHaveText('★ Favourites');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#lib-filters button.active')).toHaveText('All');
  // Only the categories that have scenes get a tab.
  await expect(page.locator('#lib-filters button')).toHaveText(['All', '★ Favourites', '⚙ Tweakable', 'Beams', 'Geometry', 'Fields', 'Mine']);
  await page.keyboard.press('/');
  await page.keyboard.type('nest');
  await expect(page.locator('#lib-grid .lib-card')).toHaveCount(1);

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#lib-grid .lib-card.focused')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('#library')).toBeHidden();
  await expect(page.locator('#scene-name')).toContainText('Night Nest');
});

test('every panel opens with its key, shows key badges, and closes with Escape', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  for (const [key, id] of [['l', '#library'], ['e', '#editor'], ['n', '#nodes'], ['o', '#studio']] as const) {
    await page.keyboard.press('Escape');
    await page.keyboard.press(key);
    await expect(page.locator(id)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(id)).toBeHidden();
  }
  // The assistant is a detached bubble: it opens next to the panel and closes with Escape or the bubble.
  await page.keyboard.press('i');
  await expect(page.locator('#ai')).toBeVisible();
  await expect(page.locator('#w-source')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ai')).toBeHidden();
  await page.locator('#assistant-bubble').click();
  await expect(page.locator('#ai')).toBeVisible();
  await page.locator('#assistant-bubble').click();
  await expect(page.locator('#ai')).toBeHidden();
  // The studio pins the main canvas over its Live monitor instead of moving it.
  await page.keyboard.press('o');
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('#gl')).toHaveAttribute('style', /width: \d/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#gl')).not.toHaveAttribute('style', /width: \d/);
  // Badges on the panel's bound buttons.
  for (const id of ['#open-library', '#code', '#visual', '#studio-open', '#assistant-bubble', '#randomize', '#fullscreen', '#record']) {
    await expect(page.locator(`${id} .kbd`)).toHaveCount(1);
  }
  await expect(page.locator('#play-game')).toHaveCount(0);   // no game button, and G is left unbound
});

test('the scene on screen comes back after a reload', async ({ page }) => {
  await seedScenes(page, SCENES);
  await page.goto('/');
  await expect(page.locator('#scene-name')).toContainText('Beam Fan');   // nothing to restore yet: the first built-in
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await page.keyboard.press('l');
  await page.keyboard.press('/');
  await page.keyboard.type('nest');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#scene-name')).toContainText('Night Nest');
  await page.locator('#auto').uncheck();   // so auto-switch doesn't move on before the reload

  await page.reload();
  await expect(page.locator('#scene-name')).toContainText('Night Nest');   // before any source starts
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#scene-name')).toContainText('Night Nest');
});
