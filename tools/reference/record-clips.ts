// npm run clips:record: records every clip on the reference list (reference/clips.json) that is in
// reference/clips/ into reference/recordings/: what the browser's own analyser hears, frame by frame.
// Each clip is rendered in Playwright's Chromium through an OfflineAudioContext into an AnalyserNode set up
// like the live one (src/engine/audio.ts: FFT size 2048, the default dB range, unsmoothed), suspended every
// 1/60 s to read the bins. Recordings still up to date (same audio, same recorder) are skipped.
// See docs/reference-clips.md.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { parseReferenceList, ReferenceListError, type Clip } from './list.ts';
import { clipFile } from './plan.ts';
import { decodeRecording, encodeRecording, isUpToDate, RECORDING_VERSION, recordingFile, type Recording } from './recording.ts';

const ROOT = join(import.meta.dirname, '..', '..', 'reference');
const LIST_PATH = join(ROOT, 'clips.json');
const CLIPS_DIR = join(ROOT, 'clips');
const RECORDINGS_DIR = join(ROOT, 'recordings');

const SAMPLE_RATE = 48000;     // the live AudioContext's usual rate
const FRAME_STEP = 1 / 60;     // one frame of the app
const FFT_SIZE = 2048;         // as src/engine/audio.ts
const ORIGIN = 'http://reference.local';

async function readRecording(path: string): Promise<Recording | null> {
  try { return decodeRecording(await readFile(path)); } catch { return null; }
}

/** A blank page that can fetch the clip being recorded from ORIGIN/clip. */
async function openPage(browser: Browser, audio: { bytes: Buffer }): Promise<Page> {
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/clip') return route.fulfill({ body: audio.bytes, contentType: 'application/octet-stream' });
    return route.fulfill({ body: '<!doctype html><title>record</title>', contentType: 'text/html' });
  });
  await page.goto(`${ORIGIN}/`);
  return page;
}

interface Rendered { frames: string; binCount: number; minDecibels: number; maxDecibels: number }

/** Runs in the page: decodes the clip and renders it through the analyser, reading its bins every frame. */
async function renderInPage({ url, sampleRate, frameStep, fftSize }: { url: string; sampleRate: number; frameStep: number; fftSize: number }): Promise<Rendered> {
  const data = await (await fetch(url)).arrayBuffer();
  const decoded = await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(data);
  const ctx = new OfflineAudioContext(decoded.numberOfChannels, decoded.length, sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = decoded;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  analyser.connect(ctx.destination);
  const binCount = analyser.frequencyBinCount;
  const count = Math.ceil(decoded.duration / frameStep) - 1;   // every suspend lies inside the render
  const out = new Uint8Array(count * binCount);
  for (let f = 0; f < count; f++) {
    ctx.suspend((f + 1) * frameStep).then(() => {
      analyser.getByteFrequencyData(out.subarray(f * binCount, (f + 1) * binCount));
      return ctx.resume();
    });
  }
  source.start(0);
  await ctx.startRendering();
  let binary = '';
  for (let i = 0; i < out.length; i += 0x8000) binary += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return { frames: btoa(binary), binCount, minDecibels: analyser.minDecibels, maxDecibels: analyser.maxDecibels };
}

async function record(browser: Browser, clip: Clip, bytes: Buffer, audio: string): Promise<Recording> {
  const page = await openPage(browser, { bytes });
  try {
    const r = await page.evaluate(renderInPage, { url: `${ORIGIN}/clip`, sampleRate: SAMPLE_RATE, frameStep: FRAME_STEP, fftSize: FFT_SIZE });
    return {
      version: RECORDING_VERSION, audio, sampleRate: SAMPLE_RATE, frameStep: FRAME_STEP, fftSize: FFT_SIZE,
      minDecibels: r.minDecibels, maxDecibels: r.maxDecibels, binCount: r.binCount, frames: new Uint8Array(Buffer.from(r.frames, 'base64')),
    };
  } finally {
    await page.close();
  }
}

async function main(): Promise<number> {
  const list = parseReferenceList(JSON.parse(await readFile(LIST_PATH, 'utf8')));
  if (!list.clips.length) { console.log('The reference list has no clips yet.'); return 0; }
  await mkdir(RECORDINGS_DIR, { recursive: true });

  let browser: Browser | null = null;
  const missing: string[] = [], failed: string[] = [];
  let upToDate = 0;
  try {
    for (const clip of list.clips) {
      let bytes: Buffer;
      try { bytes = await readFile(join(CLIPS_DIR, clipFile(clip))); }
      catch { missing.push(clip.name); continue; }
      const audio = createHash('sha256').update(bytes).digest('hex');
      const path = join(RECORDINGS_DIR, recordingFile(clip.name));
      if (isUpToDate(await readRecording(path), audio)) { upToDate++; continue; }

      browser ??= await chromium.launch();
      try {
        const started = Date.now();
        const recording = await record(browser, clip, bytes, audio);
        await writeFile(`${path}.part`, encodeRecording(recording));
        await rename(`${path}.part`, path);   // a half-written recording never counts as one
        const frames = recording.frames.length / recording.binCount;
        console.log(`  ${recordingFile(clip.name)}  ${frames} frames (${(frames * FRAME_STEP).toFixed(1)} s) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      } catch (e) { failed.push(`${clip.name}: ${(e as Error).message}`); }
    }
  } finally {
    await browser?.close();
  }

  if (upToDate) console.log(`${upToDate} recording(s) already up to date, skipped.`);
  if (missing.length) console.log(`${missing.length} clip(s) not in reference/clips/ yet (npm run clips): ${missing.join(', ')}`);
  if (failed.length) {
    console.error(`\n${failed.length} problem(s):\n  ${failed.join('\n  ')}`);
    return 1;
  }
  return 0;
}

main().then((code) => { process.exitCode = code; }, (e: unknown) => {
  console.error(e instanceof ReferenceListError ? e.message : e);
  process.exitCode = 1;
});
