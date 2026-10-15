// Pure helpers over a conversation's transcript (TanStack UIMessages): sealing interrupted tool
// calls, trimming old screenshots before a send, titles, previews and the Markdown export.

import type { UIMessage } from '@tanstack/ai-client';
import { splitFollowUps } from './follow-ups';
import { splitNotes } from './notes';
import { DONE_VERBS, type ToolName } from './tools';

export const NOT_RUN = 'Not run: the app was closed before this finished.';
export const OMITTED = '(screenshot omitted)';
export const KEEP_IMAGES = 3;

type Part = UIMessage['parts'][number];
type ToolCall = Extract<Part, { type: 'tool-call' }>;
type ToolResult = Extract<Part, { type: 'tool-result' }>;

const answered = (m: UIMessage, call: ToolCall) =>
  call.output !== undefined || m.parts.some((q) => q.type === 'tool-result' && q.toolCallId === call.id);

// A transcript saved (or stopped) halfway through a run can end with a tool call that has no result.
// Restored like that, its chip would spin forever and Claude would only get TanStack's stand-in
// "No result provided"; and TanStack's engine re-dispatches such a call if a transcript is ever sent
// ending with it. Give every unanswered call an error result that says what happened. Calls whose
// arguments never finished streaming are left alone: they are never sent to the model.
export function sealInterrupted(messages: UIMessage[]): UIMessage[] {
  let changed = false;
  const out = messages.map((m) => {
    if (m.role !== 'assistant') return m;
    const parts: Part[] = [];
    let touched = false;
    for (const p of m.parts) {
      parts.push(p);
      if (p.type !== 'tool-call' || p.state === 'input-streaming' || p.state === 'awaiting-input' || answered(m, p)) continue;
      parts.push({ type: 'tool-result', toolCallId: p.id, name: p.name, content: NOT_RUN, state: 'error', error: NOT_RUN } satisfies ToolResult);
      touched = true;
    }
    if (!touched) return m;
    changed = true;
    return { ...m, parts };
  });
  return changed ? out : messages;
}

// --- screenshots -------------------------------------------------------------------------------

interface ImageLike { type: 'image' }
const isImage = (v: unknown): v is ImageLike => !!v && typeof v === 'object' && (v as { type?: unknown }).type === 'image';

function imagesIn(value: unknown): number {
  return Array.isArray(value) ? value.filter(isImage).length : 0;
}

function stripImages(value: unknown, keep: { left: number }): unknown {
  if (!Array.isArray(value)) return value;
  // Walk backwards so the newest pictures are the ones kept.
  const out = [...value];
  for (let i = out.length - 1; i >= 0; i--) {
    if (!isImage(out[i])) continue;
    if (keep.left > 0) { keep.left--; continue; }
    out[i] = { type: 'text', content: OMITTED };
  }
  return out;
}

// What a run sends: the transcript with every screenshot but the newest `keep` replaced by a short
// note. A reopened chat would otherwise resend all of them, uncached, on every message.
export function prepareForSend<T extends { role: string; parts?: Part[] }>(messages: T[], keep = KEEP_IMAGES): T[] {
  const total = messages.reduce((n, m) => n + (m.parts ?? []).reduce((k, p) => k + (p.type === 'tool-call' ? imagesIn(p.output) : p.type === 'tool-result' ? imagesIn(p.content) : 0), 0), 0);
  if (total <= keep) return messages;
  const left = { left: keep };
  const out = [...messages];
  for (let mi = out.length - 1; mi >= 0; mi--) {
    const m = out[mi]!;
    if (!m.parts) continue;
    const parts = [...m.parts];
    for (let pi = parts.length - 1; pi >= 0; pi--) {
      const p = parts[pi]!;
      if (p.type === 'tool-call' && imagesIn(p.output)) parts[pi] = { ...p, output: stripImages(p.output, left) } as Part;
      else if (p.type === 'tool-result' && imagesIn(p.content)) parts[pi] = { ...p, content: stripImages(p.content, left) as ToolResult['content'] };
    }
    out[mi] = { ...m, parts };
  }
  return out;
}

// --- text ---------------------------------------------------------------------------------------

export const textOf = (m: UIMessage): string => m.parts.map((p) => (p.type === 'text' ? p.content : '')).join('');

// A title from the first user message: one line, about 40 characters, cut at a word.
export function titleFrom(text: string, max = 40): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line || 'New chat';
  const cut = line.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trim()}…`;
}

// The start of the newest reply, for the bubble's peek: plain text, no follow-ups line, no Markdown marks.
export function previewOf(messages: UIMessage[], max = 90): string {
  const last = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!last) return '';
  const text = splitFollowUps(textOf(last)).text.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>]+/g, '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max).trim()}…`;
}

// The conversation as Markdown: what was said, and each tool call as one line. No images; the
// assistant's reasoning only when asked for, as quoted blocks. App notes are left out.
export function toMarkdown(title: string, messages: UIMessage[], opts: { reasoning?: boolean } = {}): string {
  const lines = [`# ${title}`, ''];
  for (const m of messages) {
    if (m.role === 'user') {
      const { text } = splitNotes(textOf(m));
      if (text) lines.push(`**You:** ${text}`, '');
    } else if (m.role === 'assistant') {
      const out: string[] = [];
      for (const p of m.parts) {
        if (p.type === 'thinking' && opts.reasoning && p.content.trim()) out.push(p.content.trim().split('\n').map((l, i) => `> ${i ? '' : '💭 '}${l}`).join('\n'));
        if (p.type === 'text') { const t = splitFollowUps(p.content).text; if (t) out.push(t); }
        if (p.type === 'tool-call') {
          const result = m.parts.find((q): q is ToolResult => q.type === 'tool-result' && q.toolCallId === p.id);
          const verb = DONE_VERBS[p.name as ToolName];
          const label = verb ? verb((p.input ?? {}) as Record<string, unknown>) : p.name;
          out.push(`> ${result?.state === 'error' ? '✗' : '✓'} ${label}`);
        }
      }
      if (out.length) lines.push('**Assistant:**', '', out.join('\n\n'), '');
    }
  }
  return `${lines.join('\n').trim()}\n`;
}
