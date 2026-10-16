// The programs the server runs, and how, from its environment. Never from Settings (server/config.ts):
// the server runs them, and /api admits non-browser clients, so a program path settable over HTTP would let
// any of them run a program of its choosing.
//
// Read when the routes are built (apiRoutes), never when a module loads: the desktop app copies these from
// the login shell (desktop/env.ts) after its modules have loaded.

export const PROGRAM_ENV = {
  claudeBin: 'CLAUDE_BIN',
  ytdlp: 'YTDLP',
  ytdlpCacheMb: 'YTDLP_CACHE_MB',   // each site's cache is trimmed (oldest first) to this size after every download
  debug: 'ASSISTANT_DEBUG',         // log the CLI arguments, MCP traffic and stderr
} as const;

export interface Programs {
  claudeBin: string;
  ytdlp: string;
  ytdlpCacheBytes: number;
}

const DEFAULT_CACHE_MB = 2048;

export function programs(env: NodeJS.ProcessEnv = process.env): Programs {
  const mb = Number(env[PROGRAM_ENV.ytdlpCacheMb]);
  return {
    claudeBin: env[PROGRAM_ENV.claudeBin] || 'claude',
    ytdlp: env[PROGRAM_ENV.ytdlp] || 'yt-dlp',
    ytdlpCacheBytes: (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_CACHE_MB) * 1024 * 1024,
  };
}

// The assistant's debug log, on while ASSISTANT_DEBUG is set (read at each call, like the rest).
export const debug = (...args: unknown[]): void => {
  if (process.env[PROGRAM_ENV.debug]) console.error('[assistant]', ...args);
};
