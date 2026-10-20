// The server's System log lines on the wire, declared once for both ends: the server (server/log.ts) streams
// them and the browser (server-stream.ts) follows the stream. A leaf: no imports, so both can load it.
//
//   GET /api/log   an event stream: a LOG_EVENT per line, the backlog first

export const LOG_URL = '/api/log';
export const LOG_EVENT = 'line';

export const LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LEVELS)[number];
// Who said it: the server, or the desktop app's main process it runs in.
export const LINE_ORIGINS = ['server', 'desktop'] as const;
export type LineOrigin = (typeof LINE_ORIGINS)[number];
