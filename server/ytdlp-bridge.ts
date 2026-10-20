// yt-dlp bridge for the dev / preview server and the desktop app: SoundCloud audio and YouTube video.
//
// Browsers can't analyse audio from SoundCloud's player or read pixels from YouTube's (both are
// cross-origin iframes), so tracks and videos are fetched with yt-dlp into a temp cache and served
// from this origin. Only each site's own links are accepted, and yt-dlp is spawned without a shell.
// The routes and their answers are declared in src/remote/wire.ts, which the browser's client parses
// them with. /fetch without "Accept: text/event-stream" answers once, with { src } or { error }.

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { requestUrl, sendJSON, sseEvent, startEventStream } from './http';
import { filePath, sitePrefix, type FetchEvent, type FetchEventName, type Progress, type RemoteTrack, type SearchResponse, type SiteName } from '../src/remote/wire';

const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
};
const MISSING = 'yt-dlp is not installed. Install it with "sudo pacman -S yt-dlp" (or "pip install yt-dlp"), then restart the server.';
const FORBIDDEN = 'YouTube refused the download (HTTP 403). Update yt-dlp (e.g. "sudo pacman -Syu yt-dlp yt-dlp-ejs") — YouTube changes often — and try again.';

type Env = Record<string, string>;
type HttpError = Error & { status?: number };
const httpError = (message: string, status: number): HttpError => Object.assign(new Error(message), { status });

interface Listener { progress(p: Progress): void; done(src: string): void; failed(error: string): void }
interface Job { last: Progress | null; add(l: Listener): void; remove(l: Listener): void }

// Runs yt-dlp with `args`; `onLine` sees every output line as it arrives. Resolves with stdout, rejects
// with yt-dlp's error (an HttpError). The bridge's seam: spawnYtDlp in the server, a script in the tests.
export type YtDlp = (args: string[], o: { timeoutMs: number; onLine?: (line: string) => void; signal?: AbortSignal }) => Promise<string>;

interface Site { hosts: string[]; jsRuntime?: boolean; search(q: string): string; download: string[] }

export const SITES = {
  soundcloud: {
    hosts: ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com', 'on.soundcloud.com', 'api.soundcloud.com'],
    search: (q) => `scsearch20:${q}`,
    download: ['-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio'],
  },
  youtube: {
    hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'],
    jsRuntime: true,
    search: (q) => `ytsearch15:${q}`,
    // Up to 720p, H.264 first (plays everywhere), video + sound merged into one mp4 (needs ffmpeg).
    download: [
      '-f', 'bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]/b',
      '--merge-output-format', 'mp4', '--match-filter', '!is_live',
    ],
  },
} satisfies Record<SiteName, Site>;

// A cached file's name: what yt-dlp writes (`<id>.<ext>`), never `.` or `..`.
export const safeFileName = (name: string): boolean => /^[\w-][\w.-]*$/.test(name) && !name.includes('..');

export interface BridgeOptions {
  ytdlp?: string;         // the program (YTDLP, see programs.ts), else `yt-dlp`
  env?: Env;              // added to its environment (the desktop app uses it, see jsRuntime())
  run?: YtDlp;            // instead of spawning `ytdlp` with `env`
  cacheDir?: string;      // where the files go, else a folder per site in the temp directory
  cacheBytes?: number;    // trimmed (oldest first) to this size after every download
}

const DEFAULT_CACHE_BYTES = 2048 * 1024 * 1024;

export function createBridge(name: SiteName, { ytdlp = 'yt-dlp', env, run = spawnYtDlp(ytdlp, env), cacheDir, cacheBytes = DEFAULT_CACHE_BYTES }: BridgeOptions = {}) {
  const site: Site = SITES[name];
  const cache = cacheDir ?? join(tmpdir(), `hallucinate-${name}`);
  const prefix = sitePrefix(name);

  // YouTube only hands out working video URLs to clients that solve its JavaScript challenge; without a
  // JS runtime yt-dlp gets intermittent "HTTP Error 403: Forbidden". Lend it the Node that runs this server
  // (needs a yt-dlp with --js-runtimes, plus its yt-dlp-ejs solver scripts).
  // Inside the desktop app execPath is the Electron binary; the app passes ELECTRON_RUN_AS_NODE=1 in `env`
  // so that binary behaves as plain Node for yt-dlp.
  let jsRuntimeArgs: Promise<string[]> | undefined;
  function jsRuntime(): Promise<string[]> {
    if (!site.jsRuntime) return Promise.resolve([]);
    jsRuntimeArgs ??= run(['--help'], { timeoutMs: 15_000 })
      .then((help) => (help.includes('--js-runtimes') ? ['--js-runtimes', `node:${process.execPath}`] : []))
      .catch(() => []);
    return jsRuntimeArgs;
  }

  async function search(query: string): Promise<RemoteTrack[]> {
    query = query.trim();
    if (!query) return [];
    const target = /^https?:\/\//i.test(query) ? siteUrl(query) : site.search(query);
    const data = JSON.parse(await run([...await jsRuntime(), '-J', '--flat-playlist', '--no-warnings', '--', target], { timeoutMs: 30_000 }));
    const entries: Record<string, unknown>[] = (data.entries ?? [data]).filter(Boolean);
    return entries.flatMap((e) => {
      const url = (e.webpage_url ?? e.url) as string | undefined;
      return url ? [{
        url,
        title: (e.title as string | undefined) ?? 'Untitled',
        artist: ((e.uploader ?? e.channel) as string | undefined) ?? '',
        duration: (e.duration as number | undefined) ?? null,
        artwork: pickArtwork(e.thumbnails as Thumb[] | undefined) ?? (e.thumbnail as string | undefined) ?? null,
      }] : [];
    });
  }

  // Progress lines from yt-dlp ("@@P|status|bytes|total|estimate|speed|eta|fragment|fragments|format").
  const PROGRESS = '@@P|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.fragment_index)s|%(progress.fragment_count)s|%(info.format_id)s';

  async function fetchFile(url: string, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<string> {
    await mkdir(cache, { recursive: true });
    // yt-dlp skips the download when the file is already cached, and still prints its path.
    const args = [
      ...await jsRuntime(),
      '--no-playlist', '--no-warnings', '-q', '-N', '4', ...site.download,
      '-o', join(cache, '%(id)s.%(ext)s'),
      '--progress', '--newline', '--progress-template', `download:${PROGRESS}`,
      '--print', 'before_dl:@@F|%(format_id)s',
      '--print', 'after_move:@@D|%(filepath)s', '--no-simulate',
      '--', url,
    ];
    const attempt = (): Promise<string | null> => {
      const progress = progressTracker(onProgress);
      let file: string | null = null;
      return run(args, {
        timeoutMs: 60 * 60_000,
        signal,
        onLine: (line) => {
          if (line.startsWith('@@D|')) file = line.slice(4);
          else progress(line);
        },
      }).then(() => file);
    };
    let file: string | null;
    try {
      file = await attempt();
    } catch (err) {
      if (!/\b403\b/.test((err as Error).message)) throw err;
      try {
        file = await attempt();   // a single refused request is common; the retry usually works
      } catch (again) {
        throw /\b403\b/.test((again as Error).message) ? httpError(FORBIDDEN, 502) : again;
      }
    }
    if (!file) throw httpError('Nothing was downloaded (live streams aren\'t supported).', 502);
    await trimCache(cache, basename(file), cacheBytes).catch(() => {});
    return filePath(name, basename(file));
  }

  // One download per link: a second request for the same link follows the running one. When nobody
  // is listening any more (you picked something else, or the client went away), the download stops;
  // yt-dlp resumes it next time.
  const jobs = new Map<string, Job>();
  function job(link: string): Job {
    const url = siteUrl(link);
    const running = jobs.get(url);
    if (running) return running;
    const listeners = new Set<Listener>();
    const controller = new AbortController();
    const j: Job = {
      last: null,
      add(l) { listeners.add(l); if (j.last) l.progress(j.last); },
      remove(l) {
        listeners.delete(l);
        if (!listeners.size && jobs.get(url) === j) { jobs.delete(url); controller.abort(); }
      },
    };
    jobs.set(url, j);
    fetchFile(url, (p) => { j.last = p; listeners.forEach((l) => l.progress(p)); }, controller.signal)
      .then((src) => listeners.forEach((l) => l.done(src)), (err: Error) => { if (!controller.signal.aborted) listeners.forEach((l) => l.failed(err.message)); })
      .finally(() => { if (jobs.get(url) === j) jobs.delete(url); });
    return j;
  }

  function streamFetch(req: IncomingMessage, res: ServerResponse, link: string): void {
    startEventStream(res);
    const send = <K extends FetchEventName>(event: K, data: FetchEvent<K>) => res.write(sseEvent(event, data));
    let j: Job;
    try {
      j = job(link);
    } catch (err) {
      send('failed', { error: (err as Error).message });
      res.end();
      return;
    }
    const listener: Listener = {
      progress: (p) => send('progress', p),
      done: (src) => { send('done', { src }); res.end(); },
      failed: (error) => { send('failed', { error }); res.end(); },
    };
    j.add(listener);
    req.on('close', () => j.remove(listener));
  }

  // The plain JSON form follows the same job, so it is shared and stops when the client goes away.
  function plainFetch(req: IncomingMessage, res: ServerResponse, link: string): void {
    const j = job(link);
    const listener: Listener = {
      progress: () => {},
      done: (src) => sendJSON(res, 200, { src }),
      failed: (error) => sendJSON(res, 502, { error }),
    };
    j.add(listener);
    req.on('close', () => j.remove(listener));
  }

  async function serveFile(req: IncomingMessage, res: ServerResponse, fileName: string): Promise<void> {
    try {
      fileName = decodeURIComponent(fileName);
    } catch {
      return sendJSON(res, 400, { error: 'Bad file name' });
    }
    if (!safeFileName(fileName)) return sendJSON(res, 400, { error: 'Bad file name' });
    const file = join(cache, fileName);
    let size: number;
    try {
      const s = await stat(file);
      if (!s.isFile()) return sendJSON(res, 404, { error: 'Not in cache' });
      size = s.size;
    } catch {
      return sendJSON(res, 404, { error: 'Not in cache' });
    }
    const headers = { 'Content-Type': TYPES[extname(fileName)] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (!range) {
      res.writeHead(200, { ...headers, 'Content-Length': size });
      return pipeFile(file, res);
    }
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) return void res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    pipeFile(file, res, { start, end });
  }

  function siteUrl(text: string): string {
    let u: URL;
    try {
      u = new URL(text);
    } catch {
      throw httpError('Not a valid link', 400);
    }
    if (!/^https?:$/.test(u.protocol) || !site.hosts.includes(u.hostname)) {
      throw httpError(`Only ${site.hosts[0]} links are supported here`, 400);
    }
    return u.href;
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = requestUrl(req);
      const route = url.pathname.slice(prefix.length);
      if (route === 'search') return sendJSON(res, 200, { results: await search(url.searchParams.get('q') ?? '') } satisfies SearchResponse);
      if (route === 'fetch') {
        const link = url.searchParams.get('url') ?? '';
        if ((req.headers.accept ?? '').includes('text/event-stream')) return streamFetch(req, res, link);
        return plainFetch(req, res, link);
      }
      if (route.startsWith('file/')) return await serveFile(req, res, route.slice(5));
      sendJSON(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      sendJSON(res, (err as HttpError).status ?? 502, { error: (err as Error).message });
    }
  };
}

// Streams a file; a read error (the file vanished) ends the response instead of crashing the server.
function pipeFile(file: string, res: ServerResponse, range?: { start: number; end: number }): void {
  createReadStream(file, range)
    .on('error', () => res.destroy())
    .pipe(res);
}

// Deletes the least recently used files until the cache fits in `limit` bytes. `keep` (just
// downloaded) and yt-dlp's partial files are never removed.
export async function trimCache(dir: string, keep: string, limit: number): Promise<void> {
  const files = await Promise.all((await readdir(dir)).map(async (name) => {
    const s = await stat(join(dir, name)).catch(() => null);
    return s?.isFile() ? { name, size: s.size, used: Math.max(s.atimeMs, s.mtimeMs) } : null;
  }));
  const present = files.filter((f) => f !== null);
  let total = present.reduce((sum, f) => sum + f.size, 0);
  for (const f of present.sort((a, b) => a.used - b.used)) {
    if (total <= limit) break;
    if (f.name === keep || f.name.endsWith('.part') || f.name.endsWith('.ytdl')) continue;
    await rm(join(dir, f.name), { force: true });
    total -= f.size;
  }
}

// Runs the yt-dlp program `bin`, with `env` added to its environment.
export const spawnYtDlp = (bin: string, env?: Env): YtDlp => (args, { timeoutMs, onLine, signal }) =>
  new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], signal, env: env ? { ...process.env, ...env } : process.env });
    let stdout = '', stderr = '';
    const lines = (stream: NodeJS.ReadableStream, append: (d: string) => void) => {
      let rest = '';
      stream.on('data', (d: Buffer) => {
        append(String(d));
        if (!onLine) return;
        const parts = (rest + d).split(/\r?\n/);
        rest = parts.pop() ?? '';
        parts.forEach((l) => l && onLine(l));
      });
    };
    lines(proc.stdout, (d) => (stdout += d));
    lines(proc.stderr, (d) => (stderr += d));
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? httpError(MISSING, 503) : err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      const reason = stderr.trim().split('\n').filter((l) => l.includes('ERROR')).pop() ?? `yt-dlp exited with code ${code}`;
      reject(httpError(reason.replace(/^ERROR:\s*/, ''), 502));
    });
  });

// Turns yt-dlp's progress lines into one overall percentage. A video + sound download fetches two
// streams (video first, ~92 % of the bytes), then merges them.
function progressTracker(onProgress: (p: Progress) => void): (line: string) => void {
  let streams = 1, stream = -1, current: string | null = null, best = 0;
  const n = (v: string | undefined): number | null => (v === undefined || v === 'NA' || v === 'None' ? null : Number(v));
  return (line) => {
    if (line.startsWith('@@F|')) { streams = line.slice(4).split('+').length; return; }
    if (!line.startsWith('@@P|')) return;
    const [status, done, total, estimate, speed, eta, frag, frags, format] = line.slice(4).split('|');
    if (format !== current) { current = format ?? null; stream++; }
    const size = n(total) ?? n(estimate);
    // An exact size beats counting fragments, which beats yt-dlp's (jumpy) size estimate.
    const part = status === 'finished' ? 1 : n(total) ? n(done)! / n(total)! : n(frags) ? n(frag)! / n(frags)! : size ? n(done)! / size : 0;
    const weights = streams === 2 ? [0.92, 0.08] : Array<number>(streams).fill(1 / streams);
    const i = Math.min(stream, streams - 1);
    const percent = (weights.slice(0, i).reduce((a, b) => a + b, 0) + weights[i]! * Math.min(1, part)) * 100;
    const last = status === 'finished' && i === streams - 1;
    best = Math.max(best, Math.min(99.5, percent));   // the bar never moves backwards
    onProgress({
      percent: best,
      stage: last ? (streams > 1 ? 'merging' : 'finishing') : streams > 1 ? (i === 0 ? 'video' : 'sound') : 'audio',
      bytes: n(done), total: size, speed: n(speed), eta: n(eta),
    });
  };
}

interface Thumb { id?: string; url?: string; width?: number }

// SoundCloud names its sizes; YouTube lists widths. Aim for ~300 px.
function pickArtwork(thumbs: Thumb[] = []): string | undefined {
  const named = thumbs.find((t) => t.id === 't300x300') ?? thumbs.find((t) => t.id === 'large');
  if (named) return named.url;
  const sized = thumbs.filter((t) => t.width).sort((a, b) => Math.abs(a.width! - 320) - Math.abs(b.width! - 320));
  return (sized[0] ?? thumbs.at(-1))?.url;
}
