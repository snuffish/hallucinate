import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ServerLog, createLogRoute, formatServerArgs, logged, sseLine } from './log';

describe('ServerLog', () => {
  it('keeps the newest lines and tells its listeners each new one', () => {
    const log = new ServerLog(2);
    const heard: string[] = [];
    const off = log.listen((l) => heard.push(l.text));
    log.push('info', 'a');
    log.push('warn', 'b');
    off();
    log.push('error', 'c', 'stack');
    expect(log.backlog().map((l) => [l.id, l.level, l.text])).toEqual([[2, 'warn', 'b'], [3, 'error', 'c']]);
    expect(log.backlog()[1]!.detail).toBe('stack');
    expect(heard).toEqual(['a', 'b']);
  });

  it('marks who said a line: the server, or the desktop app\'s main process it runs in', () => {
    const log = new ServerLog();
    log.push('info', 'request');
    log.push('warn', 'window hung', undefined, 'desktop');
    expect(log.backlog().map((l) => l.origin)).toEqual(['server', 'desktop']);
  });

  it('prints arguments the way node does, the first line apart', () => {
    expect(formatServerArgs(['[assistant]', { a: [1] }])).toEqual({ text: '[assistant] { a: [ 1 ] }' });
    expect(formatServerArgs(['one\ntwo\nthree'])).toEqual({ text: 'one', detail: 'two\nthree' });
  });

  it('frames a line as a server-sent event', () => {
    const line = new ServerLog().push('info', 'hi');
    expect(sseLine(line)).toBe(`event: line\ndata: ${JSON.stringify(line)}\n\n`);
  });
});

describe('/api/log', () => {
  let server: Server;
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  const start = async (log: ServerLog) => {
    const route = createLogRoute(log);
    server = createServer(logged((req, res) => (req.url === '/log' ? route(req, res) : (res.writeHead(req.url === '/missing' ? 404 : 200), res.end())), log));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return (server.address() as AddressInfo).port;
  };

  it('streams the lines so far, then each new one', async () => {
    const log = new ServerLog();
    log.push('warn', 'before');
    const port = await start(log);
    const body = await new Promise<string>((resolve, reject) => {
      get({ host: '127.0.0.1', port, path: '/log' }, (res) => {
        expect(res.headers['content-type']).toBe('text/event-stream');
        let raw = '';
        res.on('data', (c: Buffer) => {
          raw += c;
          if (raw.includes('before') && !raw.includes('after')) log.push('info', 'after');
          if (raw.includes('after')) { res.destroy(); resolve(raw); }
        });
      }).on('error', reject);
    });
    const lines = body.split('\n\n').filter(Boolean).map((e) => JSON.parse(e.split('data: ')[1]!) as { text: string });
    expect(lines.map((l) => l.text)).toEqual(['before', 'after']);
  });

  it('shows the log only on this computer', async () => {
    const port = await start(new ServerLog());
    const status = await new Promise<number>((resolve, reject) => {
      get({ host: '127.0.0.1', port, path: '/log', headers: { host: `192.168.1.20:${port}` } }, (res) => { res.resume(); resolve(res.statusCode!); }).on('error', reject);
    });
    expect(status).toBe(403);
  });

  it('logs each request once it is answered, the query left out', async () => {
    const log = new ServerLog();
    const port = await start(log);
    const fetchStatus = (path: string) => new Promise<void>((resolve, reject) => { get({ host: '127.0.0.1', port, path }, (res) => { res.resume(); res.on('end', resolve); }).on('error', reject); });
    await fetchStatus('/ok?q=secret');
    await fetchStatus('/missing');
    await new Promise((r) => setTimeout(r, 20));
    const lines = log.backlog().map((l) => [l.level, l.text.replace(/\(\d+ ms\)/, '(n ms)')]);
    expect(lines).toEqual([['debug', 'GET /ok → 200 (n ms)'], ['warn', 'GET /missing → 404 (n ms)']]);
  });
});
