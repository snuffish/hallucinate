// yt-dlp and ffmpeg for the reference tools, spawned without a shell. Not tested: they are tools, checked
// by the replay tests that use the clips they make.

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { formatTime } from './list.ts';

/** The programs the reference tools run. */
type Program = 'yt-dlp' | 'ffmpeg';

const INSTALL: Record<Program, string> = {
  'yt-dlp': 'Install it with your package manager (e.g. "sudo apt install yt-dlp", "brew install yt-dlp") or "pip install yt-dlp".',
  ffmpeg: 'Install it with your package manager (e.g. "sudo apt install ffmpeg", "brew install ffmpeg", "winget install ffmpeg").',
};

/** The program to run: YTDLP / FFMPEG in the environment, else the plain name. */
const bin = (name: Program) => (name === 'yt-dlp' ? process.env.YTDLP : process.env.FFMPEG) || name;

export class ProgramError extends Error {}

/**
 * Runs a program to the end, handing its output to `onOutput` if given; rejects with a readable error: the
 * program missing, or `failed` with its last error lines.
 */
function run(name: Program, args: string[], { onOutput, failed = (code) => `${name} failed (exit ${code})` }: {
  onOutput?: (data: Buffer) => void;
  failed?: (code: number | null) => string;
} = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin(name), args, { stdio: ['ignore', onOutput ? 'pipe' : 'ignore', 'pipe'] });
    let err = '';
    if (onOutput) p.stdout!.on('data', onOutput);
    p.stderr!.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-4000); });
    p.on('error', (e: NodeJS.ErrnoException) => reject(new ProgramError(e.code === 'ENOENT' ? `${name} is not installed. ${INSTALL[name]}` : `${name}: ${e.message}`)));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new ProgramError(`${failed(code)}:\n    ${lastLines(err)}`));
    });
  });
}

const lastLines = (text: string) => text.trim().split('\n').filter((l) => l.trim()).slice(-3).join('\n    ');

/** Fails early, with how to install it, when a program can't be run at all. */
export async function requirePrograms(...names: Program[]): Promise<void> {
  const missing: string[] = [];
  for (const name of names) {
    try { await run(name, [name === 'ffmpeg' ? '-version' : '--version']); }
    catch (e) { missing.push((e as Error).message); }
  }
  if (missing.length) throw new ProgramError(missing.join('\n'));
}

/** Downloads a source's audio into `dir` (best audio, no playlist) and returns the file's path. */
export async function fetchSource(url: string, dir: string): Promise<string> {
  await run('yt-dlp', ['-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio', '--no-playlist', '--no-progress', '-o', join(dir, 'source.%(ext)s'), '--', url]);
  const file = (await readdir(dir)).find((f) => f.startsWith('source.') && !f.endsWith('.part'));
  if (!file) throw new ProgramError(`yt-dlp finished but left no audio for ${url}`);
  return join(dir, file);
}

/** Cuts `length` seconds from `start` out of `input` into a flac file (re-encoded, so the cut is exact). */
export function cutClip(input: string, start: number, length: number, output: string): Promise<void> {
  return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-t', String(length), '-i', input, '-vn', '-c:a', 'flac', output])
    .catch((e: Error) => { throw new ProgramError(`cutting ${formatTime(start)} +${length} s: ${e.message}`); });
}

/** Decodes `input` to mono 32-bit float samples at `sampleRate`, handed over chunk by chunk. */
export function decodeMono(input: string, sampleRate: number, onChunk: (samples: Float32Array) => void): Promise<void> {
  let carry = Buffer.alloc(0);
  const onOutput = (d: Buffer) => {
    const data = carry.length ? Buffer.concat([carry, d]) : d;
    const whole = data.length - (data.length % 4);
    const bytes = new Uint8Array(whole);
    bytes.set(data.subarray(0, whole));
    onChunk(new Float32Array(bytes.buffer));
    carry = Buffer.from(data.subarray(whole));
  };
  return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'],
    { onOutput, failed: () => `ffmpeg could not decode ${input}` });
}
