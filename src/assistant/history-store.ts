// Where the assistant's conversations are kept. A small index (titles, times, usage) lives in
// localStorage like every other setting; the transcripts, which carry the assistant's screenshots,
// live in IndexedDB so they never crowd user scenes out of localStorage's few megabytes.
//
// Two rules keep a stored conversation safe to continue:
//   - a transcript is sealed as it is read (sealInterrupted): a tool call that never got its result
//     gets one saying the app closed first, so it shows as not run and can never be re-dispatched;
//   - transcript writes are debounced (at most one per second per conversation, at once when a run
//     settles or the page hides): TanStack reports a change per streamed token, and cloning a
//     transcript with screenshots that often would cost frames.

import type { UIMessage } from '@tanstack/ai-client';
import { indexedDBPersistence } from '@tanstack/ai-client';
import { z } from 'zod';
import { KEYS, readJSON, writeJSON } from '../state/persistence';
import { sealInterrupted } from './transcript';
import { NO_USAGE, type Usage } from './usage';

export const HISTORY_CAP = 50;
const WRITE_MS = 1000;

const UsageSchema = z.object({ prompt: z.number(), completion: z.number(), cacheRead: z.number(), cacheWrite: z.number(), cost: z.number(), context: z.number().default(0) });

const ChatMetaSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  renamed: z.boolean().default(false),   // a user-given title; the first message no longer names it
  createdAt: z.number(),
  updatedAt: z.number(),
  pinned: z.boolean().default(false),
  usage: UsageSchema.default(NO_USAGE),
  lastPrompt: z.number().default(0),     // prompt tokens of the newest run: what one more message resends
  count: z.number().default(0),          // messages
  seen: z.object({ scene: z.string(), hash: z.string() }).optional(),   // on screen when the last reply finished (the reopen note compares)
});
export type ChatMeta = z.infer<typeof ChatMetaSchema>;

const IndexSchema = z.object({ v: z.literal(1), chats: z.array(z.unknown()), activeId: z.string().nullable() });
export interface ChatIndex { chats: ChatMeta[]; activeId: string | null }

// Every entry is checked on its own: one broken entry doesn't lose the others.
export function parseIndex(raw: unknown): ChatIndex {
  const parsed = IndexSchema.safeParse(raw);
  if (!parsed.success) return { chats: [], activeId: null };
  const chats: ChatMeta[] = [];
  const seen = new Set<string>();
  for (const c of parsed.data.chats) {
    const meta = ChatMetaSchema.safeParse(c);
    if (meta.success && !seen.has(meta.data.id)) { chats.push(meta.data); seen.add(meta.data.id); }
  }
  const activeId = chats.some((c) => c.id === parsed.data.activeId) ? parsed.data.activeId : null;
  return { chats, activeId };
}

export const readIndex = (): ChatIndex => parseIndex(readJSON(KEYS.assistantChats, z.unknown(), null));
export const writeIndex = (index: ChatIndex): void => writeJSON(KEYS.assistantChats, { v: 1, ...index });

// Keeps every pinned conversation and the newest others, up to `cap` in all. Returns the ids dropped.
export function prune(chats: ChatMeta[], cap = HISTORY_CAP, keep: ReadonlySet<string> = new Set()): { chats: ChatMeta[]; dropped: string[] } {
  if (chats.length <= cap) return { chats, dropped: [] };
  const removable = chats.filter((c) => !c.pinned && !keep.has(c.id)).sort((a, b) => a.updatedAt - b.updatedAt);
  const drop = new Set(removable.slice(0, chats.length - cap).map((c) => c.id));
  return { chats: chats.filter((c) => !drop.has(c.id)), dropped: [...drop] };
}

// ---------- Transcripts ----------

// What is stored per conversation: the messages, and each reply's token usage (by message id).
export interface Transcript { messages: UIMessage[]; replyUsage: Record<string, Usage> }

export interface TranscriptBackend {
  get(id: string): Promise<Transcript | null>;
  set(id: string, value: Transcript): Promise<void>;
  remove(id: string): Promise<void>;
}

const TranscriptSchema = z.object({ messages: z.array(z.object({ id: z.string(), role: z.string(), parts: z.array(z.unknown()) }).passthrough()), replyUsage: z.record(z.string(), UsageSchema).default({}) });

// IndexedDB through TanStack's adapter (structured clone, no JSON step). It stores a ChatPersistedState
// ({ messages }); we add our own field next to it.
export function indexedDBTranscripts(): TranscriptBackend {
  const db = indexedDBPersistence({ databaseName: 'hallucinate', objectStoreName: 'assistant-chats', keyPrefix: 'chat:' });
  return {
    async get(id) {
      const raw = await db.getItem(id);
      const parsed = TranscriptSchema.safeParse(raw);
      return parsed.success ? { messages: parsed.data.messages as unknown as UIMessage[], replyUsage: parsed.data.replyUsage } : null;
    },
    set: (id, value) => Promise.resolve(db.setItem(id, value as unknown as Parameters<typeof db.setItem>[1])),
    remove: (id) => Promise.resolve(db.removeItem(id)),
  };
}

// One conversation's stored transcript, kept in step with the conversation under the two rules above,
// plus these:
//   - nothing is written before the stored one was read (`read`), so a conversation closed before its
//     transcript loaded (StrictMode mounts twice) never overwrites it with nothing;
//   - writes go out in order, one at a time, so a reply's final state is never overtaken by an older one;
//   - after `destroy` nothing is written, not even a reply still streaming in, and a write already in
//     flight lands before the record is removed.
export interface StoredTranscript {
  // The stored transcript, sealed; null when there is none (`exists` says) or it can't be read.
  read(): Promise<Transcript | null>;
  // The conversation changed: the newest state is written at most once per `delay`.
  update(t: Transcript): void;
  // A reply is complete: written now, after any write in flight.
  commit(t: Transcript): Promise<void>;
  // The conversation closes: what is pending is written, and the page-hide listeners go.
  close(): void;
  // The conversation is deleted: nothing pending is written, and the record goes.
  destroy(): Promise<void>;
}

export interface StoredTranscriptOptions {
  exists?: () => boolean;            // whether there is one to read (the index lists it); default yes
  onError?: (err: Error) => void;    // a write failed (storage unavailable or full)
  delay?: number;
}

export function storedTranscript(backend: TranscriptBackend, id: string, { exists = () => true, onError, delay = WRITE_MS }: StoredTranscriptOptions = {}): StoredTranscript {
  let readDone = false, gone = false;
  let pending: Transcript | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writes: Promise<void> = Promise.resolve();
  const write = (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = null; }
    const value = pending;
    pending = null;
    if (!value) return writes;
    writes = writes.then(() => (gone ? undefined : backend.set(id, value))).catch((err: Error) => onError?.(err));
    return writes;
  };
  const onHide = () => { if (document.visibilityState === 'hidden') void write(); };
  const onPageHide = () => void write();
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
  if (hasDom) {
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
  }
  const detach = () => {
    if (!hasDom) return;
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
  };
  const writable = () => readDone && !gone;
  return {
    async read() {
      let t: Transcript | null = null;
      if (exists()) {
        try { t = await backend.get(id); } catch { /* IndexedDB unavailable (private mode) or the record is unreadable */ }
      }
      readDone = true;
      return t && { ...t, messages: sealInterrupted(t.messages) };
    },
    update(t) {
      if (!writable()) return;
      pending = t;
      timer ??= setTimeout(() => void write(), delay);   // at most one write per `delay`, not one per token
    },
    commit(t) {
      if (!writable()) return writes;
      pending = t;
      return write();
    },
    close() {
      void write();
      detach();
    },
    destroy() {
      gone = true;
      pending = null;
      if (timer) { clearTimeout(timer); timer = null; }
      detach();
      writes = writes.then(() => backend.remove(id)).catch(() => { /* storage unavailable */ });
      return writes;
    },
  };
}
