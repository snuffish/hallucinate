// The composition root for everything that lives beside the controller: the studio's show, the AI
// director and the assistant's conversations. They are created once per controller (not by the panels
// that show them), so the shortcuts, the tools and the director always reach the same objects, and
// rules that span them have one owner: every assistant tool, from any conversation, the director or a
// command typed into the System log, waits its turn on one lock, and what the conversations' and the
// director's tools changed is recorded in one change log.

import { createContext, useContext } from 'react';
import { ChangeLog } from '../assistant/change-log';
import { AssistantSession } from '../assistant/conversations';
import { createToolRunner, type ToolRunner } from '../assistant/executor';
import { createLock, serialized } from '../assistant/lock';
import { Director } from '../director/director';
import type { AppController } from './controller';
import { StudioSession } from './studio';

export interface Sessions {
  studio: StudioSession;
  director: Director;
  assistant: AssistantSession;
  // The System log's commands: the assistant's tools, with their changes on the assistant's undo stack.
  commands: ToolRunner;
  changes: ChangeLog;   // what the assistant's and the director's tools changed
  dispose(): void;
}

export function createSessions(app: AppController): Sessions {
  const lock = createLock();
  const changes = new ChangeLog();
  const studio = new StudioSession(app);
  const director = new Director(app, studio, { lock, changes });
  const assistant = new AssistantSession(app, { lock, studio: () => studio, changes });
  const commands = serialized(createToolRunner(app, { push: (entry) => assistant.undo.push(entry) }, () => studio), lock);
  const detach = [studio.attach(), director.attach(), assistant.attach()];
  return {
    studio,
    director,
    assistant,
    commands,
    changes,
    dispose() {
      for (const off of detach.reverse()) off();
      assistant.dispose();
      studio.dispose();
    },
  };
}

const SessionsContext = createContext<Sessions | null>(null);
export const SessionsProvider = SessionsContext.Provider;

export function useSessions(): Sessions {
  const sessions = useContext(SessionsContext);
  if (!sessions) throw new Error('useSessions() outside <SessionsProvider>');
  return sessions;
}
