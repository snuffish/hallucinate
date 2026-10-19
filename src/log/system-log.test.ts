import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_LINES, SystemLog, counts, filterEntries, formatArgs, show, substitute, toText } from './system-log';

describe('SystemLog', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('keeps the newest lines up to its cap', () => {
    const log = new SystemLog(3, 0);
    for (let i = 0; i < 5; i++) log.push({ level: 'info', source: 'app', text: `line ${i}` });
    expect(log.entries().map((e) => e.text)).toEqual(['line 2', 'line 3', 'line 4']);
    expect(new Set(log.entries().map((e) => e.id)).size).toBe(3);
  });

  it('keeps the lines in time order: the server\'s backlog arrives late', () => {
    const log = new SystemLog(10, 0);
    log.push({ level: 'info', source: 'app', text: 'page', t: 10 });
    log.push({ level: 'info', source: 'app', text: 'later', t: 30 });
    log.push({ level: 'debug', source: 'server', text: 'server', t: 20 });
    expect(log.entries().map((e) => e.text)).toEqual(['page', 'server', 'later']);
  });

  it('counts the same line again right after instead of adding it', () => {
    const log = new SystemLog(10, 0);
    log.push({ level: 'error', source: 'console', text: 'boom', t: 1 });
    log.push({ level: 'error', source: 'console', text: 'boom', t: 2 });
    log.push({ level: 'error', source: 'app', text: 'boom', t: 3 });   // another source is another line
    log.push({ level: 'error', source: 'console', text: 'boom', t: 4 });
    expect(log.entries().map((e) => [e.source, e.repeat])).toEqual([['console', 2], ['app', 1], ['console', 1]]);
    expect(log.entries()[0]!.t).toBe(2);
    expect(counts(log.entries()).error).toBe(4);
  });

  it('counts the errors nobody has seen: while closed, until it opens', () => {
    vi.useFakeTimers();
    const log = new SystemLog(10, 250);
    log.push({ level: 'error', source: 'console', text: 'a' });
    log.push({ level: 'warn', source: 'console', text: 'b' });
    log.push({ level: 'error', source: 'server', text: 'c' });
    expect(log.stats.get().unseenErrors).toBe(0);   // published at most 4 times a second
    vi.advanceTimersByTime(250);
    expect(log.stats.get().unseenErrors).toBe(2);
    log.watch(true);
    expect(log.stats.get().unseenErrors).toBe(0);
    log.push({ level: 'error', source: 'console', text: 'seen as it comes' });
    vi.advanceTimersByTime(250);
    expect(log.stats.get().unseenErrors).toBe(0);
    log.watch(false);
    log.push({ level: 'error', source: 'console', text: 'd' });
    vi.advanceTimersByTime(250);
    expect(log.stats.get().unseenErrors).toBe(1);
    const version = log.stats.get().version;
    log.clear();
    expect(log.entries()).toHaveLength(0);
    expect(log.stats.get()).toEqual({ version: version + 1, unseenErrors: 0 });
  });
});

describe('formatArgs', () => {
  it('prints values the way the console would, without throwing', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(show(cyclic)).toBe('{"a":1,"self":"[circular]"}');
    expect(show({ n: 10n })).toBe('{"n":"10n"}');
    expect(show(undefined)).toBe('undefined');
    expect(show(null)).toBe('null');
    expect(formatArgs(['scene', 3, { ok: true }]).text).toBe('scene 3 {"ok":true}');
  });

  it('fills in a format string the way the console does', () => {
    expect(substitute(['%cDownload the React DevTools %s', 'font-weight:bold', 'now'])).toEqual(['Download the React DevTools now']);
    expect(substitute(['%d of %i at 100%%: %o', 2.7, '3', { a: 1 }, 'extra'])).toEqual(['2 of 3 at 100%: {"a":1}', 'extra']);
    expect(substitute(['no %s here'])).toEqual(['no %s here']);
    expect(substitute([{ a: 1 }, '%s'])).toEqual([{ a: 1 }, '%s']);
  });

  it('puts the first line on the line and the rest, with any stack, in the detail', () => {
    const err = new TypeError('nope');
    const f = formatArgs(['Shader failed:\nERROR: 0:12', err]);
    expect(f.text).toBe('Shader failed:');
    expect(f.detail).toContain('ERROR: 0:12 TypeError: nope');
    expect(f.detail).toContain(err.stack!.split('\n')[1]!.trim());
    expect(formatArgs([]).text).toBe('(empty)');
  });
});

describe('what the log shows', () => {
  const log = new SystemLog(10, 0);
  log.push({ level: 'error', source: 'console', text: 'Shader failed', detail: 'ERROR: 0:12 uKick', t: Date.UTC(2026, 9, 19, 12) });
  log.push({ level: 'info', source: 'app', text: 'Scene: Ring Run', t: Date.UTC(2026, 9, 19, 12, 0, 1) });
  log.push({ level: 'debug', source: 'server', text: 'GET /api/settings → 200 (3 ms)', t: Date.UTC(2026, 9, 19, 12, 0, 2) });

  it('filters by level, source and text (the detail too)', () => {
    const e = log.entries();
    expect(filterEntries(e, ALL_LINES)).toHaveLength(3);
    expect(filterEntries(e, { ...ALL_LINES, levels: ['error', 'warn'] }).map((x) => x.text)).toEqual(['Shader failed']);
    expect(filterEntries(e, { ...ALL_LINES, sources: ['server'] })).toHaveLength(1);
    expect(filterEntries(e, { ...ALL_LINES, query: ' ukick ' }).map((x) => x.text)).toEqual(['Shader failed']);
  });

  it('writes one line per entry for Copy and Export, the detail indented', () => {
    expect(toText(log.entries().slice(0, 2))).toBe([
      '2026-10-19T12:00:00.000Z ERROR [console] Shader failed',
      '    ERROR: 0:12 uKick',
      '2026-10-19T12:00:01.000Z INFO  [app] Scene: Ring Run',
    ].join('\n'));
  });
});
