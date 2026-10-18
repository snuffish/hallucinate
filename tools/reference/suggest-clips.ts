// npm run clips:suggest -- [source id | audio file]: suggests where to cut reference clips from a long
// mix (by default the Lazy Mix), from its loudness and low-band energy second by second. A source from
// reference/clips.json is fetched into a temp folder and deleted afterwards. Prints Markdown, ready to
// paste into the ticket; the maintainer listens to each suggestion and gives the BPMs.

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { formatTime, parseReferenceList, ReferenceListError } from './list.ts';
import { Meter } from './meter.ts';
import { decodeMono, fetchSource, ProgramError, requirePrograms } from './programs.ts';
import { suggestClips } from './suggest.ts';

const LIST_PATH = join(import.meta.dirname, '..', '..', 'reference', 'clips.json');
const RATE = 11025;   // plenty for loudness and the band below 120 Hz
const HEADINGS = { drop: 'Full psytrance drop', breakdown: 'Breakdown near a drop', ambient: 'Beatless ambient passage', transition: 'Transition between two tracks' } as const;

async function main(): Promise<void> {
  const arg = process.argv[2] ?? 'lazy-mix';
  let title = arg, work: string | undefined, audio = arg;
  if (!existsSync(arg)) {
    const list = parseReferenceList(JSON.parse(await readFile(LIST_PATH, 'utf8')));
    const source = list.sources[arg];
    if (!source) throw new ProgramError(`"${arg}" is neither an audio file nor a source in reference/clips.json (${Object.keys(list.sources).join(', ')}).`);
    await requirePrograms('yt-dlp', 'ffmpeg');
    title = `[${source.title}](${source.url})`;
    work = await mkdtemp(join(tmpdir(), 'hallucinate-suggest-'));
    console.error(`Fetching ${source.url}…`);
    audio = await fetchSource(source.url, work);
  } else {
    await requirePrograms('ffmpeg');
    title = basename(arg);
  }
  try {
    console.error('Listening…');
    const meter = new Meter(RATE);
    await decodeMono(audio, RATE, (c) => meter.push(c));
    const suggestions = suggestClips(meter.readings);
    const lines = [`Clip suggestions for ${title} (${formatTime(meter.readings.length)}), from its loudness and low-band energy per second. Times are in the mix; each clip is 60 s. Please listen and pick, and give each clip's BPM by ear.`, ''];
    for (const type of Object.keys(HEADINGS) as (keyof typeof HEADINGS)[]) {
      lines.push(`**${HEADINGS[type]}**`, '');
      const of = suggestions.filter((s) => s.type === type);
      if (!of.length) lines.push('- none found');
      for (const s of of) lines.push(`- \`${formatTime(s.start)}\` (${s.length} s): ${s.reason}`);
      lines.push('');
    }
    console.log(lines.join('\n'));
  } finally {
    if (work) await rm(work, { recursive: true, force: true });   // never keep the full mix
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof ReferenceListError || e instanceof ProgramError ? e.message : e);
  process.exitCode = 1;
});
