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

// Reads a transcript, sealed so that nothing in it can run again.
export async function loadTranscript(backend: TranscriptBackend, id: string): Promise<Transcript | null> {
  try {
    const t = await backend.get(id);
    return t && { ...t, messages: sealInterrupted(t.messages) };
  } catch {
    return null;   // IndexedDB unavailable (private mode) or the record is unreadable
  }
}

// One debounced writer per conversation: `schedule` keeps only the latest state, `flush` writes now.
// `cancel` drops a write that hasn't happened yet (the conversation is being deleted).
export interface TranscriptWriter { schedule(value: Transcript): void; flush(): Promise<void>; cancel(): void; dispose(): void }

export function transcriptWriter(backend: TranscriptBackend, id: string, onError?: (err: Error) => void, delay = WRITE_MS): TranscriptWriter {
  let pending: Transcript | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    const value = pending;
    pending = null;
    if (!value) return;
    try { await backend.set(id, value); } catch (err) { onError?.(err as Error); }
  };
  const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
  if (hasDom) {
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
  }
  return {
    schedule(value) {
      pending = value;
      timer ??= setTimeout(() => void flush(), delay);   // at most one write per `delay`, not one per token
    },
    flush,
    cancel() {
      if (timer) { clearTimeout(timer); timer = null; }
      pending = null;
    },
    dispose() {
      void flush();
      if (hasDom) {
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', flush);
      }
    },
  };
}
