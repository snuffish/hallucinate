import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { safeFileName, trimCache } from './ytdlp-bridge';

describe('safeFileName', () => {
  it('takes what yt-dlp writes', () => {
    expect(safeFileName('dQw4w9WgXcQ.mp4')).toBe(true);
    expect(safeFileName('123456789.m4a')).toBe(true);
  });
  it('refuses dot names and anything that could leave the cache', () => {
    for (const n of ['.', '..', '../x', '.hidden', 'a/b', 'a..b', '']) expect(safeFileName(n), n).toBe(false);
  });
});

describe('trimCache', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('removes the least recently used files until the cache fits, keeping the new one and partial files', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hallucinate-cache-test-'));
    const file = (name: string, size: number, age: number) => {
      writeFileSync(join(dir, name), Buffer.alloc(size));
      const t = Date.now() / 1000 - age;
      utimesSync(join(dir, name), t, t);
    };
    file('old.mp4', 100, 300);
    file('mid.mp4', 100, 200);
    file('busy.mp4.part', 100, 400);
    file('new.mp4', 100, 0);
    await trimCache(dir, 'new.mp4', 250);
    expect(readdirSync(dir).sort()).toEqual(['busy.mp4.part', 'new.mp4']);
  });
});
