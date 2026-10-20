import { defineConfig } from '@playwright/test';

const port = 5199;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  // One at a time on CI: every page renders with software WebGL, and two workers on the runner's CPUs
  // starve the timing checks (the built-in scenes' job below exists for the same reason).
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: `http://localhost:${port}/`,
    viewport: { width: 1280, height: 720 },
    // CI uploads test-results/ on failure; these make it show what the page looked like.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Software WebGL2 for headless runs; AudioContext without a user gesture.
      args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    // CI runs the built-in scenes' pixel checks in a job of their own (E2E_SKIP_SCENES here): they keep
    // a CPU busy rendering for minutes, and the timing specs beside them would starve.
    { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: ['desktop.spec.ts', ...(process.env.E2E_SKIP_SCENES ? ['builtin-scenes.spec.ts'] : [])] },
    // The Electron app launches itself (e2e/desktop.spec.ts); it needs `npm run build:desktop` first.
    { name: 'desktop', testMatch: 'desktop.spec.ts' },
  ],
});
