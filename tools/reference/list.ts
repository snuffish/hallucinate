// The reference list (reference/clips.json): the real music the Listener is tested against. Each source
// is a link yt-dlp can fetch; each clip is a cut from one source with its right answers, which the
// maintainer gives by ear. See docs/reference-clips.md for the format.

export const CLIP_TYPES = ['drop', 'breakdown', 'ambient', 'transition'] as const;
export type ClipType = (typeof CLIP_TYPES)[number];

/** A stretch of a clip, in seconds from the clip's own start. */
export type Window = [from: number, to: number];

export interface Source { title: string; url: string }

export interface Clip {
  name: string;               // also the audio file's name: reference/clips/<name>.flac
  source: string;             // a key of `sources`
  start: number;              // seconds into the source
  length: number;             // seconds
  type: ClipType;
  bpm: number | null;         // by ear, never from code; for a transition, the BPM after it
  drop: Window | null;
  breakdown: Window | null;
}

export interface ReferenceList { sources: Record<string, Source>; clips: Clip[] }

export class ReferenceListError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`The reference list has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    this.problems = problems;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Seconds from a number, or from "m:ss", "h:mm:ss" (seconds may have a fraction). */
export function parseTime(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^(?:(\d+):)?(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(v.trim());
  if (!m) return null;
  const [h, min, s] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (s >= 60 || (m[1] !== undefined && min >= 60)) return null;
  return h * 3600 + min * 60 + s;
}

/** "1:02:03" / "4:05" for a number of seconds, the way the list and the suggestions write times. */
export function formatTime(seconds: number): string {
  const t = Math.round(seconds);
  const [h, m, s] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60];
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function parseReferenceList(raw: unknown): ReferenceList {
  const problems: string[] = [];
  if (!isObject(raw)) throw new ReferenceListError(['the list must be an object with "sources" and "clips"']);

  const sources: Record<string, Source> = {};
  if (!isObject(raw.sources)) problems.push('sources: must be an object of id → { title, url }');
  else {
    for (const [id, s] of Object.entries(raw.sources)) {
      const at = `sources.${id}`;
      if (!isObject(s)) { problems.push(`${at}: must be { title, url }`); continue; }
      if (typeof s.title !== 'string' || !s.title) problems.push(`${at}.title: must be a name`);
      if (typeof s.url !== 'string' || !/^https?:\/\/\S+$/.test(s.url)) problems.push(`${at}.url: not a link`);
      sources[id] = { title: String(s.title), url: String(s.url) };
    }
  }

  const clips: Clip[] = [];
  if (!Array.isArray(raw.clips)) problems.push('clips: must be an array');
  else {
    const seen = new Set<string>();
    raw.clips.forEach((c: unknown, i) => {
      const at = `clips[${i}]`;
      if (!isObject(c)) { problems.push(`${at}: must be an object`); return; }
      const problem = (field: string, message: string) => problems.push(`${at}.${field}: ${message}`);

      const name = String(c.name ?? '');
      if (!/^[\w-]+$/.test(name)) problem('name', `"${name}" may only use letters, digits, "-" and "_"`);
      else if (seen.has(name)) problem('name', `"${name}" is used twice`);
      seen.add(name);

      const source = String(c.source ?? '');
      if (isObject(raw.sources) && !(source in raw.sources)) problem('source', `"${source}" is not in sources`);

      const start = parseTime(c.start);
      if (start === null) problem('start', `${JSON.stringify(c.start)} is not a time (seconds, m:ss or h:mm:ss)`);

      const length = parseTime(c.length);
      if (length === null || length <= 0) problem('length', 'must be more than 0 seconds');

      const type = c.type as ClipType;
      const typeOk = CLIP_TYPES.includes(type);
      if (!typeOk) problem('type', `${JSON.stringify(c.type)} is not one of ${CLIP_TYPES.join(', ')}`);

      const bpmOk = (typeof c.bpm === 'number' && Number.isFinite(c.bpm) && c.bpm > 0) || (c.bpm === null && type === 'ambient');
      if (!bpmOk && typeOk) problem('bpm', 'must be a positive number, given by ear (or null for an ambient clip)');

      const window = (field: 'drop' | 'breakdown'): Window | null => {
        const w = c[field];
        if (w === null || w === undefined) return null;
        const [from, to] = Array.isArray(w) && w.length === 2 ? w.map(parseTime) : [null, null];
        if (from == null || to == null || to <= from || (length !== null && to > length)) {
          problem(field, `must lie within the clip (0–${length ?? '?'} s) and end after it starts`);
          return null;
        }
        return [from, to];
      };
      const hadDrop = c.drop != null, hadBreakdown = c.breakdown != null;
      const drop = window('drop');
      const breakdown = window('breakdown');
      if ((type === 'drop' || type === 'breakdown') && !hadDrop) problem('drop', `a ${type} clip needs a drop window`);
      if (type === 'breakdown' && !hadBreakdown) problem('breakdown', 'a breakdown clip needs a breakdown window');

      clips.push({ name, source, start: start ?? 0, length: length ?? 0, type, bpm: (c.bpm as number | null) ?? null, drop, breakdown });
    });
  }

  if (problems.length) throw new ReferenceListError(problems);
  return { sources, clips };
}
