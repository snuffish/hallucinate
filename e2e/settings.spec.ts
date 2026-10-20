import { readFile } from 'node:fs/promises';
import { SettingsPatchSchema, type SettingsView, type Source } from '../src/assistant/settings-wire';
import { expect, test, type Page } from './fixtures';

async function openApp(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
}

const settings = (page: Page) => page.locator('#settings');
const storedPrefs = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('hallucinate.prefs') ?? 'null'));

test('opens from the comma key, the gear and the ☰ menu; Esc closes it', async ({ page }) => {
  await openApp(page);
  await expect(settings(page)).toBeHidden();

  await page.keyboard.press(',');
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toBeHidden();

  await page.locator('#settings-btn').click();
  await expect(settings(page)).toBeVisible();
  await page.locator('#settings-close').click();
  await expect(settings(page)).toBeHidden();

  await page.locator('#widgets-menu-btn').click();
  await page.locator('#open-settings').click();
  await expect(settings(page)).toBeVisible();
  await expect(page.locator('#widgets-menu')).toBeHidden();

  // One overlay at a time: the library replaces it.
  await page.keyboard.press('Escape');
  await page.keyboard.press(',');
  await page.keyboard.press('l');
  await expect(page.locator('#library')).toBeVisible();
  await expect(settings(page)).toBeHidden();
});

test('changes are kept across a reload and left out of the export', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press(',');
  await page.locator('#settings-tab-interface').click();
  await page.locator('#pref-idle').selectOption('never');
  await page.locator('#pref-kbd').uncheck();
  await expect(page.locator('body')).toHaveAttribute('data-kbd', 'off');
  await expect(page.locator('#settings-btn .kbd')).toBeHidden();

  await expect.poll(() => storedPrefs(page)).toMatchObject({ v: 1, idleHideSeconds: null, showKeyBadges: false });
  await page.reload();
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-kbd', 'off');
  await page.keyboard.press(',');
  await page.locator('#settings-tab-interface').click();
  await expect(page.locator('#pref-idle')).toHaveValue('never');
  await expect(page.locator('#pref-kbd')).not.toBeChecked();

  // The shortcut sheet still lists every key.
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await expect(page.locator('.help-keys .kbd').first()).toBeVisible();
  await page.keyboard.press('Escape');

  const download = page.waitForEvent('download');
  await page.locator('#widgets-menu-btn').click();
  await page.locator('#export-settings').click();
  const json = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(Object.keys(json.data)).not.toContain('prefs');
  expect(JSON.stringify(json)).not.toContain('idleHideSeconds');
});

test('two tabs stay in step: a change in one is not undone by the other', async ({ page, context }) => {
  await openApp(page);
  const other = await context.newPage();
  await openApp(other);

  await page.keyboard.press(',');
  await page.locator('#settings-tab-interface').click();
  await page.locator('#pref-idle').selectOption('10');

  await other.keyboard.press(',');
  await other.locator('#settings-tab-interface').click();
  await expect(other.locator('#pref-idle')).toHaveValue('10');
  await other.locator('#pref-kbd').uncheck();
  // Stored by its own writer, not the pagehide flush on close: on a loaded CI runner Chromium can tear the
  // tab down before that runs. 15 s: with two tabs rendering, an evaluate can wait seconds for the page.
  const both = { idleHideSeconds: 10, showKeyBadges: false };
  await expect.poll(() => storedPrefs(other), { timeout: 15_000 }).toMatchObject(both);
  await other.close();

  await expect.poll(() => storedPrefs(page), { timeout: 15_000 }).toMatchObject(both);
  await expect(page.locator('#pref-kbd')).not.toBeChecked();
});

test.describe('on a 2× screen', () => {
  test.use({ deviceScaleFactor: 2 });

  test('pixel density caps what the main canvas renders', async ({ page }) => {
    await openApp(page);
    const ratio = () => page.locator('#gl').evaluate((c: HTMLCanvasElement) => c.width / c.clientWidth);
    // 15 s: the canvas takes the new size on a later frame, and a 2× frame under software WebGL can take seconds.
    const settled = { timeout: 15_000 };
    await expect.poll(ratio, settled).toBeCloseTo(2, 1);

    await page.keyboard.press(',');
    await page.locator('#pref-pixel-ratio').selectOption('1');
    await expect.poll(ratio, settled).toBeCloseTo(1, 1);
    await page.locator('#pref-pixel-ratio').selectOption('1.5');
    await expect.poll(ratio, settled).toBeCloseTo(1.5, 1);
  });
});

// The server's side (precedence, the keychain, locking) is unit-tested in server/settings-route.test.ts;
// here it is stubbed, so a test never writes the developer's real ~/.config/hallucinate. It answers in the
// shapes of src/assistant/settings-wire.ts and takes only what the real one would.
function settingsServer(page: Page, initial: Partial<SettingsView> = {}) {
  const f = <T>(value: T, source: Source = 'default') => ({ value, source, locked: source === 'env' });
  const state: SettingsView = {
    backend: f('auto'), model: f(null), effort: f('low', 'env'), directorEffort: f('low'),
    apiKey: { set: false, source: 'default', locked: false, editable: true, unreadable: false },
    detected: 'claude-code', canWrite: true,
    options: { backends: ['auto', 'api', 'claude-code'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], apiModels: ['claude-opus-5-5', 'claude-haiku-5-5'], defaultModel: 'claude-opus-5-5' },
    env: { backend: 'ASSISTANT_BACKEND', model: 'ASSISTANT_MODEL', effort: 'ASSISTANT_EFFORT', directorEffort: 'ASSISTANT_DIRECTOR_EFFORT', apiKey: 'ANTHROPIC_API_KEY' },
    paths: { claudeBin: 'claude', ytdlp: 'yt-dlp' },
    ...initial,
  };
  const posts: unknown[] = [];
  let infoRequests = 0;
  void page.route('**/api/assistant/info', (route) => { infoRequests++; return route.fulfill({ json: { backend: state.detected, model: null } }); });
  void page.route('**/api/settings', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: state });
    const body: unknown = route.request().postDataJSON();
    posts.push(body);
    const parsed = SettingsPatchSchema.safeParse(body);
    if (!parsed.success) return route.fulfill({ status: 400, json: { error: 'Bad settings' } });
    const patch = parsed.data;
    if ('model' in patch && patch.model === 'gpt-5') return route.fulfill({ status: 400, json: { error: '"gpt-5" isn\'t a model the Anthropic API offers.' } });
    if ('backend' in patch) { state.backend = f(patch.backend ?? 'auto', patch.backend ? 'settings' : 'default'); state.detected = patch.backend === 'api' ? 'api' : 'claude-code'; }
    if ('model' in patch) state.model = f(patch.model ?? null, patch.model ? 'settings' : 'default');
    if ('apiKey' in patch) state.apiKey = { ...state.apiKey, set: patch.apiKey !== null, source: patch.apiKey ? 'settings' : 'default' };
    return route.fulfill({ json: state });
  });
  return { posts, infoRequests: () => infoRequests };
}

test('assistant: change the connection and model; the environment locks what it sets', async ({ page }) => {
  const server = settingsServer(page);
  await openApp(page);
  await page.keyboard.press(',');
  await page.locator('#settings-tab-assistant').click();
  await expect(page.locator('#settings-detected')).toContainText('your Claude subscription');
  await expect(page.locator('#ai-effort')).toBeDisabled();
  await expect(page.locator('#settings-pane')).toContainText('Set by ASSISTANT_EFFORT');

  const before = server.infoRequests();
  await page.locator('#ai-backend').selectOption('api');
  await expect(page.locator('#settings-detected')).toContainText('the Anthropic API');
  expect(server.posts.at(-1)).toEqual({ backend: 'api' });
  await expect.poll(server.infoRequests).toBeGreaterThan(before);   // the assistant's panel asks again

  await page.locator('#ai-model').fill('gpt-5');
  await page.locator('#ai-model').press('Enter');
  await expect(page.getByRole('alert')).toContainText('isn\'t a model the Anthropic API offers');
  await page.locator('#ai-model').fill('claude-haiku-5-5');
  await page.locator('#ai-model').press('Enter');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(server.posts.at(-1)).toEqual({ model: 'claude-haiku-5-5' });
});

test('assistant: an API key is sent once, then only shown as saved', async ({ page }) => {
  const server = settingsServer(page);
  await openApp(page);
  await page.keyboard.press(',');
  await page.locator('#settings-tab-assistant').click();
  await page.locator('#ai-key').fill('sk-ant-api03-test-key-0123456789');
  await page.locator('#ai-key').press('Enter');
  await expect(page.locator('#ai-key-status')).toHaveText('Saved, encrypted on this computer.');
  await expect(page.locator('#ai-key')).toHaveCount(0);
  expect(server.posts.at(-1)).toEqual({ apiKey: 'sk-ant-api03-test-key-0123456789' });
  await page.locator('#ai-key-remove').click();
  await expect(page.locator('#ai-key')).toBeVisible();
  expect(server.posts.at(-1)).toEqual({ apiKey: null });
});

test('assistant: a server without a keychain points to the environment instead', async ({ page }) => {
  settingsServer(page, { apiKey: { set: false, source: 'default', locked: false, editable: false, unreadable: false } });
  await openApp(page);
  await page.keyboard.press(',');
  await page.locator('#settings-tab-assistant').click();
  await expect(page.locator('#ai-key-status')).toContainText('ANTHROPIC_API_KEY');
  await expect(page.locator('#ai-key')).toHaveCount(0);
});

test('resolution is a live display setting, at 100% to start, and remembered', async ({ page }) => {
  // What the scenes render at, as the profiler sees it (?perf offers it).
  const scale = () => page.evaluate(() => (window as { __profiler?: { report(): { scale: number } | null } }).__profiler?.report()?.scale);
  await page.goto('/?perf');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#w-look')).toBeVisible();
  await expect(page.locator('#w-look #resolution')).toHaveCount(0);   // not part of the Look

  await page.keyboard.press(',');
  await expect(page.locator('#settings-tab-display')).toHaveAttribute('aria-selected', 'true');
  const field = page.locator('.settings-field', { has: page.locator('#pref-resolution') });
  await expect(field).toContainText('Resolution · 100%');
  await expect(page.locator('#pref-resolution')).toHaveValue('1');
  await expect.poll(scale).toBe(1);

  await page.locator('#pref-resolution').fill('0.5');   // takes effect now, no restart
  await expect(field).toContainText('Resolution · 50%');
  await expect.poll(scale).toBe(0.5);
  await expect.poll(() => storedPrefs(page)).toMatchObject({ resolution: 0.5 });

  await page.reload();
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect.poll(scale).toBe(0.5);
  await page.keyboard.press(',');
  await expect(page.locator('#pref-resolution')).toHaveValue('0.5');
});
