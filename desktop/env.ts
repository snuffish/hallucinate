// A packaged app started from the Dock, Finder or a desktop menu does not get the terminal's PATH:
// macOS hands GUI apps /usr/bin:/bin:/usr/sbin:/sbin, so `claude` and `yt-dlp` (often in /opt/homebrew/bin
// or ~/.local/bin) would look "not installed". Before the server starts, borrow the login shell's PATH.

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';

const MARK = '__HALLUCINATE_PATH__';

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

function shellPath(): Promise<string | null> {
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', `printf '%s%s%s' '${MARK}' "$PATH" '${MARK}'`], { timeout: 5000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
      (_err, stdout) => resolve(extractMarked(String(stdout ?? ''))));
  });
}

export async function fixPath(): Promise<void> {
  if (process.platform === 'win32') return;
  const current = process.env.PATH ?? '';
  process.env.PATH = mergePath(current, await shellPath(), homedir(), process.platform);
}
