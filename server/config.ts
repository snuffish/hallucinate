// The assistant's settings: which way to reach Claude, with which model and effort, and (in the desktop
// app) an API key. Each comes from, in order: the environment the server was started with (it wins and
// locks the field in the Settings overlay, as the desktop app's shell variables always have), the value
// saved from Settings, or the default.
//
// Program paths (CLAUDE_BIN, YTDLP) are deliberately not here: the server runs them, and /api admits
// non-browser clients, so a path settable over HTTP would let any of them run a program of its choosing.

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;   // `claude --effort`, and TanStack's reasoning levels
export type Effort = (typeof EFFORTS)[number];
export const BACKEND_CHOICES = ['auto', 'api', 'claude-code'] as const;
export type BackendChoice = (typeof BACKEND_CHOICES)[number];
export const DEFAULT_MODEL = 'claude-opus-5-5';   // on the API; the CLI uses its own default
export const DEFAULT_EFFORT: Effort = 'high';
// A model id or a CLI alias (`opus`, `sonnet[1m]`). It is passed to the CLI as one argument, never through a shell.
export const MODEL_PATTERN = /^[a-z0-9][a-z0-9.\-[\]]{0,63}$/i;

export const StoredConfigSchema = z.object({
  v: z.literal(1),
  backend: z.enum(BACKEND_CHOICES).optional().catch(undefined),
  model: z.string().regex(MODEL_PATTERN).optional().catch(undefined),
  effort: z.enum(EFFORTS).optional().catch(undefined),
  directorEffort: z.enum(EFFORTS).optional().catch(undefined),
  apiKey: z.string().optional().catch(undefined),   // encrypted by `Secrets`; never stored in the clear
});
export type StoredConfig = z.infer<typeof StoredConfigSchema>;
const EMPTY: StoredConfig = { v: 1 };

// Encrypts the API key at rest. The desktop app passes Electron's safeStorage (the OS keychain);
// elsewhere there is none, and a key can only come from the environment.
export interface Secrets {
  encrypt(plain: string): string;
  decrypt(stored: string): string;
}

export interface ConfigStore {
  read(): StoredConfig;
  write(next: StoredConfig): void;
  onChange(listener: () => void): () => void;
  readonly secrets: Secrets | null;
}

// Where `npm run dev` keeps the settings: ~/.config/hallucinate (XDG), %APPDATA%\hallucinate on Windows.
export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  const base = platform === 'win32' ? env.APPDATA ?? join(homedir(), 'AppData', 'Roaming') : env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'hallucinate', 'config.json');
}

// The settings in a JSON file only this user can read. Writes go to a temporary file first, so a crash
// never leaves half a file; another process (a second dev server) writing it is noticed by its mtime.
export function fileConfigStore(path: string, secrets: Secrets | null = null): ConfigStore {
  const listeners = new Set<() => void>();
  let cached = EMPTY;
  let mtime = -1;
  const load = (): StoredConfig => {
    let m: number;
    try { m = statSync(path).mtimeMs; } catch { return (cached = EMPTY); }
    if (m === mtime) return cached;
    mtime = m;
    try { cached = StoredConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); } catch { cached = EMPTY; }
    return cached;
  };
  return {
    secrets,
    read: load,
    write(next) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(tmp, path);
      cached = next;
      mtime = statSync(path).mtimeMs;
      for (const l of listeners) l();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

// For tests, and a server that should never write a file.
export function memoryConfigStore(initial: StoredConfig = EMPTY, secrets: Secrets | null = null): ConfigStore {
  const listeners = new Set<() => void>();
  let current = initial;
  return {
    secrets,
    read: () => current,
    write(next) { current = next; for (const l of listeners) l(); },
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type Source = 'env' | 'settings' | 'default';
export interface Field<T> { value: T; source: Source }

export interface EffectiveConfig {
  backend: Field<BackendChoice>;
  model: Field<string | null>;     // null: the backend's own default (DEFAULT_MODEL on the API)
  effort: Field<string>;
  directorEffort: Field<string>;
  // The key itself: server-side only, never sent to the page. `unreadable`: one is saved but can't be
  // decrypted here (another computer's, or the keychain refused).
  apiKey: Field<string | null> & { unreadable?: boolean };
}

function pick<T>(fromEnv: T | undefined, fromSettings: T | undefined, fallback: T): Field<T> {
  if (fromEnv !== undefined) return { value: fromEnv, source: 'env' };
  if (fromSettings !== undefined) return { value: fromSettings, source: 'settings' };
  return { value: fallback, source: 'default' };
}

// The one place that decides precedence: environment, then Settings, then the default. An empty
// environment variable counts as unset, as it always has.
export function effectiveConfig(env: NodeJS.ProcessEnv, stored: StoredConfig, secrets: Secrets | null): EffectiveConfig {
  const e = (name: string) => env[name] || undefined;
  const forced = e('ASSISTANT_BACKEND');
  const effort = pick<string>(e('ASSISTANT_EFFORT'), stored.effort, DEFAULT_EFFORT);
  const envKey = e('ANTHROPIC_API_KEY') ?? e('ANTHROPIC_AUTH_TOKEN');
  let apiKey: EffectiveConfig['apiKey'] = { value: null, source: 'default' };
  if (envKey) apiKey = { value: envKey, source: 'env' };
  else if (stored.apiKey) {
    let value: string | null = null;
    try { value = secrets ? secrets.decrypt(stored.apiKey) : null; } catch { /* unreadable */ }
    apiKey = { value, source: 'settings', ...(value === null && { unreadable: true }) };
  }
  return {
    backend: pick<BackendChoice>(forced === 'api' || forced === 'claude-code' ? forced : undefined, stored.backend, 'auto'),
    model: pick<string | null>(e('ASSISTANT_MODEL'), stored.model, null),
    effort,
    // The director's cycles may run at a lower effort than the chat; the chat's unless set.
    directorEffort: e('ASSISTANT_DIRECTOR_EFFORT') !== undefined
      ? { value: e('ASSISTANT_DIRECTOR_EFFORT')!, source: 'env' }
      : stored.directorEffort !== undefined ? { value: stored.directorEffort, source: 'settings' } : { value: effort.value, source: 'default' },
    apiKey,
  };
}

// The environment variable behind each field, for the Settings overlay's "set by …" note.
export const ENV_NAMES = {
  backend: 'ASSISTANT_BACKEND',
  model: 'ASSISTANT_MODEL',
  effort: 'ASSISTANT_EFFORT',
  directorEffort: 'ASSISTANT_DIRECTOR_EFFORT',
  apiKey: 'ANTHROPIC_API_KEY',
} as const satisfies Record<keyof EffectiveConfig, string>;
