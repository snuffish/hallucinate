// `npm run desktop`: the desktop app against the Vite dev server (hot reload, the API as middleware).
// Builds the main process once, starts Vite, then Electron pointed at it. Ctrl-C stops both.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build, createServer } from 'vite';

await build({ configFile: 'vite.desktop.config.ts', logLevel: 'warn' });
const vite = await createServer({ configFile: 'vite.config.ts' });
await vite.listen();
vite.printUrls();
const url = vite.resolvedUrls?.local[0] ?? `http://localhost:${vite.config.server.port}/`;

const electronBin = createRequire(import.meta.url)('electron');
const app = spawn(electronBin, ['.'], { stdio: 'inherit', env: { ...process.env, HALLUCINATE_DEV_URL: url } });
const stop = async (code = 0) => { app.kill(); await vite.close(); process.exit(code); };
app.on('exit', (code) => void stop(code ?? 0));
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));
