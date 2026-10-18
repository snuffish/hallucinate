// yt-dlp and ffmpeg for the reference tools, spawned without a shell. Not tested: they are tools, checked
// by the replay tests that use the clips they make.

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { formatTime } from './list.ts';

const INSTALL: Record<string, string> = {
  'yt-dlp': 'Install it with "sudo pacman -S yt-dlp" (or "pip install yt-dlp").',
  ffmpeg: 'Install it with "sudo pacman -S ffmpeg" (or your system\'s package manager).',
};

/** The program to run: YTDLP / FFMPEG in the environment, else the plain name. */
const bin = (name: 'yt-dlp' | 'ffmpeg') => (name === 'yt-dlp' ? process.env.YTDLP : process.env.FFMPEG) || name;

export class ProgramError extends Error {}

/** Runs a program to the end; rejects with a readable error (missing program, or its last error lines). */
function run(name: 'yt-dlp' | 'ffmpeg', args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin(name), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-4000); });
    p.on('error', (e: NodeJS.ErrnoException) => reject(new ProgramError(e.code === 'ENOENT' ? `${name} is not installed. ${INSTALL[name]}` : `${name}: ${e.message}`)));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new ProgramError(`${name} failed (exit ${code}):\n    ${lastLines(err)}`));
    });
  });
}

const lastLines = (text: string) => text.trim().split('\n').filter((l) => l.trim()).slice(-3).join('\n    ');

/** Fails early, with how to install it, when a program can't be run at all. */
export async function requirePrograms(...names: ('yt-dlp' | 'ffmpeg')[]): Promise<void> {
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
  return new Promise((resolve, reject) => {
    const p = spawn(bin('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let carry = Buffer.alloc(0), err = '';
    p.stdout.on('data', (d: Buffer) => {
      const data = carry.length ? Buffer.concat([carry, d]) : d;
      const whole = data.length - (data.length % 4);
      const bytes = new Uint8Array(whole);
      bytes.set(data.subarray(0, whole));
      onChunk(new Float32Array(bytes.buffer));
      carry = Buffer.from(data.subarray(whole));
    });
    p.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-4000); });
    p.on('error', (e: NodeJS.ErrnoException) => reject(new ProgramError(e.code === 'ENOENT' ? `ffmpeg is not installed. ${INSTALL.ffmpeg}` : `ffmpeg: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new ProgramError(`ffmpeg could not decode ${input}:\n    ${lastLines(err)}`))));
  });
}
