import { describe, expect, it } from 'vitest';
import { diffLines, diffStat, hunks } from './line-diff';

const show = (a: string, b: string) => diffLines(a, b).map((l) => `${l.kind === 'same' ? ' ' : l.kind === 'add' ? '+' : '-'}${l.text}`);

describe('line diff', () => {
  it('finds nothing changed in the same text', () => {
    expect(show('a\nb', 'a\nb')).toEqual([' a', ' b']);
    expect(hunks(diffLines('a\nb', 'a\nb'))).toEqual([]);
  });

  it('shows lines added, removed and replaced', () => {
    expect(show('a\nb\nc', 'a\nb\nc\nd')).toEqual([' a', ' b', ' c', '+d']);
    expect(show('a\nb\nc', 'a\nc')).toEqual([' a', '-b', ' c']);
    expect(show('a\nb\nc', 'a\nB\nc')).toEqual([' a', '-b', '+B', ' c']);
    expect(show('x\na\ny\nb', 'a\nz\nb')).toEqual(['-x', ' a', '-y', '+z', ' b']);
  });

  it('counts what came and went', () => {
    expect(diffStat(diffLines('a\nb\nc', 'a\nB\nc\nd'))).toEqual({ added: 2, removed: 1 });
  });

  it('cuts long unchanged runs down to the context around each change', () => {
    const a = Array.from({ length: 30 }, (_, i) => `l${i}`);
    const b = [...a];
    b[2] = 'X';
    b[25] = 'Y';
    const out = hunks(diffLines(a.join('\n'), b.join('\n')), 2);
    expect(out).toHaveLength(2);
    expect(out[0]!.skipped).toBe(0);
    expect(out[0]!.lines.map((l) => l.text)).toEqual(['l0', 'l1', 'l2', 'X', 'l3', 'l4']);
    expect(out[1]!.skipped).toBe(18);
    expect(out[1]!.lines.map((l) => l.text)).toEqual(['l23', 'l24', 'l25', 'Y', 'l26', 'l27']);
  });

  it('joins changes whose context overlaps into one hunk', () => {
    const a = 'a\nb\nc\nd\ne\nf';
    expect(hunks(diffLines(a, 'A\nb\nc\nD\ne\nf'), 1)).toHaveLength(1);
  });
});
