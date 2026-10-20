// What every /api handler does at the HTTP edge: answer with JSON or an event stream, read a request body,
// and see the path the client asked for.

import type { IncomingMessage, ServerResponse } from 'node:http';

// Answers `body` as JSON (no body: just the status). A response already under way (an event stream
// that failed late) is left alone.
export function sendJSON(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  if (body === undefined) return void res.writeHead(status, headers).end();
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

// Starts a server-sent event stream (unbuffered, so each event leaves at once); write `sseEvent`s to it.
export function startEventStream(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
}

// One server-sent event: its name and one JSON line of data.
export const sseEvent = (event: string, data: unknown): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

// The body as text. Past `maxBytes` the request is cut off and this rejects with `tooLarge`.
export function readBody(req: IncomingMessage, maxBytes: number, tooLarge = 'too large'): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error(tooLarge)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// The URL the client asked for, mount prefix included: Vite's middleware strips the prefix from
// req.url and keeps the original in originalUrl; the desktop app's server passes it through as is.
export function requestUrl(req: IncomingMessage): URL {
  return new URL((req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '/', 'http://localhost');
}
