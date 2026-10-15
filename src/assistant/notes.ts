// Notes the app adds to the user's next message, for Claude only: "the user undid your change",
// "this conversation was reopened later". They ride at the start of the message (one per line, in
// parentheses) rather than as messages of their own, so they cost no extra run and reach both
// backends (the subscription backend sends only the latest user message). The panel shows them as
// small notes, not as part of what the user typed.

export const UNDO_PREFIX = '(The user pressed Undo and reverted your change: ';
export const RESUME_PREFIX = '(This conversation was reopened on ';

export const undoNote = (label: string) => `${UNDO_PREFIX}${label}.)`;
export const resumeNote = (date: Date) =>
  `${RESUME_PREFIX}${date.toLocaleString()}. The app may have changed since and your earlier changes can no longer be undone from the panel: call get_app_state before changing anything.)`;

const NOTE_LINE = /^\((?:The user pressed Undo and reverted your change: |This conversation was reopened on )[^\n]*\)$/;

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
  return note;
}
