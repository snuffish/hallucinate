import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentType, resolveStatic, startServer, type AppServer } from './server';

describe('resolveStatic', () => {
  const root = '/srv/dist';
  it('maps / to index.html and keeps paths inside the root', () => {
    expect(resolveStatic(root, '/')).toBe('/srv/dist/index.html');
    expect(resolveStatic(root, '/output.html?x=1')).toBe('/srv/dist/output.html');
    expect(resolveStatic(root, '/assets/a%20b.js')).toBe('/srv/dist/assets/a b.js');
  });
  it('refuses paths that leave the root', () => {
    expect(resolveStatic(root, '/../package.json')).toBeNull();
    expect(resolveStatic(root, '/%2e%2e/package.json')).toBeNull();
    expect(resolveStatic(root, '/assets/%2e%2e/%2e%2e/secret')).toBeNull();
    expect(resolveStatic(root, '/%E0%A4%A')).toBeNull();
    expect(resolveStatic(root, '/a%00b')).toBeNull();
  });
});

describe('contentType', () => {
  it('knows what Vite emits', () => {
    expect(contentType('x/index.html')).toMatch(/^text\/html/);
    expect(contentType('a.JS')).toMatch(/^text\/javascript/);
    expect(contentType('a.woff2')).toBe('font/woff2');
    expect(contentType('a.unknown')).toBe('application/octet-stream');
  });
});

describe('startServer', () => {
  let dist: string;
  let app: AppServer;
  let base: string;
  const backend = process.env.ASSISTANT_BACKEND;

  beforeAll(async () => {
    process.env.ASSISTANT_BACKEND = 'api';
    dist = mkdtempSync(join(tmpdir(), 'hallucinate-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>app</title>');
    writeFileSync(join(dist, 'output.html'), '<!doctype html><title>projector</title>');
    writeFileSync(join(dist, 'assets', 'a.js'), 'export {}');
    writeFileSync(join(tmpdir(), 'hallucinate-outside.txt'), 'secret');
    app = await startServer({ dist, preferredPort: 0 });
    base = `http://127.0.0.1:${app.port}`;
  });

  afterAll(async () => {
    await app?.close();
    rmSync(dist, { recursive: true, force: true });
    if (backend === undefined) delete process.env.ASSISTANT_BACKEND;
    else process.env.ASSISTANT_BACKEND = backend;
  });

  it('serves the pages and the bundles with their types and caching', async () => {
    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toMatch(/^text\/html/);
    expect(index.headers.get('cache-control')).toBe('no-cache');
    expect(await index.text()).toContain('<title>app</title>');
    expect(await (await fetch(`${base}/output.html`)).text()).toContain('projector');
    const js = await fetch(`${base}/assets/a.js`);
    expect(js.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(js.headers.get('cache-control')).toContain('immutable');
  });

  it('answers 404 for missing files, directories and paths outside dist', async () => {
    expect((await fetch(`${base}/nope.html`)).status).toBe(404);
    expect((await fetch(`${base}/assets`)).status).toBe(404);
    expect((await fetch(`${base}/%2e%2e/hallucinate-outside.txt`)).status).toBe(404);
    expect((await fetch(`${base}/..%2fhallucinate-outside.txt`)).status).toBe(404);
  });

  it('mounts the assistant and the yt-dlp bridges under /api', async () => {
    const info = await (await fetch(`${base}/api/assistant/info`)).json();
    expect(info).toMatchObject({ backend: 'api' });
    // An empty query never spawns yt-dlp.
    expect(await (await fetch(`${base}/api/soundcloud/search?q=`)).json()).toEqual({ results: [] });
    expect((await fetch(`${base}/api/youtube/nope`)).status).toBe(404);
  });

  it('refuses /api calls from other sites and rebound host names', async () => {
    const run = (headers: Record<string, string>) => fetch(`${base}/api/assistant`, { method: 'POST', headers, body: '{}' });
    expect((await run({ 'Content-Type': 'text/plain' })).status).toBe(403);
    expect((await run({ 'Content-Type': 'application/json', Origin: 'https://evil.test' })).status).toBe(403);
    expect((await fetch(`${base}/api/assistant/info`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    // A browser page at the app's own origin gets through.
    expect((await fetch(`${base}/api/assistant/info`, { headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
  });

  it('refuses dot names in the download cache instead of crashing', async () => {
    // Sent as-is (fetch would normalise the dots away), like `curl --path-as-is`.
    const raw = (path: string) => new Promise<number>((done, fail) => {
      request({ host: '127.0.0.1', port: app.port, path }, (res) => { res.resume(); done(res.statusCode ?? 0); }).on('error', fail).end();
    });
    for (const path of ['/api/youtube/file/..', '/api/youtube/file/%2e%2e', '/api/youtube/file/.', '/api/youtube/file/...']) {
      expect([400, 404], path).toContain(await raw(path));
    }
    expect((await fetch(`${base}/api/assistant/info`)).status).toBe(200);   // still up
  });

  it('falls back to another port when the preferred one is taken', async () => {
    const second = await startServer({ dist, preferredPort: app.port });
    try {
      expect(second.fellBack).toBe(true);
      expect(second.port).not.toBe(app.port);
    } finally {
      await second.close();
    }
  });
});
