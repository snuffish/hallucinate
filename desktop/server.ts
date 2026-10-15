// The desktop app's local server: the built app (dist/) plus the same /api handlers `vite preview` mounts,
// on 127.0.0.1. The renderer keeps talking to it with relative URLs, exactly as in the browser.
//
// The port is fixed on purpose: localStorage and IndexedDB belong to the origin, and the origin includes the
// port, so a different port would open with an empty library. Another port is only used when this one is busy.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { createBridge, SITES } from '../server/ytdlp-bridge.js';
import { createAssistant } from '../server/assistant';

export const PREFERRED_PORT = 47741;
export const HOST = '127.0.0.1';

type Handler = (req: IncomingMessage, res: ServerResponse) => unknown;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export const contentType = (path: string): string => TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';

// The file under `root` a URL path names, or null when it would leave `root` (or can't be decoded).
export function resolveStatic(root: string, urlPath: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(urlPath.split('?')[0]!.split('#')[0]!);
  } catch {
    return null;
  }
  if (path.includes('\0')) return null;
  if (path === '/' || path === '') path = '/index.html';
  const base = resolve(root);
  const file = resolve(base, normalize(`.${path}`));
  return file === base || file.startsWith(base + sep) ? file : null;
}

export interface AppServer { port: number; fellBack: boolean; server: Server; close(): Promise<void> }

export function createHandler(dist: string, env: Record<string, string> = {}): Handler {
  // Mounted like vite.config.ts does: each handler owns everything under its prefix.
  const routes: [string, Handler][] = [
    ...Object.keys(SITES).map((site): [string, Handler] => [`/api/${site}`, createBridge(site, { env }) as Handler]),
    ['/api/assistant', createAssistant() as Handler],
  ];
  return async (req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    const route = routes.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
    if (route) return route[1](req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    const file = resolveStatic(dist, path);
    if (!file) return send(res, 404, 'Not found');
    let size: number;
    try {
      const s = await stat(file);
      if (!s.isFile()) return send(res, 404, 'Not found');
      size = s.size;
    } catch {
      return send(res, 404, 'Not found');
    }
    // Hashed bundles never change; the pages must always be fresh so an update takes effect.
    const cache = file.startsWith(join(resolve(dist), 'assets') + sep) ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': contentType(file), 'Content-Length': size, 'Cache-Control': cache });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  };
}

function send(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((ok, fail) => {
    const onError = (err: Error) => { server.off('listening', onListening); fail(err); };
    const onListening = () => { server.off('error', onError); const a = server.address(); ok(typeof a === 'object' && a ? a.port : port); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

export async function startServer({ dist, preferredPort = PREFERRED_PORT, env }: { dist: string; preferredPort?: number; env?: Record<string, string> }): Promise<AppServer> {
  const server = createServer(createHandler(dist, env));
  let port: number;
  let fellBack = false;
  try {
    port = await listen(server, preferredPort);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    port = await listen(server, 0);
    fellBack = true;
  }
  return {
    port,
    fellBack,
    server,
    close: () => new Promise<void>((done) => {
      server.close(() => done());
      server.closeAllConnections();   // open SSE streams end, which aborts running assistant / yt-dlp work
    }),
  };
}
