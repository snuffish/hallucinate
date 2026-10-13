import { defineConfig } from 'vite';
import { createBridge, SITES } from './server/ytdlp-bridge.js';
import { createAssistant } from './server/assistant.js';

// The yt-dlp bridges (SoundCloud audio, YouTube video: search / fetch / cached file with seeking)
// run as middleware in both `vite` (dev) and `vite preview` (built app).
function ytdlpApi() {
  const mount = (server) => {
    for (const site of Object.keys(SITES)) server.middlewares.use(`/api/${site}/`, createBridge(site));
    server.middlewares.use('/api/assistant', createAssistant());   // in-app AI assistant (Claude API)
  };
  return { name: 'ytdlp-api', configureServer: mount, configurePreviewServer: mount };
}

// Listens on localhost only; set HOST=0.0.0.0 to open it to your network.
const host = process.env.HOST || 'localhost';
const port = Number(process.env.PORT) || 5173;

export default defineConfig({
  plugins: [ytdlpApi()],
  server: { host, port },
  preview: { host, port },
  // Two pages: the app, and the projector window it opens.
  build: { rollupOptions: { input: { main: 'index.html', output: 'output.html' } } },
});
