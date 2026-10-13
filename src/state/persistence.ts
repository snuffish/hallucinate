// Typed, failure-tolerant localStorage access. Every key the app stores is listed here so the
// React port keeps reading exactly what the previous version wrote. Stored JSON is validated with
// zod on the way in: anything that doesn't match falls back, it never crashes the app.

import type { ZodType } from 'zod';

export const KEYS = {
  sceneEdits: 'hallucinate.sceneEdits',
  userScenes: 'hallucinate.userScenes',
  library: 'hallucinate.library',
  params: 'hallucinate.params',
  customShader: 'hallucinate.customShader',
  nodeGraph: 'hallucinate.nodeGraph',
  show: 'hallucinate.show',
  player: 'hallucinate.player',
  scRecent: 'hallucinate.scRecent',
  ytRecent: 'hallucinate.ytRecent',
  mediaSound: 'hallucinate.mediaSound',
  paramsCollapsed: 'hallucinate.paramsCollapsed',
  paramsPos: 'hallucinate.paramsPos',
  best: 'hallucinate.best',
} as const;

export function readString(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeString(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export function remove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

// Parses the stored JSON against `schema`; returns `fallback` when the key is missing, unreadable
// or doesn't match (e.g. written by an older version).
export function readJSON<T>(key: string, schema: ZodType<T>, fallback: T): T {
  let raw: string | null;
  try { raw = localStorage.getItem(key); } catch { return fallback; }
  if (raw === null) return fallback;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return fallback; }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : fallback;
}

export function writeJSON(key: string, value: unknown): void {
  writeString(key, JSON.stringify(value));
}

// Coalesces bursts of writes (slider drags, graph edits) into one localStorage write after `delay`
// ms of quiet, and flushes when the page is hidden so nothing is lost on close.
export interface DebouncedWriter {
  schedule(): void;
  flush(): void;
  dispose(): void;
}

export function debouncedWriter(key: string, read: () => unknown, delay = 500): DebouncedWriter {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty) return;
    dirty = false;
    writeJSON(key, read());
  };
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
  if (hasDom) {
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
  }
  return {
    schedule() {
      dirty = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
    dispose() {
      flush();
      if (hasDom) {
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', flush);
      }
    },
  };
}
