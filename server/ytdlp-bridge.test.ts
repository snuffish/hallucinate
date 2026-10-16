import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { remoteSite } from '../src/remote/client';
import { fetchPath, filePath, type Progress, type SiteName } from '../src/remote/wire';
import { createBridge, safeFileName, trimCache, type YtDlp } from './ytdlp-bridge';

describe('safeFileName', () => {
  it('takes what yt-dlp writes', () => {
    expect(safeFileName('dQw4w9WgXcQ.mp4')).toBe(true);
    expect(safeFileName('123456789.m4a')).toBe(true);
  });
  it('refuses dot names and anything that could leave the cache', () => {
    for (const n of ['.', '..', '../x', '.hidden', 'a/b', 'a..b', '']) expect(safeFileName(n), n).toBe(false);
  });
});

describe('trimCache', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('removes the least recently used files until the cache fits, keeping the new one and partial files', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hallucinate-cache-test-'));
    const file = (name: string, size: number, age: number) => {
      writeFileSync(join(dir, name), Buffer.alloc(size));
      const t = Date.now() / 1000 - age;
      utimesSync(join(dir, name), t, t);
    };
    file('old.mp4', 100, 300);
    file('mid.mp4', 100, 200);
    file('busy.mp4.part', 100, 400);
    file('new.mp4', 100, 0);
    await trimCache(dir, 'new.mp4', 250);
    expect(readdirSync(dir).sort()).toEqual(['busy.mp4.part', 'new.mp4']);
  });
});

// The browser's client against the bridge on a real HTTP server, with a script standing in for yt-dlp.
describe('the bridge and its browser client', () => {
  const servers: Server[] = [];
  const dirs: string[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  type Run = Parameters<YtDlp>[1];
  interface Script {
    help?: string;
    search?: object;
    // A download: write the file into `cache` and say where with an `@@D|` line.
    download?: (o: Run, cache: string) => Promise<string>;
  }

  async function start(site: SiteName, script: Script) {
    const cache = mkdtempSync(join(tmpdir(), 'ytdlp-bridge-test-'));
    dirs.push(cache);
    const calls: string[][] = [];
    const run: YtDlp = async (args, o) => {
      calls.push(args);
      if (args.includes('--help')) return script.help ?? '';
      if (args.includes('-J')) return JSON.stringify(script.search ?? { entries: [] });
      if (!script.download) throw new Error('ERROR: no download scripted');
      return script.download(o, cache);
    };
    const server = createServer(createBridge(site, { run, cacheDir: cache }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const downloads = () => calls.filter((a) => a.includes('--no-simulate')).length;
    return { client: remoteSite(site, { base }), base, cache, calls, downloads };
  }

  // A download that reports `lines`, waits for `gate`, then leaves `name` holding `body` in the cache.
  const downloading = (lines: string[], name = 'abc.m4a', body = 'hello world', gate?: Promise<void>) =>
    async (o: Run, cache: string) => {
      lines.forEach((l) => o.onLine?.(l));
      await gate;
      writeFileSync(join(cache, name), body);
      o.onLine?.(`@@D|${join(cache, name)}`);
      return '';
    };
  const TRACK = 'https://soundcloud.com/artist/track';

  it('searches, keeping a result that has no duration or artwork', async () => {
    const { client, calls } = await start('soundcloud', { search: { entries: [
      { webpage_url: TRACK, title: 'Track', uploader: 'Artist', duration: 201.5, thumbnails: [{ id: 't300x300', url: 'https://i1.sndcdn.com/a.jpg' }] },
      { webpage_url: 'https://soundcloud.com/artist/live', title: 'Live set' },
      { title: 'No link, left out' },
    ] } });
    expect(await client.search('  deep house ')).toEqual([
      { url: TRACK, title: 'Track', artist: 'Artist', duration: 201.5, artwork: 'https://i1.sndcdn.com/a.jpg' },
      { url: 'https://soundcloud.com/artist/live', title: 'Live set', artist: '', duration: null, artwork: null },
    ]);
    expect(calls[0]!.at(-1)).toBe('scsearch20:deep house');
  });

  it("refuses another site's link with the reason", async () => {
    const { client, calls } = await start('soundcloud', {});
    await expect(client.search('https://evil.example/track')).rejects.toThrow('Only soundcloud.com links are supported here');
    expect(calls).toHaveLength(0);
  });

  it('lends YouTube a JavaScript runtime when yt-dlp takes one, asking it once', async () => {
    const { client, calls } = await start('youtube', { help: '  --js-runtimes RUNTIMES' });
    await client.search('a');
    await client.search('b');
    expect(calls.filter((a) => a.includes('--help'))).toHaveLength(1);
    expect(calls.filter((a) => a.includes('-J')).every((a) => a[0] === '--js-runtimes')).toBe(true);
  });

  it("downloads with live progress, saying null for what yt-dlp doesn't know, then serves the file", async () => {
    const { client, base } = await start('soundcloud', { download: downloading([
      '@@F|251',
      '@@P|downloading|500|1000|NA|NA|NA|NA|NA|251',
      '@@P|finished|1000|1000|NA|2048|0|NA|NA|251',
    ]) });
    const seen: Progress[] = [];
    const src = await client.download(TRACK, (p) => seen.push(p)).promise;
    expect(seen).toEqual([
      { percent: 50, stage: 'audio', bytes: 500, total: 1000, speed: null, eta: null },
      { percent: 99.5, stage: 'finishing', bytes: 1000, total: 1000, speed: 2048, eta: 0 },
    ]);
    expect(src).toBe(filePath('soundcloud', 'abc.m4a'));

    const whole = await fetch(base + src);
    expect(whole.headers.get('content-type')).toBe('audio/mp4');
    expect(await whole.text()).toBe('hello world');
    const part = await fetch(base + src, { headers: { Range: 'bytes=6-' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 6-10/11');
    expect(await part.text()).toBe('world');
  });

  it('answers a fetch without an event stream once, with the file', async () => {
    const { base } = await start('soundcloud', { download: downloading([]) });
    const res = await fetch(base + fetchPath('soundcloud', TRACK));
    expect(await res.json()).toEqual({ src: filePath('soundcloud', 'abc.m4a') });
  });

  it('serves only names yt-dlp writes, and only what is in the cache', async () => {
    const { base } = await start('soundcloud', {});
    expect((await fetch(base + filePath('soundcloud', '.hidden'))).status).toBe(400);
    expect((await fetch(base + filePath('soundcloud', 'gone.m4a'))).status).toBe(404);
  });

  it('runs one download per link: a second request follows the running one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { client, downloads } = await start('soundcloud', { download: downloading(['@@P|downloading|1|4|NA|NA|NA|NA|NA|251'], 'abc.m4a', 'x', gate) });
    const first: Progress[] = [], second: Progress[] = [];
    const a = client.download(TRACK, (p) => first.push(p));
    await vi.waitFor(() => expect(first).toHaveLength(1));
    const b = client.download(TRACK, (p) => second.push(p));
    await vi.waitFor(() => expect(second).toEqual(first));   // it joins with the latest progress
    release();
    expect(await Promise.all([a.promise, b.promise])).toEqual([filePath('soundcloud', 'abc.m4a'), filePath('soundcloud', 'abc.m4a')]);
    expect(downloads()).toBe(1);
  });

  it('stops yt-dlp once every download of the link is cancelled', async () => {
    let signal: AbortSignal | undefined;
    const { client } = await start('soundcloud', {
      download: (o) => {
        signal = o.signal;
        o.onLine?.('@@P|downloading|1|4|NA|NA|NA|NA|NA|251');
        return new Promise((_, reject) => o.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      },
    });
    const seen: Progress[] = [];
    const a = client.download(TRACK, (p) => seen.push(p));
    const b = client.download(TRACK, () => {});
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    a.cancel();
    await expect(a.promise).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((r) => setTimeout(r, 50));
    expect(signal?.aborted).toBe(false);   // the other download still wants it
    b.cancel();
    await expect(b.promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it('retries a refused (403) download once', async () => {
    let tries = 0;
    const ok = downloading([]);
    const { client } = await start('youtube', {
      download: (o, cache) => (++tries === 1 ? Promise.reject(new Error('HTTP Error 403: Forbidden')) : ok(o, cache)),
    });
    await expect(client.download('https://www.youtube.com/watch?v=abc', () => {}).promise).resolves.toBe(filePath('youtube', 'abc.m4a'));
    expect(tries).toBe(2);
  });

  it('fails with what to do when YouTube refuses twice', async () => {
    const { client } = await start('youtube', { download: () => Promise.reject(new Error('HTTP Error 403: Forbidden')) });
    await expect(client.download('https://www.youtube.com/watch?v=abc', () => {}).promise).rejects.toThrow(/refused the download \(HTTP 403\)\. Update yt-dlp/);
  });

  it('fails a download that left no file', async () => {
    const { client } = await start('soundcloud', { download: async () => '' });
    await expect(client.download(TRACK, () => {}).promise).rejects.toThrow("Nothing was downloaded (live streams aren't supported).");
  });
});
