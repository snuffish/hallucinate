// The yt-dlp bridge on the wire, declared once for both ends: the server (server/ytdlp-bridge.ts) answers
// with these shapes and the browser's client (client.ts) parses them. A leaf: zod only, so both can load it.
//
//   GET /api/<site>/search?q=<query or link>  -> SearchResponse
//   GET /api/<site>/fetch?url=<link>          -> an event stream: `progress` events, then `done` or `failed`
//   GET /api/<site>/file/<name>               -> the file (supports Range, so seeking works)
// Any other failure is an ErrorBody with a 4xx / 5xx status.

import { z } from 'zod';

export const SITE_NAMES = ['soundcloud', 'youtube'] as const;
export type SiteName = (typeof SITE_NAMES)[number];

export const sitePrefix = (site: SiteName): string => `/api/${site}/`;
export const searchPath = (site: SiteName, q: string): string => `${sitePrefix(site)}search?q=${encodeURIComponent(q)}`;
export const fetchPath = (site: SiteName, url: string): string => `${sitePrefix(site)}fetch?url=${encodeURIComponent(url)}`;
export const filePath = (site: SiteName, name: string): string => `${sitePrefix(site)}file/${encodeURIComponent(name)}`;

// What the server doesn't know is null. Absent is accepted too: the recently played lists stored before
// this contract left those fields out.
export const RemoteTrackSchema = z.object({
  url: z.string(),
  title: z.string(),
  artist: z.string().nullish(),
  duration: z.number().nullish(),
  artwork: z.string().nullish(),
});
export type RemoteTrack = z.infer<typeof RemoteTrackSchema>;

export const SearchResponseSchema = z.object({ results: z.array(RemoteTrackSchema) });
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const ErrorBodySchema = z.object({ error: z.string() });

// `starting` is the client's own, shown before the first event arrives. A video download fetches `video`,
// then `sound`, then is `merging`; a single stream is `audio`, then `finishing`.
export const STAGES = ['starting', 'audio', 'video', 'sound', 'merging', 'finishing'] as const;
const ProgressSchema = z.object({
  percent: z.number(),
  stage: z.enum(STAGES),
  bytes: z.number().nullish(),
  total: z.number().nullish(),
  speed: z.number().nullish(),
  eta: z.number().nullish(),
});
export type Progress = z.infer<typeof ProgressSchema>;

// The fetch stream's events by name.
export const FETCH_EVENTS = {
  progress: ProgressSchema,
  done: z.object({ src: z.string() }),
  failed: ErrorBodySchema,
};
export type FetchEventName = keyof typeof FETCH_EVENTS;
export type FetchEvent<K extends FetchEventName = FetchEventName> = z.infer<(typeof FETCH_EVENTS)[K]>;
