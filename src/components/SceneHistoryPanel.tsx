// The editor's History: the versions of the scene being edited, newest first, who made each (you,
// the assistant and in which conversation, a template, Revert, a restore), how the code changed since
// one, and restoring one (a new version, so a restore can be gone back on too).

import { useState } from 'react';
import { useApp } from '../app/AppContext';
import { useSessions } from '../app/sessions';
import type { Version, VersionBy } from '../state/scene-history';
import { useStore } from '../state/store';
import { CodeDiff } from './CodeDiff';

const WHO: Record<VersionBy, string> = {
  you: 'You',
  assistant: '✦ Assistant',
  template: 'Start from…',
  revert: 'Reverted to the original',
  restore: 'Restored',
  library: 'Saved to the library',
  copy: 'Copied from the visual maker',
  undo: 'Assistant change undone',
  earlier: 'Earlier code',
};

export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.round((now - at) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface Props {
  historyKey: string;
  code: string;                                  // the code in the editor now
  readOnly: boolean;
  onRestore: (v: Version) => void;
}

export function SceneHistoryPanel({ historyKey, code, readOnly, onRestore }: Props) {
  const app = useApp();
  const { assistant } = useSessions();
  useStore(app.history.store, (s) => s.revision);
  const chats = useStore(assistant.store, (s) => s.chats);
  const versions = app.history.list(historyKey);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = versions.find((v) => v.id === picked) ?? null;

  if (!versions.length) return <p className="ed-history-empty">No versions yet: one is kept as you change the code, and before and after every change the assistant makes.</p>;
  return (
    <div className="ed-history">
      <ol className="ed-history-list">
        {versions.map((v, i) => {
          const chat = v.chatId ? chats.find((c) => c.id === v.chatId) : undefined;
          return (
            <li key={v.id}>
              <button type="button" className={`ed-version by-${v.by}${v.id === picked ? ' picked' : ''}`} aria-pressed={v.id === picked} onClick={() => setPicked(v.id === picked ? null : v.id)}>
                <span className="who">{WHO[v.by]}{v.label && v.by !== 'you' ? ` · ${v.label}` : ''}</span>
                <span className="when">{i === 0 && v.body === code ? 'current · ' : ''}{relativeTime(v.at)}</span>
              </button>
              {chat && <button type="button" className="ed-version-chat" title="Open the conversation that made this" onClick={() => app.toggleAssistant(true, chat.id)}>{chat.title}</button>}
            </li>
          );
        })}
      </ol>
      {selected && (
        <div className="ed-history-picked">
          <p>Changes since this version:</p>
          <CodeDiff before={selected.body} after={code} />
          {!readOnly && selected.body !== code && <button type="button" id="ed-history-restore" onClick={() => onRestore(selected)}>Restore this version</button>}
        </div>
      )}
    </div>
  );
}
