import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { hostAllowed, hostName, localAddress, refusal } from './guard';

const req = (headers: Record<string, string>, method = 'GET') => ({ method, headers }) as unknown as IncomingMessage;

describe('hostAllowed', () => {
  it('takes loopback names and IP literals, which DNS rebinding cannot forge', () => {
    for (const h of ['localhost:5173', '127.0.0.1:47741', '[::1]:5173', 'app.localhost', '192.168.1.20:5173']) expect(hostAllowed(h), h).toBe(true);
  });
  it('refuses other names unless listed', () => {
    expect(hostAllowed('evil.test:47741')).toBe(false);
    expect(hostAllowed(undefined)).toBe(false);
    expect(hostAllowed('studio.lan:5173', ['studio.lan'])).toBe(true);
  });
  it('reads the name without port or brackets', () => {
    expect(hostName('[::1]:80')).toBe('::1');
    expect(hostName('Example.COM:1')).toBe('example.com');
  });
});

describe('refusal', () => {
  const host = '127.0.0.1:47741';
  it('lets the app and local tools through', () => {
    expect(refusal(req({ host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, 'POST'))).toBeNull();
    expect(refusal(req({ host, 'content-type': 'application/json' }, 'POST'))).toBeNull();   // the CLI's MCP calls
    expect(refusal(req({ host }))).toBeNull();
  });
  it('refuses other sites, rebound hosts and non-JSON posts', () => {
    expect(refusal(req({ host: 'evil.test:47741' }))).toMatch(/host/i);
    expect(refusal(req({ host, origin: 'https://evil.test', 'content-type': 'application/json' }, 'POST'))).toMatch(/origin/i);
    expect(refusal(req({ host, origin: 'null', 'content-type': 'application/json' }, 'POST'))).toMatch(/origin/i);
    expect(refusal(req({ host, 'sec-fetch-site': 'cross-site' }))).toMatch(/site/i);   // <img src> from another page
    expect(refusal(req({ host, 'content-type': 'text/plain' }, 'POST'))).toMatch(/JSON/);
  });
});

describe('localAddress', () => {
  const at = (localAddress: string, localPort: number) => ({ socket: { localAddress, localPort } }) as unknown as IncomingMessage;
  it('names the socket the request came in on', () => {
    expect(localAddress(at('127.0.0.1', 5173))).toBe('127.0.0.1:5173');
    expect(localAddress(at('::ffff:127.0.0.1', 5173))).toBe('127.0.0.1:5173');
    expect(localAddress(at('::1', 5173))).toBe('[::1]:5173');
  });
});
