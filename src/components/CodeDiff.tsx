// Two versions of a scene's code, line by line: what went (−), what came (+), and a few unchanged
// lines around each change. Shared by the assistant's tool chips and the editor's History.

import { useMemo } from 'react';
import { diffLines, diffStat, hunks } from '../state/line-diff';
import { plural } from '../app/plural';

export function CodeDiff({ before, after, context = 3 }: { before: string; after: string; context?: number }) {
  const { parts, stat } = useMemo(() => {
    const diff = diffLines(before, after);
    return { parts: hunks(diff, context), stat: diffStat(diff) };
  }, [before, after, context]);
  if (!parts.length) return <p className="code-diff-same">No change to the code.</p>;
  return (
    <div className="code-diff">
      <p className="code-diff-stat"><span className="add">+{stat.added}</span> <span className="del">−{stat.removed}</span> lines</p>
      <pre>
        {parts.map((h, i) => (
          <span key={i}>
            {h.skipped > 0 && <span className="skip">⋯ {plural(h.skipped, 'unchanged line')}{'\n'}</span>}
            {h.lines.map((l, j) => <span key={j} className={l.kind}>{l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  '}{l.text}{'\n'}</span>)}
          </span>
        ))}
      </pre>
    </div>
  );
}
