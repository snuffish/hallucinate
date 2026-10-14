import { expect, test } from '@playwright/test';

test('library: L opens it, / focuses search, arrows move through hits, Enter plays', async ({ page }) => {
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
  await page.keyboard.press('/');
  await page.keyboard.type('nest');
  await expect(page.locator('#lib-grid .lib-card')).toHaveCount(1);

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#lib-grid .lib-card.focused')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('#library')).toBeHidden();
  await expect(page.locator('#scene-name')).toContainText('Star Nest');
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
  for (const id of ['#open-library', '#play-game', '#code', '#visual', '#studio-open', '#assistant-bubble', '#randomize', '#fullscreen', '#record']) {
    await expect(page.locator(`${id} .kbd`)).toHaveCount(1);
  }
});
