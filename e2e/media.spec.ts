import { expect, test } from './fixtures';

// An 8×8 white PNG.
const WHITE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGP4jwMwDC0JALoev0Ewkwr8AAAAAElFTkSuQmCC', 'base64');

test('loading an image plays the Media scene and names it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#scene-name')).not.toContainText('Scan Trace');

  await page.locator('#media-file').setInputFiles({ name: 'white.png', mimeType: 'image/png', buffer: WHITE_PNG });
  await expect(page.locator('#scene-name')).toContainText('Scan Trace');
  await expect(page.locator('#toast')).toContainText('Image loaded — Scan Trace');
});
