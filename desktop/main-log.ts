// The desktop app's main process in the System log (Shift+S). The app's server runs in this process, so the
// main process writes into the server's log (server/log.ts) and the lines reach the window over /api/log like
// the server's own, marked `desktop`: no IPC, no preload. What gets there: the main process's console, errors
// nothing caught and Node's warnings, and what Electron reports (main.ts): a window's page crashing or
// hanging, a helper process (the GPU) going away, a page failing to load, a permission refused.
//
// With `npm run desktop` the window loads the Vite dev server, a process of its own, so these lines stay in the
// terminal there.

import { formatServerArgs, serverLog, type ServerLevel, type ServerLog } from '../server/log';

type Method = 'error' | 'warn' | 'info' | 'log' | 'debug';
// Node prints its warnings on console.error as "(node:1234) Warning: …"; the `warning` event logs them, at their level.
const NODE_WARNING = /^\(node:\d+\) /;
const LEVEL_OF: Record<Method, ServerLevel> = { error: 'error', warn: 'warn', info: 'info', log: 'info', debug: 'debug' };

export const desktopLine = (level: ServerLevel, text: string, detail?: string, log: ServerLog = serverLog): void => {
  log.push(level, text, detail, 'desktop');
};

type Proc = Pick<NodeJS.EventEmitter, 'on' | 'off'>;   // the process (an emitter in the tests)

// Copies the main process's console into the log (still printed) and adds the errors nothing caught (watched
// only: Electron still handles them as before) and Node's warnings. Returns the undo.
export function captureMainProcess(log: ServerLog = serverLog, c: Pick<Console, Method> = console, proc: Proc = process): () => void {
  const originals = {} as Record<Method, (...args: unknown[]) => void>;
  for (const m of Object.keys(LEVEL_OF) as Method[]) {
    const original = c[m].bind(c);
    originals[m] = c[m];
    c[m] = (...args: unknown[]) => {
      original(...args);
      if (typeof args[0] === 'string' && NODE_WARNING.test(args[0])) return;
      const { text, detail } = formatServerArgs(args);
      desktopLine(LEVEL_OF[m], text, detail, log);
    };
  }
  const onUncaught = (err: Error, origin: string) => {
    desktopLine('error', `${origin === 'unhandledRejection' ? 'Unhandled rejection' : 'Uncaught'} in the main process: ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`, err?.stack, log);
  };
  const onWarning = (w: Error) => desktopLine('warn', `${w.name}: ${w.message}`, w.stack, log);
  proc.on('uncaughtExceptionMonitor', onUncaught);
  proc.on('warning', onWarning);
  return () => {
    Object.assign(c, originals);
    proc.off('uncaughtExceptionMonitor', onUncaught);
    proc.off('warning', onWarning);
  };
}

// Electron's `render-process-gone` / `child-process-gone` details, as a line. A clean exit is a plain info line.
export interface GoneDetails { reason: string; exitCode: number; type?: string; name?: string; serviceName?: string }

const GONE_WORDS: Record<string, string> = {
  'abnormal-exit': 'exited abnormally', killed: 'was killed', crashed: 'crashed', oom: 'ran out of memory',
  'launch-failed': 'failed to start', 'integrity-failure': 'failed its code integrity check', 'memory-eviction': 'was evicted to free memory',
};

export function goneLine(what: string, d: GoneDetails): { level: ServerLevel; text: string } {
  const who = d.type ? `${d.name || d.serviceName || d.type} process` : what;
  if (d.reason === 'clean-exit') return { level: 'info', text: `${who} exited` };
  return { level: 'error', text: `${who} ${GONE_WORDS[d.reason] ?? d.reason.replace(/-/g, ' ')} (exit code ${d.exitCode})` };
}

// What a window is, for its lines: the main one or a projector, from its URL.
export const windowName = (url: string): string => (/\/output\.html(\?|#|$)/.test(url) ? 'Projector window' : 'Main window');
