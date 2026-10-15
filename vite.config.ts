import { defineConfig, type ViteDevServer, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import { allowedHostsFromEnv } from './server/guard';
import { apiRoutes } from './server/routes';

// The yt-dlp bridges (SoundCloud audio, YouTube video) and the AI assistant run as middleware in
// both `vite` (dev) and `vite preview` (built app). They sit in front of Vite's own host and CORS
// checks, so each route guards itself (server/guard.ts).
function apiMiddleware() {
  const mount = (server: ViteDevServer | PreviewServer) => {
    for (const [prefix, handler] of apiRoutes()) server.middlewares.use(prefix, handler);
  };
  return { name: 'hallucinate-api', configureServer: mount, configurePreviewServer: mount };
}

// Listens on localhost only; set HOST=0.0.0.0 to open it to your network (reach it by IP address, or
// list the host names you use in ALLOWED_HOSTS).
const host = process.env.HOST || 'localhost';
const allowedHosts = allowedHostsFromEnv();
const port = Number(process.env.PORT) || 5173;
// The GitHub Pages build is served from /hallucinate/.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [react(), apiMiddleware()],
  server: { host, port, allowedHosts },
  preview: { host, port, allowedHosts },
  // Two pages: the app, and the projector window it opens.
  build: { rollupOptions: { input: { main: 'index.html', output: 'output.html' } } },
});
