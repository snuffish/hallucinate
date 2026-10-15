// The desktop app (Electron) as it ships: the real main process, its own server and the built app.
// Run with `npm run test:e2e:desktop`, which builds dist/ and dist-desktop/ first.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 47799;   // not the real app's port, so a running Hallucinate doesn't get in the way
const MAIN = join(import.meta.dirname, '..', 'dist-desktop', 'main.js');

let app: ElectronApplication;
let page: Page;
let profile: string;

test.beforeAll(async () => {
  test.skip(!existsSync(MAIN), 'Build the desktop app first: npm run build:desktop');
  profile = mkdtempSync(join(tmpdir(), 'hallucinate-e2e-profile-'));
  app = await electron.launch({
    // The real GPU: Electron's GPU process crashes on the SwiftShader flags the browser tests use.
    args: ['.'],
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, HALLUCINATE_USER_DATA: profile, HALLUCINATE_PORT: String(PORT), ASSISTANT_BACKEND: 'api', HALLUCINATE_DEV_URL: '' },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  if (profile) rmSync(profile, { recursive: true, force: true });
});

test('desktop: serves the app and the API from its own fixed origin', async () => {
  await expect(page.getByRole('button', { name: 'Play demo beat' })).toBeVisible();
  expect(await page.evaluate(() => location.origin)).toBe(`http://127.0.0.1:${PORT}`);
  const info = await page.evaluate(() => fetch('/api/assistant/info').then((r) => r.json()));
  expect(info).toMatchObject({ backend: 'api' });
  expect(await page.title()).toBe('Hallucinate');
});

test('desktop: plays the demo beat without a click-to-start and lists displays', async () => {
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
  // The Window Management API works once the app grants it (Studio → Detect displays).
  const screens = await page.evaluate(async () => {
    const w = window as Window & { getScreenDetails?: () => Promise<{ screens: unknown[] }> };
    return w.getScreenDetails ? (await w.getScreenDetails()).screens.length : -1;
  });
  expect(screens).toBeGreaterThan(0);
});

test('desktop: opens a projector window that connects to the studio', async () => {
  await page.keyboard.press('o');
  await expect(page.locator('#studio')).toBeVisible();
  const [projector] = await Promise.all([app.waitForEvent('window'), page.locator('#st-open').click()]);
  await expect(projector).toHaveTitle('Hallucinate — Projector');
  await expect(page.locator('#st-out-status')).toContainText('Projector live', { timeout: 15_000 });
  expect(app.windows()).toHaveLength(2);
});

test('desktop: external links leave the app for the system browser', async () => {
  // Catch the hand-off in the main process instead of really opening a browser tab.
  await app.evaluate(({ shell }) => {
    const g = globalThis as typeof globalThis & { opened?: string[] };
    g.opened = [];
    shell.openExternal = async (url: string) => { g.opened!.push(url); };
  });
  const before = app.windows().length;
  await page.evaluate(() => { window.open('https://example.com/', '_blank'); window.open('file:///etc/hosts', '_blank'); });
  await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { opened?: string[] }).opened)).toEqual(['https://example.com/']);
  expect(app.windows()).toHaveLength(before);
  // Following a link in the page goes out once and the app stays where it is.
  await page.evaluate(() => { location.href = 'https://example.com/elsewhere'; });
  await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { opened?: string[] }).opened)).toEqual(['https://example.com/', 'https://example.com/elsewhere']);
  await page.waitForTimeout(300);
  expect(await app.evaluate(() => (globalThis as typeof globalThis & { opened?: string[] }).opened)).toHaveLength(2);
  expect(new URL(page.url()).origin).toBe(`http://127.0.0.1:${PORT}`);
});
