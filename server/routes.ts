// The /api handlers, mounted the same way by the Vite dev / preview server (vite.config.ts) and the
// desktop app's server (desktop/server.ts). Each handler owns everything under its prefix.

import { assistantConfig } from './adapters';
import { createAssistant } from './assistant';
import { CliBridge } from './cli-bridge';
import { defaultConfigPath, fileConfigStore, type ConfigStore } from './config';
import { guarded, type Handler } from './guard';
import { programs } from './programs';
import { createSettingsRoute } from './settings-route';
import { createBridge, SITES } from './ytdlp-bridge';

export interface RouteOptions {
  // Added to yt-dlp's environment (the desktop app passes ELECTRON_RUN_AS_NODE, see the bridge).
  env?: Record<string, string>;
  // Where the assistant's settings live: the desktop app's profile (with the keychain for an API key),
  // else ~/.config/hallucinate without one.
  config?: ConfigStore;
}

// The programs are read from the environment here, when the server starts, not when these modules load:
// the desktop app fills in its login shell's variables in between (programs.ts).
export function apiRoutes({ env = {}, config = fileConfigStore(defaultConfigPath()) }: RouteOptions = {}): [prefix: string, handler: Handler][] {
  const { claudeBin, ytdlp, ytdlpCacheBytes } = programs();
  const assistant = assistantConfig(config, { claudeBin });
  return [
    ...Object.keys(SITES).map((site): [string, Handler] => [`/api/${site}`, guarded(createBridge(site as keyof typeof SITES, { ytdlp, env, cacheBytes: ytdlpCacheBytes }))]),
    ['/api/assistant', guarded(createAssistant(assistant, new CliBridge({ claudeBin })))],
    ['/api/settings', guarded(createSettingsRoute(config, {
      backend: { get: assistant.backend, reset: assistant.resetBackend },
      paths: { claudeBin, ytdlp },
    }))],
  ];
}
