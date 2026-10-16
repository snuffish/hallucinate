import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from './adapters';
import { memoryConfigStore, type ConfigStore, type Secrets, type StoredConfig } from './config';
import { guarded } from './guard';
import { apiRoutes } from './routes';
import { createSettingsRoute, type SettingsView } from './settings-route';

const secrets: Secrets = {
  encrypt: (s) => Buffer.from(`enc:${s}`).toString('base64'),
  decrypt: (s) => Buffer.from(s, 'base64').toString().replace(/^enc:/, ''),
};
const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';

describe('/api/settings', () => {
  let server: Server;
  let port: number;
  let config: ConfigStore;
  let env: NodeJS.ProcessEnv;
  let resets: number;
  const detected: { value: Backend } = { value: 'claude-code' };

  const start = async (store: ConfigStore) => {
    config = store;
    const route = createSettingsRoute(store, {
      env,
      backend: { get: async () => detected.value, reset: () => { resets++; } },
      paths: { claudeBin: 'claude', ytdlp: 'yt-dlp' },
    });
    server = createServer(guarded(route, []));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  };

  // http.request, so a test can send any Host header.
  const call = (method: 'GET' | 'POST', body?: unknown, host = `127.0.0.1:${port}`) => new Promise<{ status: number; json: SettingsView & { error?: string }; raw: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: '/', headers: { host, ...(body !== undefined && { 'content-type': 'application/json' }) } }, (res) => {
      let raw = '';
      res.on('data', (c: Buffer) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode!, json: JSON.parse(raw), raw }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });

  beforeEach(() => { env = {}; resets = 0; detected.value = 'claude-code'; });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it('describes each field, where it comes from and what there is to choose', async () => {
    env = { ASSISTANT_EFFORT: 'low' };
    await start(memoryConfigStore({ v: 1, model: 'opus' }, secrets));
    const { status, json } = await call('GET');
    expect(status).toBe(200);
    expect(json.model).toEqual({ value: 'opus', source: 'settings', locked: false });
    expect(json.effort).toEqual({ value: 'low', source: 'env', locked: true });
    expect(json.backend).toEqual({ value: 'auto', source: 'default', locked: false });
    expect(json.apiKey).toMatchObject({ set: false, editable: true });
    expect(json.detected).toBe('claude-code');
    expect(json.canWrite).toBe(true);
    expect(json.options.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(json.options.apiModels).toContain('claude-opus-5-5');
    expect(json.paths).toEqual({ claudeBin: 'claude', ytdlp: 'yt-dlp' });
  });

  it('saves a change, re-detects the backend and answers with the new state', async () => {
    await start(memoryConfigStore({ v: 1 }, secrets));
    const { status, json } = await call('POST', { model: 'sonnet', effort: 'medium', directorEffort: 'low' });
    expect(status).toBe(200);
    expect(json.model).toMatchObject({ value: 'sonnet', source: 'settings' });
    expect(json.directorEffort).toMatchObject({ value: 'low', source: 'settings' });
    expect(config.read()).toEqual({ v: 1, model: 'sonnet', effort: 'medium', directorEffort: 'low' });
    expect(resets).toBe(1);
    await call('POST', { model: null });
    expect(config.read()).toEqual({ v: 1, effort: 'medium', directorEffort: 'low' });
  });

  it('stores the API key encrypted and never sends it back', async () => {
    await start(memoryConfigStore({ v: 1 }, secrets));
    const saved = await call('POST', { apiKey: KEY });
    expect(saved.status).toBe(200);
    expect(saved.json.apiKey).toMatchObject({ set: true, source: 'settings' });
    expect(saved.raw).not.toContain(KEY);
    expect((await call('GET')).raw).not.toContain(KEY);
    const stored = config.read() as StoredConfig;
    expect(stored.apiKey).not.toContain(KEY);
    expect(secrets.decrypt(stored.apiKey!)).toBe(KEY);
    expect((await call('POST', { apiKey: null })).json.apiKey.set).toBe(false);
    expect(config.read().apiKey).toBeUndefined();
  });

  it('refuses an API key where it can\'t be stored safely', async () => {
    await start(memoryConfigStore({ v: 1 }, null));
    expect((await call('GET')).json.apiKey.editable).toBe(false);
    const res = await call('POST', { apiKey: KEY });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(config.read()).toEqual({ v: 1 });
  });

  it('will not override the environment', async () => {
    env = { ASSISTANT_MODEL: 'claude-sonnet-5-5', ANTHROPIC_API_KEY: KEY };
    await start(memoryConfigStore({ v: 1 }, secrets));
    expect((await call('POST', { model: 'opus' })).status).toBe(409);
    const key = await call('POST', { apiKey: 'sk-ant-api03-somethingelse-entirely' });
    expect(key.status).toBe(409);
    expect(key.json.error).toMatch(/ANTHROPIC_API_KEY/);
    expect((await call('GET')).json.apiKey).toMatchObject({ set: true, source: 'env', locked: true, editable: false });
    expect(config.read()).toEqual({ v: 1 });
  });

  it('can only be changed from this computer', async () => {
    await start(memoryConfigStore({ v: 1 }, secrets));
    const lan = await call('POST', { effort: 'max' }, `192.168.1.20:${port}`);
    expect(lan.status).toBe(403);
    expect(config.read()).toEqual({ v: 1 });
    const look = await call('GET', undefined, `192.168.1.20:${port}`);
    expect(look.status).toBe(200);
    expect(look.json.canWrite).toBe(false);
    expect(look.json.apiKey.editable).toBe(false);
    expect((await call('POST', { effort: 'max' }, `localhost:${port}`)).status).toBe(200);
  });

  it('rejects bad values and unknown fields', async () => {
    await start(memoryConfigStore({ v: 1 }, secrets));
    for (const body of [{ effort: 'extreme' }, { backend: 'openai' }, { model: '--dangerous flag' }, { claudeBin: '/bin/sh' }, { apiKey: 'short' }]) {
      const res = await call('POST', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(config.read()).toEqual({ v: 1 });
  });

  it('only takes Anthropic\'s model ids for the API backend', async () => {
    await start(memoryConfigStore({ v: 1, backend: 'api' }, secrets));
    expect((await call('POST', { model: 'opus' })).status).toBe(400);
    expect((await call('POST', { model: 'claude-haiku-5-5' })).status).toBe(200);
    expect((await call('POST', { backend: 'claude-code', model: 'opus' })).status).toBe(200);
  });

  it('is behind the same guard as every other route', async () => {
    await start(memoryConfigStore({ v: 1 }, secrets));
    const res = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'content-type': 'application/json', origin: 'https://evil.test' } }, (r) => { r.resume(); resolve(r.statusCode!); });
      req.on('error', reject);
      req.end(JSON.stringify({ effort: 'max' }));
    });
    expect(res).toBe(403);
    expect(config.read()).toEqual({ v: 1 });
  });
});

describe('a save reaches the assistant without a restart', () => {
  let server: Server;
  afterEach(() => { vi.unstubAllEnvs(); return new Promise<void>((r) => server.close(() => r())); });

  it('re-detects the backend and the model /api/assistant/info reports', async () => {
    for (const name of ['ASSISTANT_BACKEND', 'ASSISTANT_MODEL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) vi.stubEnv(name, '');
    const routes = apiRoutes({ config: memoryConfigStore({ v: 1, backend: 'claude-code' }, secrets) });
    server = createServer((req, res) => {
      const route = routes.find(([prefix]) => req.url!.startsWith(prefix));
      if (route) return void route[1](req, res);
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const info = async () => (await fetch(`${base}/api/assistant/info`)).json();

    expect(await info()).toMatchObject({ backend: 'claude-code' });
    const saved = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ backend: 'api', model: 'claude-haiku-5-5' }) });
    expect(saved.status).toBe(200);
    expect(await info()).toEqual({ backend: 'api', model: 'claude-haiku-5-5' });
  });
});
