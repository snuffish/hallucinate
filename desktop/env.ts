// A packaged app started from the Dock, Finder or a desktop menu does not get the terminal's environment:
// macOS hands GUI apps /usr/bin:/bin:/usr/sbin:/sbin, so `claude` and `yt-dlp` (often in /opt/homebrew/bin
// or ~/.local/bin) would look "not installed", and an API key exported in ~/.zshrc would be missing.
// Before the server starts, borrow the login shell's PATH and the app's own settings (SHELL_VARS).

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';

const MARK = '__HALLUCINATE_PATH__';

// What the app reads from the environment (besides PATH). Only these are taken from the shell, and a
// value the app was already started with wins.
export const SHELL_VARS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_BIN', 'YTDLP', 'YTDLP_CACHE_MB',
  'ASSISTANT_BACKEND', 'ASSISTANT_MODEL', 'ASSISTANT_EFFORT', 'ASSISTANT_DIRECTOR_EFFORT', 'ASSISTANT_DEBUG',
] as const;

// Places tools usually live, as a fallback when the shell can't be asked.
export function commonToolDirs(home: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') return [];
  return [
    ...(platform === 'darwin' ? ['/opt/homebrew/bin', '/opt/homebrew/sbin'] : []),
    '/usr/local/bin',
    `${home}/.local/bin`,
    `${home}/.npm-global/bin`,
    `${home}/.volta/bin`,
    `${home}/.bun/bin`,
    `${home}/.claude/local`,
  ];
}

// The login shell's PATH first, then the current one, then the usual tool directories; no duplicates.
export function mergePath(current: string, shellPath: string | null, home: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return current;
  const sep = ':';
  const parts = [...(shellPath ?? '').split(sep), ...current.split(sep), ...commonToolDirs(home, platform)];
  return [...new Set(parts.filter(Boolean))].join(sep);
}

// Login shells print banners, "now using node …" lines and the like; the PATH is read between markers.
export function extractMarked(output: string): string | null {
  const m = new RegExp(`${MARK}(.*?)${MARK}`, 's').exec(output);
  return m?.[1]?.trim() || null;
}

// `env -0` output (NAME=value, NUL-separated) as a map.
export function parseEnv(block: string | null): Map<string, string> {
  const vars = new Map<string, string>();
  for (const entry of (block ?? '').split('\0')) {
    const eq = entry.indexOf('=');
    if (eq > 0) vars.set(entry.slice(0, eq), entry.slice(eq + 1));
  }
  return vars;
}

// The login shell's environment (sh, bash, zsh and fish all run this line), or an empty map.
function shellEnv(): Promise<Map<string, string>> {
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', `printf '%s' '${MARK}'; env -0; printf '%s' '${MARK}'`], { timeout: 5000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
      (_err, stdout) => resolve(parseEnv(extractMarked(String(stdout ?? '')))));
  });
}

// Copies the app's settings from the shell into `env` where they aren't set yet; returns the names copied.
export function adoptShellVars(env: NodeJS.ProcessEnv, shell: Map<string, string>): string[] {
  const copied: string[] = [];
  for (const name of SHELL_VARS) {
    const value = shell.get(name);
    if (value && !env[name]) { env[name] = value; copied.push(name); }
  }
  return copied;
}

export async function fixEnv(): Promise<void> {
  if (process.platform === 'win32') return;
  const shell = await shellEnv();
  process.env.PATH = mergePath(process.env.PATH ?? '', shell.get('PATH') ?? null, homedir(), process.platform);
  adoptShellVars(process.env, shell);
}
