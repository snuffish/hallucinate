// What the director's cycles changed in the show, newest first, each opened to its details. The
// director's changes aren't undone from the assistant panel; this is where they can be read.

import { useSessions } from '../app/sessions';
import { DIRECTOR_CHAT } from '../assistant/change-log';
import { useStore } from '../state/store';
import { AiChange } from './assistant/AiChange';
import { relativeTime } from './SceneHistoryPanel';

const SHOWN = 12;

export function DirectorChanges() {
  const { changes: log } = useSessions();
  useStore(log.store, (s) => s.revision);
  const changes = log.forChat(DIRECTOR_CHAT).slice(0, SHOWN);
  if (!changes.length) return null;
  return (
    <details id="st-director-changes" className="st-director-changes">
      <summary>What the director changed</summary>
      <ol>
        {changes.map((c) => (
          <li key={c.id}>
            <details>
              <summary>{c.label} <span className="when">· {relativeTime(c.at)}</span></summary>
              <AiChange change={c} />
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}
