import { expect, test as base, type Page } from '@playwright/test';

export * from '@playwright/test';

// The controls fade out 3 s after the last mouse or key event while music plays (body.idle).
// A slow runner can leave that gap between two steps; Playwright then never moves the mouse,
// since the canvas is on top, so nothing wakes them. Keep them up in the browser specs.
const AWAKE = `
  body.idle #widgets:not(.collapsed):not(.dragging) > *,
  body.idle .ai-bubble { opacity: 1 !important; pointer-events: auto !important; }
`;

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript((css) => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.append(style);
      });
    }, AWAKE);
    await use(page);
  },
});

// Specs that need particular scenes save their own first, so they don't depend on the built-ins.
export interface SavedScene { name: string; body: string }
export const solidScene = (name: string, rgb: string): SavedScene => ({ name, body: `void main() { fragColor = vec4(${rgb}, 1.); }` });

// Stores `scenes` as your saved scenes (and any other keys) before the app first loads, once per
// test: a reload keeps whatever the app wrote since.
export async function seedScenes(page: Page, scenes: SavedScene[], storage: Record<string, string> = {}) {
  await page.addInitScript(({ scenes, storage }) => {
    if (sessionStorage.getItem('seeded-scenes')) return;
    localStorage.setItem('hallucinate.userScenes', JSON.stringify(scenes));
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    sessionStorage.setItem('seeded-scenes', '1');
  }, { scenes, storage });
}

// Opens the app and starts the demo beat.
export async function startDemo(page: Page, url = '/') {
  await page.goto(url);
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
}

// The average colour of a `size`-pixel patch at (0.6, 0.5) of the screen. The WebGL canvas can't be read
// back after it is composited, so this decodes a screenshot in the page.
export async function centreColour(page: Page, size: number): Promise<[number, number, number]> {
  const { width, height } = page.viewportSize()!;
  const png = await page.screenshot({ clip: { x: width * 0.6 - size / 2, y: height * 0.5 - size / 2, width: size, height: size } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height).getContext('2d')!;
    c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, img.width, img.height).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k]! += d[i + k]!;
    return sum.map((v) => v / (d.length / 4)) as [number, number, number];
  }, png.toString('base64'));
}

// `seconds` of 8-bit mono silence as a WAV file.
export function silentWav(seconds: number): Buffer {
  const rate = 8000, samples = rate * seconds;
  const b = Buffer.alloc(44 + samples);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(samples, 40); b.fill(128, 44);
  return b;
}
