// Settings export / import: everything you built and configured, as one JSON file. Each section is
// one stored key, validated with the same schema its owner loads it with. An import is all or
// nothing: the whole file is checked before anything is written, and a failed write puts the
// previous values back. Applying it is the controller's job (freeze, commit, reload).

import { z, type ZodType } from 'zod';
import { version as appVersion } from '../../package.json';
import { GraphSchema } from '../engine/nodes';
import { ParamDataSchema } from '../engine/params';
import { SCENES } from '../engine/scenes';
import { StoredLayoutSchema, parseLayout } from '../state/layout';
import { PrefsSchema } from '../state/library-prefs';
import { KEYS, commitRaw, readString } from '../state/persistence';
import { SceneEditsSchema, UserScenesSchema } from '../state/scene-list';
import { ShowSchema } from './studio';
import { PlayerSettingsSchema } from './transport';

export const BUNDLE_FORMAT = 'hallucinate';
export const BUNDLE_VERSION = 1;
export const MAX_BUNDLE_BYTES = 5_000_000;

// How a section is stored: JSON, a plain string (the shader source) or a '1' / '0' flag.
type Storage = 'json' | 'text' | 'flag';
interface Section { key: string; storage: Storage; schema: ZodType; normalise?: (value: unknown) => unknown }

// What an export contains. Left out on purpose: recently played tracks, the game's high score and
// one-shot hints (history, not setup), and the loaded media.
export const SECTIONS = {
  userScenes: { key: KEYS.userScenes, storage: 'json', schema: UserScenesSchema },
  sceneEdits: { key: KEYS.sceneEdits, storage: 'json', schema: SceneEditsSchema },
  customShader: { key: KEYS.customShader, storage: 'text', schema: z.string() },
  nodeGraph: { key: KEYS.nodeGraph, storage: 'json', schema: GraphSchema },
  params: { key: KEYS.params, storage: 'json', schema: ParamDataSchema },
  show: { key: KEYS.show, storage: 'json', schema: ShowSchema },
  library: { key: KEYS.library, storage: 'json', schema: PrefsSchema },
  player: { key: KEYS.player, storage: 'json', schema: PlayerSettingsSchema },
  layout: { key: KEYS.layout, storage: 'json', schema: StoredLayoutSchema, normalise: parseLayout },
  mediaSound: { key: KEYS.mediaSound, storage: 'flag', schema: z.boolean() },
} satisfies Record<string, Section>;
export type SectionId = keyof typeof SECTIONS;
const SECTION_IDS = Object.keys(SECTIONS) as SectionId[];

export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  data: Partial<Record<SectionId, unknown>>;
}

const HeaderSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.number().int().min(1),
  data: z.record(z.string(), z.unknown()),
});

// Stored sections as they are, not as the app loaded them: scenes that don't compile on this
// device are in storage only, and they belong in the export too. A key that is missing or not
// readable is left out.
export function buildBundle(now = new Date()): Bundle {
  const data: Bundle['data'] = {};
  for (const id of SECTION_IDS) {
    const { key, storage } = SECTIONS[id] as Section;
    const raw = readString(key);
    if (raw === null) continue;
    if (storage === 'text') data[id] = raw;
    else if (storage === 'flag') data[id] = raw === '1';
    else try { data[id] = JSON.parse(raw); } catch { /* unreadable: skip */ }
  }
  return { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: now.toISOString(), appVersion, data };
}

// What an import will write: storage key → stored string, plus counts for the confirm and the report.
export interface ParsedBundle {
  writes: [key: string, value: string][];
  summary: string;
}

const issueText = (error: z.ZodError) => {
  const issue = error.issues[0]!;
  return `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`;
};

// Every name the app already uses: a saved scene can't share one (it would never be found by name).
const RESERVED = new Set([...SCENES.map((s) => s.name), 'My Shader', 'Node Scene']);

export function parseBundle(text: string): { ok: true; bundle: ParsedBundle } | { ok: false; error: string } {
  if (text.length > MAX_BUNDLE_BYTES) return { ok: false, error: 'This file is too big to be a Hallucinate export.' };
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { ok: false, error: 'This file isn\'t valid JSON.' }; }
  const header = HeaderSchema.safeParse(json);
  if (!header.success) return { ok: false, error: 'This isn\'t a Hallucinate settings export.' };
  if (header.data.version > BUNDLE_VERSION) return { ok: false, error: 'This file was made by a newer version of Hallucinate. Update the app to import it.' };

  const values: Partial<Record<SectionId, unknown>> = {};
  for (const id of SECTION_IDS) {
    if (!(id in header.data.data)) continue;
    const section = SECTIONS[id] as Section;
    const result = section.schema.safeParse(header.data.data[id]);
    if (!result.success) return { ok: false, error: `The "${id}" section is broken (${issueText(result.error)}). Nothing was imported.` };
    values[id] = section.normalise ? section.normalise(result.data) : result.data;
  }
  if (!Object.keys(values).length) return { ok: false, error: 'This file has nothing to import.' };

  const scenes = (values.userScenes ?? []) as z.infer<typeof UserScenesSchema>;
  const seen = new Set<string>();
  for (const { name } of scenes) {
    if (RESERVED.has(name)) return { ok: false, error: `Your scene "${name}" has the same name as a built-in scene. Rename it in the file to import it.` };
    if (seen.has(name)) return { ok: false, error: `There are two scenes called "${name}" in the file.` };
    seen.add(name);
  }

  const writes = SECTION_IDS.filter((id) => id in values).map((id): [string, string] => {
    const { key, storage } = SECTIONS[id] as Section;
    const value = values[id];
    return [key, storage === 'text' ? value as string : storage === 'flag' ? (value ? '1' : '0') : JSON.stringify(value)];
  });
  return { ok: true, bundle: { writes, summary: describe(values) } };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describe(values: Partial<Record<SectionId, unknown>>): string {
  const parts: string[] = [];
  const scenes = values.userScenes as unknown[] | undefined;
  if (scenes) parts.push(plural(scenes.length, 'scene'));
  const edits = values.sceneEdits as Record<string, string> | undefined;
  if (edits && Object.keys(edits).length) parts.push(plural(Object.keys(edits).length, 'edited built-in'));
  if (values.customShader !== undefined) parts.push('My Shader');
  if (values.nodeGraph) parts.push('the visual maker graph');
  if (values.params) parts.push('parameter values');
  const show = values.show as z.infer<typeof ShowSchema> | undefined;
  if (show) parts.push(`a show with ${plural(show.cues.length, 'cue')}`);
  if (values.library) parts.push('favourites');
  if (values.player || values.mediaSound !== undefined) parts.push('player settings');
  if (values.layout) parts.push('layout');
  return parts.join(', ');
}

// Writes every section, or none: when a write fails (storage full) the keys already written get
// their previous values back and the error is rethrown.
export function applyWrites(writes: readonly [string, string][]): void {
  const before = writes.map(([key]) => [key, readString(key)] as const);
  try {
    for (const [key, value] of writes) commitRaw(key, value);
  } catch (err) {
    for (const [key, value] of before) { try { commitRaw(key, value); } catch { /* best effort */ } }
    throw err;
  }
}
