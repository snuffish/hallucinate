import { defineConfig, type ViteDevServer, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createBridge, SITES } from './server/ytdlp-bridge.js';
import { createAssistant } from './server/assistant';

// The yt-dlp bridges (SoundCloud audio, YouTube video) and the AI assistant run as middleware in
// both `vite` (dev) and `vite preview` (built app).
function apiMiddleware() {
  const mount = (server: ViteDevServer | PreviewServer) => {
    for (const site of Object.keys(SITES)) server.middlewares.use(`/api/${site}/`, createBridge(site));
    server.middlewares.use('/api/assistant', createAssistant());
  };
  return { name: 'hallucinate-api', configureServer: mount, configurePreviewServer: mount };
}

// Listens on localhost only; set HOST=0.0.0.0 to open it to your network.
const host = process.env.HOST || 'localhost';
const port = Number(process.env.PORT) || 5173;
// The GitHub Pages build is served from /hallucinate/.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [react(), apiMiddleware()],
  server: { host, port },
  preview: { host, port },
  // Two pages: the app, and the projector window it opens.
  build: { rollupOptions: { input: { main: 'index.html', output: 'output.html' } } },
});
