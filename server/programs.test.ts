import { describe, expect, it } from 'vitest';
import { programs } from './programs';

describe('programs', () => {
  it('runs `claude` and `yt-dlp` with a 2 GB cache unless the environment says otherwise', () => {
    expect(programs({})).toEqual({ claudeBin: 'claude', ytdlp: 'yt-dlp', ytdlpCacheBytes: 2048 * 1024 * 1024 });
    expect(programs({ CLAUDE_BIN: '/opt/claude', YTDLP: '/opt/yt-dlp', YTDLP_CACHE_MB: '512' }))
      .toEqual({ claudeBin: '/opt/claude', ytdlp: '/opt/yt-dlp', ytdlpCacheBytes: 512 * 1024 * 1024 });
  });

  it('keeps the default cache size for one that is not a positive number', () => {
    for (const mb of ['lots', '0', '-5', '']) expect(programs({ YTDLP_CACHE_MB: mb }).ytdlpCacheBytes, mb).toBe(2048 * 1024 * 1024);
  });
});
