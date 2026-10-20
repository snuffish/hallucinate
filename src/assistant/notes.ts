// Notes the app adds to the user's next message, for Claude only: "the user undid your change",
// "this conversation was reopened later", "the scene on screen changed". They ride at the start of the message (one per line, in
// parentheses) rather than as messages of their own, so they cost no extra run and reach both
// backends (the subscription backend sends only the latest user message). The panel shows them as
// small notes, not as part of what the user typed.

import { roundTo } from '../engine/math';

const UNDO_PREFIX = '(The user pressed Undo and reverted your change: ';
const RESUME_PREFIX = '(This conversation was reopened on ';
const SCENE_PREFIX = '(The scene on screen changed since your last reply: ';

export const undoNote = (label: string) => `${UNDO_PREFIX}${label}.)`;

// What was on screen when a conversation's last reply finished (kept in its history entry), and what
// is on screen now. The reopen note compares the two, so Claude doesn't re-read a scene it already
// has: those re-reads were most of what a reopened conversation cost.
export interface Screen { scene: string; hash: string }
export interface ScreenNow extends Screen { values: Record<string, unknown> }

const MAX_VALUES = 600;   // characters; a scene with many parameters gets pointed at get_app_state instead

export function resumeNote(date: Date, seen?: Screen | null, now?: ScreenNow | null): string {
  const head = `${RESUME_PREFIX}${date.toLocaleString()}. Your earlier changes can no longer be undone from the panel`;
  if (!seen || !now) return `${head}, and the app may have changed since: call get_app_state before changing anything.)`;
  const what = now.scene !== seen.scene ? 'a different scene than at your last reply' : now.hash === seen.hash ? 'the scene from your last reply, its code unchanged since' : 'the scene from your last reply, but its code changed since: read it before editing';
  const values = JSON.stringify(now.values, (_k, v: unknown) => (typeof v === 'number' ? roundTo(v, 3) : v));
  const params = values.length <= MAX_VALUES ? `; its parameters are ${values}` : '';
  return `${head}. On screen: ${JSON.stringify(now.scene)}, ${what}${params}. Call get_app_state only if you need more.)`;
}

// Auto-switch (or the user) moved the screen to another scene between replies: "make it brighter" now
// means that scene, and Claude's scene tools default to it.
export const sceneNote = (scene: string) => `${SCENE_PREFIX}now ${JSON.stringify(scene)}.)`;

export { codeHash } from '../state/code-hash';

const NOTE_LINE = /^\((?:The user pressed Undo and reverted your change: |This conversation was reopened on |The scene on screen changed since your last reply: )[^\n]*\)$/;

export function withNotes(notes: readonly string[], text: string): string {
  return notes.length ? `${notes.join('\n')}\n\n${text}` : text;
}

// Splits a user message into its notes and what the user typed. A message that is only a note
// (the old Undo form) has empty text.
export function splitNotes(message: string): { notes: string[]; text: string } {
  const lines = message.split('\n');
  const notes: string[] = [];
  while (lines.length && NOTE_LINE.test(lines[0]!)) notes.push(lines.shift()!);
  if (!notes.length) return { notes, text: message };
  return { notes, text: lines.join('\n').replace(/^\n+/, '') };
}

// How a note reads in the panel.
export function describeNote(note: string): string {
  if (note.startsWith(UNDO_PREFIX)) return `Undid: ${note.slice(UNDO_PREFIX.length, -2)}`;
  if (note.startsWith(RESUME_PREFIX)) return 'Reopened later: Claude was told the app may have changed.';
  if (note.startsWith(SCENE_PREFIX)) return `Scene changed: ${note.slice(SCENE_PREFIX.length + 'now '.length, -2)}`;
  return note;
}
