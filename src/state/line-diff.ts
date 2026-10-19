// A line diff of two texts, for showing what changed in a scene's code: which lines stayed, which went
// and which came. The common start and end are matched first, then the middle by longest common
// subsequence; a middle too big for that (a rewrite of a huge scene) is shown as all gone, all new.

export interface DiffLine { kind: 'same' | 'add' | 'del'; text: string }

// A run of the diff with the unchanged lines around it; `skipped` unchanged lines come before it.
export interface Hunk { lines: DiffLine[]; skipped: number }

const MAX_CELLS = 4_000_000;

export function diffLines(a: string, b: string): DiffLine[] {
  const x = a.split('\n'), y = b.split('\n');
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let end = 0;
  while (end < x.length - start && end < y.length - start && x[x.length - 1 - end] === y[y.length - 1 - end]) end++;
  const head = x.slice(0, start).map((text): DiffLine => ({ kind: 'same', text }));
  const tail = x.slice(x.length - end).map((text): DiffLine => ({ kind: 'same', text }));
  const xs = x.slice(start, x.length - end), ys = y.slice(start, y.length - end);
  return [...head, ...middle(xs, ys), ...tail];
}

function middle(xs: string[], ys: string[]): DiffLine[] {
  const n = xs.length, m = ys.length;
  if (!n || !m || n * m > MAX_CELLS) return [...xs.map((text): DiffLine => ({ kind: 'del', text })), ...ys.map((text): DiffLine => ({ kind: 'add', text }))];
  // lcs[i][j]: the longest common subsequence of xs[i..] and ys[j..].
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = xs[i] === ys[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (xs[i] === ys[j]) { out.push({ kind: 'same', text: xs[i]! }); i++; j++; }
    else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) out.push({ kind: 'del', text: xs[i++]! });
    else out.push({ kind: 'add', text: ys[j++]! });
  }
  while (i < n) out.push({ kind: 'del', text: xs[i++]! });
  while (j < m) out.push({ kind: 'add', text: ys[j++]! });
  return out;
}

// The changed parts of a diff, each with up to `context` unchanged lines either side; the unchanged
// lines between hunks are counted, not shown.
export function hunks(diff: readonly DiffLine[], context = 3): Hunk[] {
  const changed = diff.flatMap((l, i) => (l.kind === 'same' ? [] : [i]));
  if (!changed.length) return [];
  const out: Hunk[] = [];
  let from = Math.max(0, changed[0]! - context), to = Math.min(diff.length, changed[0]! + context + 1), shown = 0;
  for (const i of changed.slice(1)) {
    if (i - context <= to) { to = Math.min(diff.length, i + context + 1); continue; }
    out.push({ lines: diff.slice(from, to), skipped: from - shown });
    shown = to;
    from = i - context;
    to = Math.min(diff.length, i + context + 1);
  }
  out.push({ lines: diff.slice(from, to), skipped: from - shown });
  return out;
}

// How many lines came and went.
export function diffStat(diff: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const l of diff) { if (l.kind === 'add') added++; else if (l.kind === 'del') removed++; }
  return { added, removed };
}
