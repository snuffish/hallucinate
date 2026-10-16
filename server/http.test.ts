import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { readBody, requestUrl } from './http';

describe('the HTTP edge', () => {
  it('sees the path the client asked for, under Vite (which strips the mount prefix) or the desktop server', () => {
    expect(requestUrl({ url: '/search?q=x', originalUrl: '/api/soundcloud/search?q=x' } as IncomingMessage & { originalUrl: string }).pathname).toBe('/api/soundcloud/search');
    expect(requestUrl({ url: '/api/soundcloud/search?q=x' } as IncomingMessage).searchParams.get('q')).toBe('x');
  });

  it('reads a body, and cuts one off past the limit', async () => {
    const ok = new PassThrough();
    const read = readBody(ok as unknown as IncomingMessage, 10);
    ok.end('{"a":1}');
    expect(await read).toBe('{"a":1}');

    const big = new PassThrough();
    const tooBig = readBody(big as unknown as IncomingMessage, 4, 'conversation too large');
    big.write('12345');
    await expect(tooBig).rejects.toThrow('conversation too large');
  });
});
