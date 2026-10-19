// The System log (Shift+S): every line the app, the browser console and the local server have to say,
// kept in one ring from the moment the page loads, so the log has its history when it opens and the error
// badge can count while it is closed. Pure: no DOM, so it is tested in node.

import { Store } from '../state/store';

export const LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LEVELS)[number];
// Where a line came from: the page's console (and its uncaught errors), the local server, the app's own
// events (scenes, music, tempo, the GPU), or a command typed into the log and its answer.
export const SOURCES = ['console', 'server', 'app', 'command'] as const;
export type LogSource = (typeof SOURCES)[number];

export interface LogEntry {
  id: number;
  t: number;            // ms since the epoch
  level: LogLevel;
  source: LogSource;
  text: string;         // one line
  detail?: string;      // the rest: a stack, the full object, the lines after the first
  repeat: number;       // the same line again right after: counted, not added (a frame loop can say it 60 times a second)
}

export interface LogInput { level: LogLevel; source: LogSource; text: string; detail?: string; t?: number }

// What React follows: `version` bumps when the lines change; `unseenErrors` counts errors since the log was last open.
export interface LogStats { version: number; unseenErrors: number }

export const LOG_CAP = 2000;
const PUBLISH_MS = 250;   // a burst of lines re-renders the log at most 4 times a second

export class SystemLog {
  readonly stats = new Store<LogStats>({ version: 0, unseenErrors: 0 });
  private lines: LogEntry[] = [];
  private nextId = 1;
  private unseen = 0;
  private watching = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly cap = LOG_CAP, private readonly publishMs = PUBLISH_MS) {}

  push({ level, source, text, detail, t = Date.now() }: LogInput): LogEntry {
    const last = this.lines.at(-1);
    if (last && last.level === level && last.source === source && last.text === text && last.detail === detail) {
      last.repeat++;
      last.t = t;
      this.counted(level);
      return last;
    }
    const entry: LogEntry = { id: this.nextId++, t, level, source, text, ...(detail && { detail }), repeat: 1 };
    // In time order: the server's lines from before the log opened arrive after the page's.
    let at = this.lines.length;
    while (at > 0 && this.lines[at - 1]!.t > t) at--;
    this.lines.splice(at, 0, entry);
    if (this.lines.length > this.cap) this.lines.splice(0, this.lines.length - this.cap);
    this.counted(level);
    return entry;
  }

  // The app's own events, in one call.
  app(level: LogLevel, text: string, detail?: string): void { this.push({ level, source: 'app', text, detail }); }

  entries(): readonly LogEntry[] { return this.lines; }

  clear(): void {
    this.lines = [];
    this.unseen = 0;
    this.publish(true);
  }

  // While the log is open its errors are seen as they come; opening it sees the ones before.
  watch(on: boolean): void {
    this.watching = on;
    if (on) this.unseen = 0;
    this.publish(true);
  }

  private counted(level: LogLevel): void {
    if (level === 'error' && !this.watching) this.unseen++;
    this.publish(false);
  }

  private publish(now: boolean): void {
    if (now) {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.stats.set({ version: this.stats.get().version + 1, unseenErrors: this.unseen });
      return;
    }
    this.timer ??= setTimeout(() => { this.timer = null; this.publish(true); }, this.publishMs);
  }
}

// The page's one log, recording from the first line main.tsx runs.
export const systemLog = new SystemLog();

// ---------- Turning console arguments into a line ----------

const MAX_TEXT = 2000;
const clip = (s: string, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n)}… (${s.length - n} more)` : s);

// One value as the console would print it, without throwing on cycles, BigInts or huge objects.
export function show(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (typeof value !== 'object' || value === null) return String(value);
  const seen = new WeakSet<object>();
  try {
    return clip(JSON.stringify(value, (_k, v: unknown) => {
      if (typeof v === 'bigint') return `${v}n`;
      if (v instanceof Error) return `${v.name}: ${v.message}`;
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      return v;
    }) ?? String(value));
  } catch {
    return Object.prototype.toString.call(value);
  }
}

// A format string's arguments put in, as the console does: %s %d %i %f %o %O take the next one, %c (a style)
// takes it and prints nothing, %% is a %.
export function substitute(args: readonly unknown[]): unknown[] {
  const [first, ...rest] = args;
  if (typeof first !== 'string' || !first.includes('%')) return [...args];
  let i = 0;
  const text = first.replace(/%([sdifoOc%])/g, (m, k: string) => {
    if (k === '%') return '%';
    if (i >= rest.length) return m;
    const v = rest[i++];
    if (k === 'c') return '';
    if (k === 'd' || k === 'i') return String(Math.trunc(Number(v)));
    if (k === 'f') return String(Number(v));
    return show(v);
  });
  return [text, ...rest.slice(i)];
}

// Console arguments as a line and its detail: the first line of what was said, then the rest of it and any
// error's stack.
export function formatArgs(args: readonly unknown[]): { text: string; detail?: string } {
  const all = substitute(args).map(show).join(' ');
  const [first = '', ...rest] = all.split('\n');
  const stacks = args.flatMap((a) => (a instanceof Error && a.stack ? [a.stack] : []));
  const detail = [rest.join('\n'), ...stacks].filter(Boolean).join('\n');
  return { text: clip(first, 500) || '(empty)', ...(detail && { detail: clip(detail) }) };
}

// ---------- What the log shows ----------

export interface LogFilter { levels: readonly LogLevel[]; sources: readonly LogSource[]; query: string }
export const ALL_LINES: LogFilter = { levels: LEVELS, sources: SOURCES, query: '' };

export function filterEntries(entries: readonly LogEntry[], { levels, sources, query }: LogFilter): LogEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) =>
    levels.includes(e.level) && sources.includes(e.source)
    && (!q || e.text.toLowerCase().includes(q) || (e.detail?.toLowerCase().includes(q) ?? false)));
}

export const counts = (entries: readonly LogEntry[]): Record<LogLevel, number> => {
  const out: Record<LogLevel, number> = { error: 0, warn: 0, info: 0, debug: 0 };
  for (const e of entries) out[e.level] += e.repeat;
  return out;
};

// One line per entry as Copy and Export write it: time, level, source, text (×repeat), the detail indented.
export function toText(entries: readonly LogEntry[]): string {
  return entries.map((e) => {
    const head = `${new Date(e.t).toISOString()} ${e.level.toUpperCase().padEnd(5)} [${e.source}] ${e.text}${e.repeat > 1 ? ` (×${e.repeat})` : ''}`;
    return e.detail ? `${head}\n${e.detail.replace(/^/gm, '    ')}` : head;
  }).join('\n');
}
