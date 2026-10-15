// Creates the AppController once the canvas exists, plus the sessions beside it (studio, director,
// assistant), and disposes them on unmount. Under StrictMode the effect runs twice in development; the
// second controller reuses the same WebGL context and builds its own scene list, so this is safe,
// just slower to start.

import { useEffect, useState, type RefObject } from 'react';
import { AppController } from '../app/controller';
import { createSessions, type Sessions } from '../app/sessions';

interface Engines { app: AppController; sessions: Sessions }

export function useEngines(canvas: RefObject<HTMLCanvasElement | null>): { app: AppController | null; sessions: Sessions | null; error: string | null } {
  const [engines, setEngines] = useState<Engines | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    let controller: AppController;
    try {
      controller = new AppController(canvas.current);
    } catch (err) {
      // The engines are an external system that can only be created once the canvas is mounted.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError((err as Error).message);
      return;
    }
    controller.start();
    const sessions = createSessions(controller);
    setEngines({ app: controller, sessions });
    return () => {
      sessions.dispose();
      controller.dispose();
      setEngines(null);
    };
  }, [canvas]);
  return { app: engines?.app ?? null, sessions: engines?.sessions ?? null, error };
}
