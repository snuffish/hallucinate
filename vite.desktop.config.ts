import { defineConfig } from 'vite';

// The Electron main process (desktop/main.ts) and the server code it hosts, bundled into one ESM file so
// the packaged app needs no node_modules. `npm run build:desktop` builds the renderer (vite.config.ts) first.
export default defineConfig({
  build: {
    ssr: 'desktop/main.ts',
    outDir: 'dist-desktop',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: true,
    rollupOptions: {
      external: ['electron'],
      output: { entryFileNames: 'main.js' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
});
