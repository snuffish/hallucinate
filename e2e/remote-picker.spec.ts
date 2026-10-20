import { expect, silentWav, test, type Page } from './fixtures';

// The SoundCloud picker against a stubbed /api/soundcloud: what the bridge answers (src/remote/wire.ts),
// without yt-dlp or the network.

const NIGHT = { url: 'https://soundcloud.com/someone/night-drive', title: 'Night drive', artist: 'Someone', duration: 245, artwork: null };
const LIVE = { url: 'https://soundcloud.com/someone/live-set', title: 'Live set', artist: '', duration: null, artwork: null };

const event = (name: string, data: object) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

async function openAndSearch(page: Page, fetchBody: string) {
  await page.route('**/api/soundcloud/search?**', (r) => r.fulfill({ json: { results: [NIGHT, LIVE] } }));
  await page.route('**/api/soundcloud/fetch?**', (r) => r.fulfill({ contentType: 'text/event-stream', body: fetchBody }));
  await page.route('**/api/soundcloud/file/**', (r) => r.fulfill({ contentType: 'audio/wav', body: silentWav(1) }));
  await page.goto('/');
  await page.locator('#start [data-source="soundcloud"]').click();
  await page.locator('#sc-query').fill('night');
  await page.locator('#sc-query').press('Enter');
  await expect(page.locator('#sc-status')).toHaveText('2 tracks — click one to play');
}

test('lists a track the server knows no duration for, downloads the pick and plays it', async ({ page }) => {
  await openAndSearch(page,
    event('progress', { percent: 40, stage: 'audio', bytes: 400, total: 1000, speed: null, eta: null })
    + event('done', { src: '/api/soundcloud/file/live.wav' }));
  const rows = page.locator('#sc-results li');
  await expect(rows.nth(0).locator('time')).toHaveText('4:05');
  await expect(rows.nth(1).locator('time')).toHaveText('');
  await rows.nth(1).click();
  await expect(page.locator('#now')).toContainText('Live set');
  await expect(page.locator('#sc')).toBeHidden();
});

test("shows the server's reason when a download fails", async ({ page }) => {
  await openAndSearch(page, event('failed', { error: 'This track is not available in your country' }));
  await page.locator('#sc-results li').first().click();
  await expect(page.locator('#sc-status')).toHaveText('This track is not available in your country');
  await expect(page.locator('#sc-status')).toHaveClass(/error/);
});
