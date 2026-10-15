// The composition root for everything that lives beside the controller: the studio's show, the AI
// director and the assistant's conversations. They are created once per controller (not by the panels
// that show them), so the shortcuts, the tools and the director always reach the same objects, and
// rules that span them have one owner: every assistant tool, from any conversation or the director,
// waits its turn on one lock.

import { createContext, useContext } from 'react';
import { AssistantSession } from '../assistant/conversations';
import { createLock } from '../assistant/lock';
import { Director } from '../director/director';
import type { AppController } from './controller';
import { StudioSession } from './studio';

export interface Sessions {
  studio: StudioSession;
  director: Director;
  assistant: AssistantSession;
  dispose(): void;
}

export function createSessions(app: AppController): Sessions {
  const lock = createLock();
  const studio = new StudioSession(app);
  const director = new Director(app, studio, { lock });
  const assistant = new AssistantSession(app, { lock, studio: () => studio });
  const detach = [studio.attach(), director.attach(), assistant.attach()];
  return {
    studio,
    director,
    assistant,
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
