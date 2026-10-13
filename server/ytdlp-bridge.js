// yt-dlp bridge for the dev / preview server: SoundCloud audio and YouTube video.
//
// Browsers can't analyse audio from SoundCloud's player or read pixels from YouTube's (both are
// cross-origin iframes), so tracks and videos are fetched with yt-dlp into a temp cache and served
// from this origin. Only each site's own links are accepted, and yt-dlp is spawned without a shell.
//
//   GET /api/<site>/search?q=<query or link>  -> { results: [{ url, title, artist, duration, artwork }] }
//   GET /api/<site>/fetch?url=<link>          -> { src }, or with "Accept: text/event-stream" a live stream of
//                                                  `progress` events, then `done` { src } or `failed` { error }
//   GET /api/<site>/file/<name>               -> the file (supports Range, so seeking works)

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';

const YTDLP = process.env.YTDLP || 'yt-dlp';
const TYPES = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
};
const MISSING = 'yt-dlp is not installed. Install it with "sudo pacman -S yt-dlp" (or "pip install yt-dlp"), then restart the server.';
const FORBIDDEN = 'YouTube refused the download (HTTP 403). Update yt-dlp (e.g. "sudo pacman -Syu yt-dlp yt-dlp-ejs") — YouTube changes often — and try again.';

// YouTube only hands out working video URLs to clients that solve its JavaScript challenge; without a
// JS runtime yt-dlp gets intermittent "HTTP Error 403: Forbidden". Lend it the Node that runs this server
// (needs a yt-dlp with --js-runtimes, plus its yt-dlp-ejs solver scripts).
let jsRuntimeArgs;
async function jsRuntime() {
  jsRuntimeArgs ??= ytdlp(['--help'], 15_000)
    .then((help) => (help.includes('--js-runtimes') ? ['--js-runtimes', `node:${process.execPath}`] : []))
    .catch(() => []);
  return jsRuntimeArgs;
}

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
};

export function createBridge(name) {
  const site = SITES[name];
  const cache = join(tmpdir(), `hallucinate-${name}`);
  const prefix = `/api/${name}/`;

  async function search(query) {
    query = query.trim();
    if (!query) return [];
    const target = /^https?:\/\//i.test(query) ? siteUrl(query) : site.search(query);
    const data = JSON.parse(await ytdlp([...(site.jsRuntime ? await jsRuntime() : []), '-J', '--flat-playlist', '--no-warnings', '--', target], 30_000));
    return (data.entries ?? [data]).filter(Boolean).map((e) => ({
      url: e.webpage_url ?? e.url,
      title: e.title ?? 'Untitled',
      artist: e.uploader ?? e.channel ?? '',
      duration: e.duration ?? null,
      artwork: pickArtwork(e.thumbnails) ?? e.thumbnail ?? null,
    })).filter((r) => r.url);
  }

  // Progress lines from yt-dlp ("@@P|status|bytes|total|estimate|speed|eta|fragment|fragments|format").
  const PROGRESS = '@@P|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.fragment_index)s|%(progress.fragment_count)s|%(info.format_id)s';

  async function fetchFile(url, onProgress = () => {}, signal) {
    await mkdir(cache, { recursive: true });
    // yt-dlp skips the download when the file is already cached, and still prints its path.
    const args = [
      ...(site.jsRuntime ? await jsRuntime() : []),
      '--no-playlist', '--no-warnings', '-q', '-N', '4', ...site.download,
      '-o', join(cache, '%(id)s.%(ext)s'),
      '--progress', '--newline', '--progress-template', `download:${PROGRESS}`,
      '--print', 'before_dl:@@F|%(format_id)s',
      '--print', 'after_move:@@D|%(filepath)s', '--no-simulate',
      '--', url,
    ];
    const run = () => {
      const progress = progressTracker(onProgress);
      let file = null;
      return ytdlp(args, 60 * 60_000, {
        signal,
        onLine: (line) => {
          if (line.startsWith('@@D|')) file = line.slice(4);
          else progress(line);
        },
      }).then(() => file);
    };
    let file;
    try {
      file = await run();
    } catch (err) {
      if (!/\b403\b/.test(err.message)) throw err;
      try {
        file = await run();   // a single refused request is common; the retry usually works
      } catch (again) {
        throw /\b403\b/.test(again.message) ? Object.assign(new Error(FORBIDDEN), { status: 502 }) : again;
      }
    }
    if (!file) throw Object.assign(new Error('Nothing was downloaded (live streams aren\'t supported).'), { status: 502 });
    return `${prefix}file/${encodeURIComponent(basename(file))}`;
  }

  // One download per link: a second request for the same link follows the running one. When nobody
  // is listening any more (you picked something else), the download stops; yt-dlp resumes it next time.
  const jobs = new Map();
  function job(link) {
    const url = siteUrl(link);
    if (jobs.has(url)) return jobs.get(url);
    const listeners = new Set();
    const controller = new AbortController();
    const emit = (kind, value) => listeners.forEach((l) => l[kind](value));
    const j = {
      last: null,
      add(l) { listeners.add(l); if (j.last) l.progress(j.last); },
      remove(l) {
        listeners.delete(l);
        if (!listeners.size && jobs.get(url) === j) { jobs.delete(url); controller.abort(); }
      },
    };
    jobs.set(url, j);
    fetchFile(url, (p) => { j.last = p; emit('progress', p); }, controller.signal)
      .then((src) => emit('done', src), (err) => { if (!controller.signal.aborted) emit('failed', err.message); })
      .finally(() => { if (jobs.get(url) === j) jobs.delete(url); });
    return j;
  }

  function streamFetch(req, res, link) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let j;
    try {
      j = job(link);
    } catch (err) {
      send('failed', { error: err.message });
      return res.end();
    }
    const listener = {
      progress: (p) => send('progress', p),
      done: (src) => { send('done', { src }); res.end(); },
      failed: (error) => { send('failed', { error }); res.end(); },
    };
    j.add(listener);
    req.on('close', () => j.remove(listener));
  }

  async function serveFile(req, res, fileName) {
    fileName = decodeURIComponent(fileName);
    if (!/^[\w.-]+$/.test(fileName)) return json(res, 400, { error: 'Bad file name' });
    const file = join(cache, fileName);
    let size;
    try {
      ({ size } = await stat(file));
    } catch {
      return json(res, 404, { error: 'Not in cache' });
    }
    const headers = { 'Content-Type': TYPES[extname(fileName)] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (!range) {
      res.writeHead(200, { ...headers, 'Content-Length': size });
      return createReadStream(file).pipe(res);
    }
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) return res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
  }

  function siteUrl(text) {
    let u;
    try {
      u = new URL(text);
    } catch {
      throw Object.assign(new Error('Not a valid link'), { status: 400 });
    }
    if (!/^https?:$/.test(u.protocol) || !site.hosts.includes(u.hostname)) {
      throw Object.assign(new Error(`Only ${site.hosts[0]} links are supported here`), { status: 400 });
    }
    return u.href;
  }

  return async function handle(req, res) {
    try {
      const url = new URL(req.originalUrl ?? req.url, 'http://localhost');
      const route = url.pathname.slice(prefix.length);
      if (route === 'search') return json(res, 200, { results: await search(url.searchParams.get('q') ?? '') });
      if (route === 'fetch') {
        const link = url.searchParams.get('url') ?? '';
        if ((req.headers.accept ?? '').includes('text/event-stream')) return streamFetch(req, res, link);
        return json(res, 200, { src: await fetchFile(siteUrl(link)) });
      }
      if (route.startsWith('file/')) return serveFile(req, res, route.slice(5));
      json(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      json(res, err.status ?? 502, { error: err.message });
    }
  };
}

// Runs yt-dlp; `onLine` sees every output line as it arrives. Resolves with stdout.
function ytdlp(args, timeoutMs, { onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'], signal });
    let stdout = '', stderr = '';
    const lines = (stream, append) => {
      let rest = '';
      stream.on('data', (d) => {
        append(String(d));
        if (!onLine) return;
        const parts = (rest + d).split(/\r?\n/);
        rest = parts.pop();
        parts.forEach((l) => l && onLine(l));
      });
    };
    lines(proc.stdout, (d) => (stdout += d));
    lines(proc.stderr, (d) => (stderr += d));
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? Object.assign(new Error(MISSING), { status: 503 }) : err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      const reason = stderr.trim().split('\n').filter((l) => l.includes('ERROR')).pop() ?? `yt-dlp exited with code ${code}`;
      reject(Object.assign(new Error(reason.replace(/^ERROR:\s*/, '')), { status: 502 }));
    });
  });
}

// Turns yt-dlp's progress lines into one overall percentage. A video + sound download fetches two
// streams (video first, ~92 % of the bytes), then merges them.
function progressTracker(onProgress) {
  let streams = 1, stream = -1, current = null, best = 0;
  const n = (v) => (v === undefined || v === 'NA' || v === 'None' ? null : Number(v));
  return (line) => {
    if (line.startsWith('@@F|')) { streams = line.slice(4).split('+').length; return; }
    if (!line.startsWith('@@P|')) return;
    const [status, done, total, estimate, speed, eta, frag, frags, format] = line.slice(4).split('|');
    if (format !== current) { current = format; stream++; }
    const size = n(total) ?? n(estimate);
    // An exact size beats counting fragments, which beats yt-dlp's (jumpy) size estimate.
    const part = status === 'finished' ? 1 : n(total) ? n(done) / n(total) : n(frags) ? n(frag) / n(frags) : size ? n(done) / size : 0;
    const weights = streams === 2 ? [0.92, 0.08] : Array(streams).fill(1 / streams);
    const i = Math.min(stream, streams - 1);
    const percent = (weights.slice(0, i).reduce((a, b) => a + b, 0) + weights[i] * Math.min(1, part)) * 100;
    const last = status === 'finished' && i === streams - 1;
    best = Math.max(best, Math.min(99.5, percent));   // the bar never moves backwards
    onProgress({
      percent: best,
      stage: last ? (streams > 1 ? 'merging' : 'finishing') : streams > 1 ? (i === 0 ? 'video' : 'sound') : 'audio',
      bytes: n(done), total: size, speed: n(speed), eta: n(eta),
    });
  };
}

// SoundCloud names its sizes; YouTube lists widths. Aim for ~300 px.
function pickArtwork(thumbs = []) {
  const named = thumbs.find((t) => t.id === 't300x300') ?? thumbs.find((t) => t.id === 'large');
  if (named) return named.url;
  const sized = thumbs.filter((t) => t.width).sort((a, b) => Math.abs(a.width - 320) - Math.abs(b.width - 320));
  return (sized[0] ?? thumbs.at(-1))?.url;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
