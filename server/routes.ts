// The /api handlers, mounted the same way by the Vite dev / preview server (vite.config.ts) and the
// desktop app's server (desktop/server.ts). Each handler owns everything under its prefix.

import { createAssistant } from './assistant';
import { guarded, type Handler } from './guard';
import { createBridge, SITES } from './ytdlp-bridge';

// `env` is added to yt-dlp's environment (the desktop app passes ELECTRON_RUN_AS_NODE, see the bridge).
export function apiRoutes(env: Record<string, string> = {}): [prefix: string, handler: Handler][] {
  return [
    ...Object.keys(SITES).map((site): [string, Handler] => [`/api/${site}`, guarded(createBridge(site as keyof typeof SITES, { env }))]),
    ['/api/assistant', guarded(createAssistant())],
  ];
}
