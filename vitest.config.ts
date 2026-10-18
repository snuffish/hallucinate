import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'desktop/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
});
