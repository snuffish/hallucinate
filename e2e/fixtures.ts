import { test as base } from '@playwright/test';

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

// The app ships no built-in scenes yet (ADR 0001), so specs that need scenes save their own first.
export interface SavedScene { name: string; body: string }
export const solidScene = (name: string, rgb: string): SavedScene => ({ name, body: `void main() { fragColor = vec4(${rgb}, 1.); }` });

// Stores `scenes` as your saved scenes (and any other keys) before the app first loads, once per
// test: a reload keeps whatever the app wrote since.
export async function seedScenes(page: import('@playwright/test').Page, scenes: SavedScene[], storage: Record<string, string> = {}) {
  await page.addInitScript(({ scenes, storage }) => {
    if (sessionStorage.getItem('seeded-scenes')) return;
    localStorage.setItem('hallucinate.userScenes', JSON.stringify(scenes));
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    sessionStorage.setItem('seeded-scenes', '1');
  }, { scenes, storage });
}
