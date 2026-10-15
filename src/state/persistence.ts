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
  layout: 'hallucinate.layout',
  lastScene: 'hallucinate.lastScene',   // the scene on screen (its paramKey), restored on the next start; not exported
  // The assistant's conversations: this index; the transcripts live in IndexedDB (src/assistant/history-store.ts).
  assistantChats: 'hallucinate.assistantChats',
  assistantThinking: 'hallucinate.assistantThinking',   // the panel's "Show reasoning" toggle
  paramGroups: 'hallucinate.paramGroupsOpen',   // opened parameter groups per scene; they start folded (not exported)
  // Migrated into `layout` (src/state/layout.ts) on first load, then removed.
  paramsCollapsed: 'hallucinate.paramsCollapsed',
  paramsPos: 'hallucinate.paramsPos',
  best: 'hallucinate.best',
  helpHint: 'hallucinate.helpHint',
  // Settings import (src/state/bundle.ts): other tabs reload when this changes; the report is shown
  // once after the reload.
  importedAt: 'hallucinate.importedAt',
  importReport: 'hallucinate.importReport',
} as const;

// While an import replaces the stored state, nothing else may write: a stale in-memory value
// (a debounced writer flushing on pagehide, a panel saving on unmount) would overwrite what was
// just imported. Only `commitRaw` writes while frozen.
let frozen = false;
export const freeze = (): void => { frozen = true; };
export const unfreeze = (): void => { frozen = false; };

export function readString(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeString(key: string, value: string): void {
  if (frozen) return;
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export function remove(key: string): void {
  if (frozen) return;
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

// The import's write path: ignores the freeze, throws when the write fails (quota), and throws when
// the value doesn't read back. `null` removes the key.
export function commitRaw(key: string, value: string | null): void {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
  if (localStorage.getItem(key) !== value) throw new Error(`Couldn't store ${key}.`);
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

// Every live writer, so an export or import can store pending changes first.
const writers = new Set<DebouncedWriter>();
export function flushAll(): void { for (const w of writers) w.flush(); }

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
  const writer: DebouncedWriter = {
    schedule() {
      dirty = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
    dispose() {
      flush();
      writers.delete(writer);
      if (hasDom) {
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', flush);
      }
    },
  };
  writers.add(writer);
  return writer;
}
