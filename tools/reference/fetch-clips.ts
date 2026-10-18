// npm run clips: fills reference/clips/ from reference/clips.json. Each source with a clip missing is
// fetched once with yt-dlp into a temp folder, its clips are cut with ffmpeg, and the full download is
// deleted. Clips already in the folder are skipped. See docs/reference-clips.md.

import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatTime, parseReferenceList, ReferenceListError } from './list.ts';
import { clipFile, planFetch } from './plan.ts';
import { cutClip, fetchSource, ProgramError, requirePrograms } from './programs.ts';

const ROOT = join(import.meta.dirname, '..', '..', 'reference');
const LIST_PATH = join(ROOT, 'clips.json');
const CLIPS_DIR = join(ROOT, 'clips');

/** Moves a finished clip in; the temp folder may be on another file system, where only a copy works. */
async function moveInto(from: string, to: string): Promise<void> {
  try { await rename(from, to); }
  catch { await copyFile(from, `${to}.part`); await rename(`${to}.part`, to); }
}

async function main(): Promise<number> {
  const list = parseReferenceList(JSON.parse(await readFile(LIST_PATH, 'utf8')));
  await mkdir(CLIPS_DIR, { recursive: true });
  const present = new Set(await readdir(CLIPS_DIR));
  const plan = planFetch(list, present);
  const kept = list.clips.length - plan.reduce((n, s) => n + s.clips.length, 0);
  if (!plan.length) {
    console.log(list.clips.length ? `All ${list.clips.length} clip(s) are already in reference/clips/.` : 'The reference list has no clips yet.');
    return 0;
  }
  await requirePrograms('yt-dlp', 'ffmpeg');
  if (kept) console.log(`${kept} clip(s) already there, skipped.`);

  const failed: string[] = [];
  for (const { id, source, clips } of plan) {
    const work = await mkdtemp(join(tmpdir(), `hallucinate-reference-${id}-`));
    try {
      console.log(`Fetching ${source.title} (${source.url}) for ${clips.length} clip(s)…`);
      let audio: string;
      try { audio = await fetchSource(source.url, work); }
      catch (e) { failed.push(`${id}: could not fetch ${source.url}: ${(e as Error).message}`); continue; }
      for (const clip of clips) {
        // Cut into the temp folder and move it in when done, so a half-written clip never counts as present.
        const part = join(work, clipFile(clip));
        try {
          await cutClip(audio, clip.start, clip.length, part);
          await moveInto(part, join(CLIPS_DIR, clipFile(clip)));
          console.log(`  ${clipFile(clip)}  ${formatTime(clip.start)} +${clip.length} s`);
        } catch (e) { failed.push(`${clip.name}: ${(e as Error).message}`); }
      }
    } finally {
      await rm(work, { recursive: true, force: true });   // never keep the full mix
    }
  }
  if (failed.length) {
    console.error(`\n${failed.length} problem(s):\n  ${failed.join('\n  ')}`);
    return 1;
  }
  return 0;
}

main().then((code) => { process.exitCode = code; }, (e: unknown) => {
  if (e instanceof ReferenceListError || e instanceof ProgramError) console.error(e.message);
  else console.error(e);
  process.exitCode = 1;
});
