import type { Clip, ReferenceList, Source } from './list.ts';

/** The clip's audio file in the clips folder. */
export const clipFile = (clip: Clip): string => `${clip.name}.flac`;

export interface SourceFetch { id: string; source: Source; clips: Clip[] }

/** What to fetch: each source that still has clips missing from the folder, with just those clips. */
export function planFetch(list: ReferenceList, present: ReadonlySet<string>): SourceFetch[] {
  const plan: SourceFetch[] = [];
  for (const [id, source] of Object.entries(list.sources)) {
    const clips = list.clips.filter((c) => c.source === id && !present.has(clipFile(c)));
    if (clips.length) plan.push({ id, source, clips });
  }
  return plan;
}
