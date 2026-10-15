// Creates the AppController once the canvas exists, and disposes it on unmount. Under StrictMode the
// effect runs twice in development; the second controller reuses the same WebGL context, so this is
// safe, just slower to start.

import { useEffect, useState, type RefObject } from 'react';
import { AppController } from '../app/controller';

export function useEngines(canvas: RefObject<HTMLCanvasElement | null>): { app: AppController | null; error: string | null } {
  const [app, setApp] = useState<AppController | null>(null);
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
    setApp(controller);
    return () => {
      controller.dispose();
      setApp(null);
    };
  }, [canvas]);
  return { app, error };
}
