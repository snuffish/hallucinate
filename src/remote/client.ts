// The browser's side of the yt-dlp bridge: search a site, and download a pick with live progress. Every
// answer is parsed with the shapes in wire.ts, which the server answers with.

import { ErrorBodySchema, FETCH_EVENTS, fetchPath, searchPath, SearchResponseSchema, type Progress, type RemoteTrack, type SiteName } from './wire';

const UNREACHABLE = 'Could not reach the local server. Is the dev server ("npm run dev") running?';
const LOST = 'Lost the connection to the local server. Is the dev server ("npm run dev") running?';
const UNEXPECTED = 'Unexpected answer from the local server.';

export interface Download {
  // Resolves with the file's URL on this origin; rejects with the server's reason, or an AbortError once cancelled.
  promise: Promise<string>;
  cancel(): void;
}

export interface RemoteSite {
  search(q: string): Promise<RemoteTrack[]>;
  // One download per link on the server: a second one follows the running one, and the server stops it
  // when every download of it is cancelled.
  download(url: string, onProgress: (p: Progress) => void): Download;
}

// `base` is the server's origin when not this page's (the tests).
export function remoteSite(site: SiteName, { base = '' }: { base?: string } = {}): RemoteSite {
  return {
    async search(q) {
      let res: Response;
      try {
        res = await fetch(base + searchPath(site, q));
      } catch {
        throw new Error(UNREACHABLE);
      }
      const body = await answer(res);
      const parsed = SearchResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error(UNEXPECTED);
      return parsed.data.results;
    },

    download(url, onProgress) {
      const abort = new AbortController();
      const promise = (async () => {
        let res: Response;
        try {
          res = await fetch(base + fetchPath(site, url), { headers: { Accept: 'text/event-stream' }, signal: abort.signal });
        } catch (err) {
          throw abort.signal.aborted ? err : new Error(LOST);
        }
        if (!res.ok) await answer(res);
        if (!res.body) throw new Error(LOST);
        try {
          for await (const { event, data } of events(res.body)) {
            const body = parseJSON(data);
            if (event === 'progress') {
              const p = FETCH_EVENTS.progress.safeParse(body);
              if (p.success) onProgress(p.data);
            } else if (event === 'done') {
              const d = FETCH_EVENTS.done.safeParse(body);
              if (!d.success) throw new Error(UNEXPECTED);
              return d.data.src;
            } else if (event === 'failed') {
              const f = FETCH_EVENTS.failed.safeParse(body);
              throw new Error(f.success ? f.data.error : 'Download failed');
            }
          }
        } catch (err) {
          // The stream breaking (the server stopped) reads as a TypeError; anything else is the answer.
          if (abort.signal.aborted || !(err instanceof TypeError)) throw err;
        }
        throw new Error(LOST);
      })();
      return { promise, cancel: () => abort.abort() };
    },
  };
}

// The body of an answer, or the server's reason when it refused.
async function answer(res: Response): Promise<unknown> {
  const body: unknown = await res.json().catch(() => ({}));
  if (res.ok) return body;
  const e = ErrorBodySchema.safeParse(body);
  throw new Error(e.success ? e.data.error : `Request failed (${res.status})`);
}

function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// A text/event-stream body as its events. The server writes whole events, one JSON line of data each.
async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      let event = 'message', data = '';
      for (const line of buffer.slice(0, end).split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      buffer = buffer.slice(end + 2);
      yield { event, data };
    }
  }
}
