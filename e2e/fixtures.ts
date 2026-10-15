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
