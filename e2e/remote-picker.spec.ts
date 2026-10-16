import { expect, test, type Page } from './fixtures';

// The SoundCloud picker against a stubbed /api/soundcloud: what the bridge answers (src/remote/wire.ts),
// without yt-dlp or the network.

const NIGHT = { url: 'https://soundcloud.com/someone/night-drive', title: 'Night drive', artist: 'Someone', duration: 245, artwork: null };
const LIVE = { url: 'https://soundcloud.com/someone/live-set', title: 'Live set', artist: '', duration: null, artwork: null };

const event = (name: string, data: object) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

// One second of silence, for the picked track to play.
function silentWav(): Buffer {
  const rate = 8000, samples = rate;
  const b = Buffer.alloc(44 + samples);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(samples, 40); b.fill(128, 44);
  return b;
}

async function openAndSearch(page: Page, fetchBody: string) {
  await page.route('**/api/soundcloud/search?**', (r) => r.fulfill({ json: { results: [NIGHT, LIVE] } }));
  await page.route('**/api/soundcloud/fetch?**', (r) => r.fulfill({ contentType: 'text/event-stream', body: fetchBody }));
  await page.route('**/api/soundcloud/file/**', (r) => r.fulfill({ contentType: 'audio/wav', body: silentWav() }));
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
