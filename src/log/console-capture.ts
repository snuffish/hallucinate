// Copies what the page says on its console into the System log: console.error / warn / info / log / debug
// (still printed as before), uncaught errors and unhandled promise rejections. Installed first thing in
// main.tsx, so a startup error is in the log too.

import { formatArgs, type LogLevel, type SystemLog } from './system-log';

type Method = 'error' | 'warn' | 'info' | 'log' | 'debug';
const LEVEL_OF: Record<Method, LogLevel> = { error: 'error', warn: 'warn', info: 'info', log: 'info', debug: 'debug' };

interface Target {
  console: Pick<Console, Method>;
  addEventListener?: (type: string, fn: (e: Event) => void) => void;
  removeEventListener?: (type: string, fn: (e: Event) => void) => void;
}

// Returns the undo. `target` is the window (a fake one in the tests).
export function captureConsole(log: SystemLog, target: Target = globalThis as unknown as Target): () => void {
  const c = target.console;
  const originals = {} as Record<Method, (...args: unknown[]) => void>;
  let inside = false;   // a line the log itself makes while recording (it never should) is not recorded again
  for (const m of Object.keys(LEVEL_OF) as Method[]) {
    const original = c[m].bind(c);
    originals[m] = c[m];
    c[m] = (...args: unknown[]) => {
      original(...args);
      if (inside) return;
      inside = true;
      try { log.push({ level: LEVEL_OF[m], source: 'console', ...formatArgs(args) }); } finally { inside = false; }
    };
  }
  const onError = (e: Event) => {
    const ev = e as ErrorEvent;
    const where = ev.filename ? ` (${ev.filename.replace(globalThis.location?.origin ?? '', '')}:${ev.lineno}:${ev.colno})` : '';
    const { text, detail } = formatArgs([ev.error ?? ev.message]);
    log.push({ level: 'error', source: 'console', text: `Uncaught ${text}${where}`, detail });
  };
  const onRejection = (e: Event) => {
    const { text, detail } = formatArgs([(e as PromiseRejectionEvent).reason]);
    log.push({ level: 'error', source: 'console', text: `Unhandled rejection: ${text}`, detail });
  };
  target.addEventListener?.('error', onError);
  target.addEventListener?.('unhandledrejection', onRejection);
  return () => {
    Object.assign(c, originals);
    target.removeEventListener?.('error', onError);
    target.removeEventListener?.('unhandledrejection', onRejection);
  };
}
