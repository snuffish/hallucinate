// Only the app itself may call /api. The server runs on the user's machine with their credentials, so a
// web page in another tab must not be able to start assistant runs or downloads through it:
//   - Host must be a loopback name or an IP literal (a DNS-rebinding attack needs a domain name), or a
//     name listed in ALLOWED_HOSTS;
//   - a browser request must come from this origin (Origin, Sec-Fetch-Site);
//   - a POST must be JSON, so a cross-site form or no-cors fetch can't send one without a preflight.
// Non-browser clients (the Claude CLI's MCP calls, curl) send no Origin or Sec-Fetch-Site and pass.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { sendJSON } from './http';

export type Handler = (req: IncomingMessage, res: ServerResponse) => unknown;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export const allowedHostsFromEnv = (): string[] =>
  (process.env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

// The host name in a Host header, without the port or IPv6 brackets.
export function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  return h.replace(/:\d+$/, '');
}

export function hostAllowed(host: string | undefined, extra: readonly string[] = []): boolean {
  if (!host) return false;
  const name = hostName(host);
  return LOOPBACK.has(name) || name.endsWith('.localhost') || isIP(name) !== 0 || extra.includes(name);
}

// This computer by name or address, as opposed to a device on the network reaching an app started with
// HOST=0.0.0.0 by its IP address or an ALLOWED_HOSTS name. Settings may only be changed from here.
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = hostName(host);
  return LOOPBACK.has(name) || name.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(name) || name === '::ffff:127.0.0.1';
}

// Why a request is refused, or null when it may go through.
export function refusal(req: IncomingMessage, extra: readonly string[] = []): string | null {
  const host = req.headers.host;
  if (!hostAllowed(host, extra)) return 'Unknown host';
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost: string | null = null;
    try { originHost = new URL(origin).host; } catch { /* "null" or garbage */ }
    if (originHost !== host) return 'Cross-origin request';
  }
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 'Cross-site request';
  if (req.method === 'POST' && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return 'Expected a JSON body';
  return null;
}

export function guarded(handler: Handler, extra: readonly string[] = allowedHostsFromEnv()): Handler {
  return (req, res) => {
    const reason = refusal(req, extra);
    if (!reason) return handler(req, res);
    sendJSON(res, 403, { error: reason });
  };
}

// The address a process on this machine reaches this server at, from the socket the request came in
// on (never from the Host header, which the client chooses).
export function localAddress(req: IncomingMessage): string {
  const addr = (req.socket.localAddress ?? '127.0.0.1').replace(/^::ffff:/, '');
  return `${isIP(addr) === 6 ? `[${addr}]` : addr}:${req.socket.localPort}`;
}
