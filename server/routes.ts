// The /api handlers, mounted the same way by the Vite dev / preview server (vite.config.ts) and the
// desktop app's server (desktop/server.ts). Each handler owns everything under its prefix.

import { assistantConfig } from './adapters';
import { createAssistant } from './assistant';
import { CLAUDE_BIN } from './claude-cli-adapter';
import { defaultConfigPath, fileConfigStore, type ConfigStore } from './config';
import { guarded, type Handler } from './guard';
import { createSettingsRoute } from './settings-route';
import { createBridge, SITES, YTDLP } from './ytdlp-bridge';

export interface RouteOptions {
  // Added to yt-dlp's environment (the desktop app passes ELECTRON_RUN_AS_NODE, see the bridge).
  env?: Record<string, string>;
  // Where the assistant's settings live: the desktop app's profile (with the keychain for an API key),
  // else ~/.config/hallucinate without one.
  config?: ConfigStore;
}

export function apiRoutes({ env = {}, config = fileConfigStore(defaultConfigPath()) }: RouteOptions = {}): [prefix: string, handler: Handler][] {
  const assistant = assistantConfig(config);
  return [
    ...Object.keys(SITES).map((site): [string, Handler] => [`/api/${site}`, guarded(createBridge(site as keyof typeof SITES, { env }))]),
    ['/api/assistant', guarded(createAssistant(assistant))],
    ['/api/settings', guarded(createSettingsRoute(config, {
      backend: { get: assistant.backend, reset: assistant.resetBackend },
      paths: { claudeBin: CLAUDE_BIN, ytdlp: YTDLP },
    }))],
  ];
}
