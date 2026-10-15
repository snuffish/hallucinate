import { expect, test, type Page } from '@playwright/test';

// The widgets fade out and ignore the pointer 3 s after the mouse last moved, and headless software
// WebGL can make a click's stability wait outlast that. So fold with the keyboard, like a user tabbing in.
async function toggle(page: Page, group: string) {
  await page.locator(`#params-list .param-group[data-group="${group}"] .param-group-head`).focus();
  await page.keyboard.press('Enter');
}

async function playScene(page: Page, search: string, name: string) {
  await page.keyboard.press('l');
  await page.keyboard.press('/');
  await page.keyboard.type(search);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#scene-name')).toContainText(name);
}

test('parameters: @group sections fold, stay folded across a reload, and ungrouped scenes stay flat', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#params')).toBeVisible();
  await expect(page.locator('#params-list .param').first()).toBeVisible();
  await expect(page.locator('#params-list .param-group')).toHaveCount(0);   // the first scene has no groups

  await playScene(page, 'tesseract', 'Tesseract');
  const groups = page.locator('#params-list .param-group');
  await expect.poll(() => groups.evaluateAll((els) => els.map((e) => `${e.getAttribute('data-group')}:${e.querySelectorAll('.param').length}`)))
    .toEqual(['Motion:2', 'Shape:2', 'Glow:3', 'Colour:2', 'Travelling dots:3']);

  const dots = page.locator('#params-list .param-group[data-group="Travelling dots"]');
  await expect(dots.locator('.param')).toHaveCount(3);
  await toggle(page, 'Travelling dots');
  await expect(dots.locator('.param-group-head')).toHaveAttribute('aria-expanded', 'false');
  await expect(dots.locator('.param')).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await playScene(page, 'tesseract', 'Tesseract');
  await expect(dots.locator('.param-group-head')).toHaveAttribute('aria-expanded', 'false');
  await toggle(page, 'Travelling dots');
  await expect(dots.locator('.param')).toHaveCount(3);
});
