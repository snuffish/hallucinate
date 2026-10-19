import { expect, seedScenes, solidScene, test, type Page } from './fixtures';

// The editor's History: your typing, a template and a restore are versions, and they survive a reload.

const BLUE = solidScene('Blue Box', '0., 0., 1.');

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#scene-name')).toContainText('Blue Box');
  await page.locator('#auto').uncheck();   // stay on the scene being edited
  await page.locator('#auto').blur();      // shortcuts don't fire while a control has the focus
  await page.keyboard.press('e');
  await expect(page.locator('#editor')).toBeVisible();
}

test('history: typing and a template are versions; restoring one brings its code back, and it all survives a reload', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await seedScenes(page, [BLUE], { 'hallucinate.lastScene': 'user:Blue Box' });
  await start(page);
  const code = page.locator('#ed-code');
  await expect(code).toHaveValue(BLUE.body);

  const typed = 'void main() { fragColor = vec4(1., 1., 0., 1.); }';
  await code.fill(typed);
  await expect(page.locator('#ed-status')).toContainText('Compiled');
  await page.locator('#ed-template').selectOption({ label: 'Blank template' });
  await expect(code).not.toHaveValue(typed);

  // The template's @params bring up the Parameters widget, which floats over the editor's header.
  await page.locator('#ed-history').dispatchEvent('click');
  const who = page.locator('#ed-history-panel .ed-version .who');
  await expect(who).toHaveText(['Start from… · Blank template', 'You', 'Earlier code']);
  await page.locator('#ed-history-panel .ed-version', { hasText: 'You' }).click();
  await expect(page.locator('#ed-history-panel .code-diff pre .del')).toContainText('vec4(1., 1., 0., 1.)');
  await page.locator('#ed-history-restore').click();
  await expect(code).toHaveValue(typed);
  await expect(who.first()).toHaveText(/^Restored/);

  await start(page);
  await expect(code).toHaveValue(typed);
  await page.locator('#ed-history').dispatchEvent('click');
  await expect(who).toHaveCount(4);
});
