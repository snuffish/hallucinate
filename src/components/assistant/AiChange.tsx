// What one assistant or director change did, under its tool chip (or in the studio): a code diff with
// a way back to the code from before, values from what to what, or the show scenes it added, removed
// and changed. Read from the change log (change-log.ts), so it is still there after a reload, when
// the panel's Undo no longer is.

import { useApp } from '../../app/AppContext';
import type { ShowSnapshot } from '../../app/studio';
import type { Change } from '../../assistant/change-log';
import { colourOf, formatValue, showLines, valueRows } from '../../assistant/change-summary';
import { CodeDiff } from '../CodeDiff';

const LABELS: Record<string, string> = { aberration: 'fringing', cycle: 'colour cycling', mode: 'transition', on: 'autopilot', unit: 'counts' };

function Value({ v }: { v: unknown }) {
  const colour = colourOf(v);
  return <>{colour && <i className="ai-change-swatch" style={{ background: colour }} />}{formatValue(v)}</>;
}

function Values({ before, after }: { before: unknown; after: unknown }) {
  const rows = valueRows(before, after);
  if (!rows.length) return <p className="ai-change-none">Nothing changed (already so).</p>;
  return (
    <table className="ai-change-values">
      <tbody>
        {rows.map((r) => <tr key={r.key}><th>{LABELS[r.key] ?? r.key}</th><td><Value v={r.before} /></td><td>→</td><td><Value v={r.after} /></td></tr>)}
      </tbody>
    </table>
  );
}

function Lines({ lines }: { lines: string[] }) {
  if (!lines.length) return <p className="ai-change-none">Nothing changed (already so).</p>;
  return <ul className="ai-change-show">{lines.map((l, i) => <li key={i} className={l[0] === '+' ? 'add' : l[0] === '−' ? 'del' : undefined}>{l}</li>)}</ul>;
}

export function AiChange({ change }: { change: Change }) {
  const app = useApp();
  const sceneIndex = change.scene !== undefined ? app.sceneByName(change.scene) : -1;
  const openInEditor = () => { app.setScene(sceneIndex); app.setOverlay('editor'); };
  const putBack = async () => {
    if (sceneIndex < 0 || typeof change.before !== 'string') return;
    if (!confirm(`Put back the code "${change.scene}" had before "${change.label}"? Its code now is kept in the scene's History.`)) return;
    app.setScene(sceneIndex);
    const error = await app.editor.compileInto(app.editor.target(sceneIndex), change.before, { by: 'restore', label: `Before "${change.label}"` });
    app.toast(error ? `It doesn't compile any more, so nothing changed.` : `"${change.scene}" has its code from before "${change.label}" again`);
  };

  switch (change.kind) {
    case 'code':
    case 'created':
      return (
        <div className="ai-change">
          <CodeDiff before={typeof change.before === 'string' ? change.before : ''} after={typeof change.after === 'string' ? change.after : ''} />
          {sceneIndex >= 0 && (
            <div className="ai-change-actions">
              <button type="button" onClick={openInEditor}>Open in editor</button>
              {change.kind === 'code' && <button type="button" onClick={() => void putBack()}>Put back the code from before</button>}
            </div>
          )}
        </div>
      );
    case 'values':
    case 'look':
    case 'transition':
    case 'autopilot':
      return <div className="ai-change"><Values before={change.before} after={change.after} /></div>;
    case 'show':
      return <div className="ai-change"><Lines lines={showLines(change.before as ShowSnapshot | null, change.after as ShowSnapshot | null)} /></div>;
    case 'plan': {
      const b = change.before as { show: ShowSnapshot; on: boolean } | null, a = change.after as { show: ShowSnapshot; on: boolean } | null;
      const lines = showLines(b?.show ?? null, a?.show ?? null);
      if (b && a && b.on !== a.on) lines.push(`Autopilot ${a.on ? 'switched on' : 'switched off'}`);
      return <div className="ai-change"><Lines lines={lines} /></div>;
    }
  }
}
