import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from './fixtures';

const GOOD = 'void main() { fragColor = vec4(1.); }';
const BROKEN = 'void main() { nope }';
const cue = (name: string) => ({ id: `id-${name}`, name, scene: name, values: {}, look: {} });

async function openApp(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
}

async function menuItem(page: Page, id: string) {
  await page.locator('#widgets-menu-btn').click();
  await page.locator(id).click();
}

const bundle = (data: object) => ({ name: 'my-setup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'hallucinate', version: 1, data })) });

test('export: the file holds the stored scenes, show and favourites', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(({ GOOD, show }) => {
    localStorage.setItem('hallucinate.userScenes', JSON.stringify([{ name: 'Mine', body: GOOD }]));
    localStorage.setItem('hallucinate.show', JSON.stringify(show));
    localStorage.setItem('hallucinate.library', JSON.stringify({ favs: ['Mine'], off: [] }));
  }, { GOOD, show: { cues: [cue('Mine')] } });
  await openApp(page);

  const download = page.waitForEvent('download');
  await menuItem(page, '#export-settings');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^hallucinate-.*\.json$/);
  const json = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(json).toMatchObject({ format: 'hallucinate', version: 1 });
  expect(json.data.userScenes).toEqual([{ name: 'Mine', body: GOOD }]);
  expect(json.data.show.cues[0].scene).toBe('Mine');
  expect(json.data.library.favs).toEqual(['Mine']);
  expect(json.data).not.toHaveProperty('scRecent');
});

test('import: backs up, replaces, reloads and reports; a shader that does not compile here is kept', async ({ page }) => {
  await openApp(page);
  page.on('dialog', (d) => void d.accept());
  const backup = page.waitForEvent('download');
  const reloaded = page.waitForEvent('load');
  await page.locator('#settings-file').setInputFiles(bundle({
    userScenes: [{ name: 'Mine', body: GOOD }, { name: 'Broken here', body: BROKEN }],
    show: { cues: [cue('Mine')] },
    library: { favs: ['Mine'], off: [] },
  }));
  expect((await backup).suggestedFilename()).toMatch(/^hallucinate-before-import-.*\.json$/);
  await reloaded;

  await expect(page.locator('#toast')).toContainText('Imported 2 scenes, a show with 1 cue, favourites');
  await expect(page.locator('#toast')).toContainText('Broken here');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await page.keyboard.press('l');
  await expect(page.locator('#lib-grid .lib-card', { hasText: 'Mine' }).locator('.lib-fav')).toHaveText('★');
  await expect(page.locator('#lib-parked [data-parked-scene="Broken here"]')).toBeVisible();
});

test('a parked scene survives saving another scene, and saving under its name replaces it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(({ GOOD, BROKEN }) => {
    localStorage.setItem('hallucinate.userScenes', JSON.stringify([{ name: 'Mine', body: GOOD }, { name: 'Broken here', body: BROKEN }]));
  }, { GOOD, BROKEN });
  await openApp(page);
  const answers = ['Brand new', 'Broken here', true];   // two "Save to library" names, then "replace it?"
  page.on('dialog', (d) => { const a = answers.shift(); void (typeof a === 'string' ? d.accept(a) : d.accept()); });

  await page.keyboard.press('l');
  await page.locator('#lib-parked [data-parked-scene="Broken here"] button', { hasText: 'Fix in editor' }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#ed-code')).toHaveValue(BROKEN);
  await page.locator('#ed-code').fill(GOOD);
  await page.locator('#ed-save').click();                   // saved as "Brand new"
  await expect(page.locator('#toast')).toContainText('Saved "Brand new"');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hallucinate.userScenes')!).map((s: { name: string }) => s.name)))
    .toEqual(['Mine', 'Brand new', 'Broken here']);

  await page.locator('#ed-save').click();                   // saved as "Broken here": the parked copy is replaced
  await expect(page.locator('#toast')).toContainText('Saved "Broken here"');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hallucinate.userScenes')!));
  expect(stored).toEqual([{ name: 'Mine', body: GOOD }, { name: 'Brand new', body: GOOD }, { name: 'Broken here', body: GOOD }]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await expect(page.locator('#lib-parked')).toHaveCount(0);
});

test('import: an invalid file changes nothing and says why', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('hallucinate.library', JSON.stringify({ favs: ['Star Nest'], off: [] })));
  await openApp(page);
  await page.locator('#settings-file').setInputFiles(bundle({ library: { favs: 'all of them' } }));
  await expect(page.locator('#toast')).toContainText('The "library" section is broken');
  expect(await page.evaluate(() => localStorage.getItem('hallucinate.library'))).toBe(JSON.stringify({ favs: ['Star Nest'], off: [] }));
});

test('import: another open tab reloads instead of writing its old state back', async ({ page, context }) => {
  const other = await context.newPage();
  await openApp(other);
  await openApp(page);
  page.on('dialog', (d) => void d.accept());
  const otherReloaded = other.waitForEvent('load');
  const reloaded = page.waitForEvent('load');
  await page.locator('#settings-file').setInputFiles(bundle({ library: { favs: ['Star Nest'], off: [] } }));
  await Promise.all([otherReloaded, reloaded]);
  expect(await other.evaluate(() => localStorage.getItem('hallucinate.library'))).toBe(JSON.stringify({ favs: ['Star Nest'], off: [] }));
});
