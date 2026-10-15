import { defineConfig } from '@playwright/test';

const port = 5199;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
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
    { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: 'desktop.spec.ts' },
    // The Electron app launches itself (e2e/desktop.spec.ts); it needs `npm run build:desktop` first.
    { name: 'desktop', testMatch: 'desktop.spec.ts' },
  ],
});
