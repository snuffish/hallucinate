// The local server's lines in the System log: /api/log streams what it said before the log opened, then
// each new line. Followed only while the log is open (a browser has few connections per server, and the
// downloads and the assistant stream too); a reconnect's backlog skips the lines already here.

import { z } from 'zod';
import type { SystemLog } from './system-log';

export const LOG_URL = '/api/log';

const ServerLineSchema = z.object({
  id: z.number(), t: z.number(), level: z.enum(['error', 'warn', 'info', 'debug']), text: z.string(), detail: z.string().optional(),
});

// Whether a line from the stream is new here. The server numbers its lines; a server started again
// numbers from 1, but its lines are later.
export function isNew(line: { id: number; t: number }, last: { id: number; t: number } | null): boolean {
  return !last || line.id > last.id || line.t > last.t;
}

let last: { id: number; t: number } | null = null;   // kept across openings: the log keeps the lines too
let unavailable = false;

export function followServer(log: SystemLog, url = LOG_URL): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const source = new EventSource(url);
  source.addEventListener('open', () => { unavailable = false; });
  source.addEventListener('line', (e) => {
    let data: unknown;
    try { data = JSON.parse((e as MessageEvent<string>).data); } catch { return; }
    const line = ServerLineSchema.safeParse(data);
    if (!line.success || !isNew(line.data, last)) return;
    last = { id: line.data.id, t: line.data.t };
    const { level, text, detail, t } = line.data;
    log.push({ level, source: 'server', text, detail, t });
  });
  source.addEventListener('error', () => {
    // CLOSED: refused or not there (a static host has no server); else the browser tries again by itself.
    if (source.readyState !== EventSource.CLOSED || unavailable) return;
    unavailable = true;
    log.push({ level: 'info', source: 'server', text: 'No server log here: the local server isn\'t running, or it shows its log only on the computer it runs on.' });
  });
  return () => source.close();
}
