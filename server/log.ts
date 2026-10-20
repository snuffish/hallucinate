// The local server's side of the System log (Shift+S): the lines the server has to say (the assistant's
// debug lines, each /api request and how it went), kept in a ring and streamed to the app over /api/log as
// server-sent events: the lines so far, then each new one. Not the process's console: the dev server prints
// the page's own console errors there, which the log has already. In the desktop app the server runs in
// Electron's main process, which writes its own lines here too (desktop/main-log.ts), marked `desktop`.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { inspect } from 'node:util';
import { LOG_EVENT, type LineOrigin, type LogLevel } from '../src/log/log-wire';
import { isLoopbackHost, type Handler } from './guard';
import { sendJSON, sseEvent, startEventStream } from './http';

export { LOG_EVENT, type LineOrigin };

export type ServerLevel = LogLevel;
export interface ServerLine { id: number; t: number; level: ServerLevel; origin: LineOrigin; text: string; detail?: string }

export const SERVER_LOG_CAP = 500;

export class ServerLog {
  private lines: ServerLine[] = [];
  private nextId = 1;
  private readonly listeners = new Set<(line: ServerLine) => void>();

  constructor(private readonly cap = SERVER_LOG_CAP) {}

  push(level: ServerLevel, text: string, detail?: string, origin: LineOrigin = 'server'): ServerLine {
    const line: ServerLine = { id: this.nextId++, t: Date.now(), level, origin, text, ...(detail && { detail }) };
    this.lines.push(line);
    if (this.lines.length > this.cap) this.lines.splice(0, this.lines.length - this.cap);
    for (const l of this.listeners) l(line);
    return line;
  }

  backlog(): readonly ServerLine[] { return this.lines; }

  listen(fn: (line: ServerLine) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}

// The server's one log: the routes, the assistant's debug lines and (in the desktop app) the main process write here.
export const serverLog = new ServerLog();

// Console arguments as one line and the rest, the way node prints them.
export function formatServerArgs(args: readonly unknown[]): { text: string; detail?: string } {
  const all = args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 4, breakLength: Infinity }))).join(' ');
  const [first = '', ...rest] = all.split('\n');
  return { text: first, ...(rest.length && { detail: rest.join('\n') }) };
}

// One line per /api request once it is answered: the method, the path (no query: it can hold a search or a
// link), the status and how long it took. Errors and refusals stand out by level.
export function logged(handler: Handler, log: ServerLog = serverLog): Handler {
  return (req, res) => {
    const start = Date.now();
    res.on('finish', () => {
      const status = res.statusCode;
      const level: ServerLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'debug';
      log.push(level, `${req.method} ${(req.originalUrl ?? req.url ?? '').split('?')[0]} → ${status} (${Date.now() - start} ms)`);
    });
    return handler(req, res);
  };
}

declare module 'node:http' {
  interface IncomingMessage { originalUrl?: string }   // connect (the Vite servers) keeps the full path here
}

export const sseLine = (line: ServerLine): string => sseEvent(LOG_EVENT, line);

// GET /api/log: an event stream of the lines so far, then each new one, until the app goes away. Only on this
// computer, like changing Settings: the lines carry the assistant's traffic and the links you fetched, which a
// device reaching an app started with HOST=0.0.0.0 has no business reading.
export function createLogRoute(log: ServerLog = serverLog): Handler {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET') return sendJSON(res, 405, { error: 'GET only' }, { Allow: 'GET' });
    if (!isLoopbackHost(req.headers.host)) return sendJSON(res, 403, { error: 'The server log is only shown on the computer the app runs on.' });
    startEventStream(res);
    for (const line of log.backlog()) res.write(sseLine(line));
    const off = log.listen((line) => res.write(sseLine(line)));
    req.on('close', off);
  };
}
