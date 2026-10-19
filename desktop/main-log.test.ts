import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ServerLog } from '../server/log';
import { captureMainProcess, goneLine, windowName } from './main-log';

const fakeConsole = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() });

describe('captureMainProcess', () => {
  it('copies the main process\'s console into the server\'s log as desktop lines, and still prints it', () => {
    const log = new ServerLog();
    const c = fakeConsole();
    const printed = c.error;
    const undo = captureMainProcess(log, c, new EventEmitter());
    c.error('GPU said', { code: 5 });
    c.log('plain');
    expect(printed).toHaveBeenCalledWith('GPU said', { code: 5 });
    expect(log.backlog().map((l) => [l.origin, l.level, l.text])).toEqual([['desktop', 'error', 'GPU said { code: 5 }'], ['desktop', 'info', 'plain']]);
    undo();
    expect(c.error).toBe(printed);
  });

  it('logs errors nothing caught and Node\'s warnings, without handling them', () => {
    const log = new ServerLog();
    const proc = new EventEmitter();
    const c = fakeConsole();
    const undo = captureMainProcess(log, c, proc);
    proc.emit('uncaughtExceptionMonitor', new TypeError('bad'), 'uncaughtException');
    proc.emit('uncaughtExceptionMonitor', new Error('never awaited'), 'unhandledRejection');
    const warning = new Error('Buffer() is deprecated');
    warning.name = 'DeprecationWarning';
    proc.emit('warning', warning);
    c.error('(node:1234) DeprecationWarning: Buffer() is deprecated');   // Node's own print of it: logged once, above
    expect(log.backlog().map((l) => [l.level, l.text])).toEqual([
      ['error', 'Uncaught in the main process: TypeError: bad'],
      ['error', 'Unhandled rejection in the main process: Error: never awaited'],
      ['warn', 'DeprecationWarning: Buffer() is deprecated'],
    ]);
    expect(log.backlog()[0]!.detail).toContain('TypeError: bad');
    undo();
    expect(proc.listenerCount('uncaughtExceptionMonitor') + proc.listenerCount('warning')).toBe(0);
  });
});

describe('what Electron reports', () => {
  it('says which process went away and why', () => {
    expect(goneLine('Main window\'s page', { reason: 'crashed', exitCode: 11 })).toEqual({ level: 'error', text: 'Main window\'s page crashed (exit code 11)' });
    expect(goneLine('A helper process', { reason: 'oom', exitCode: 1, type: 'GPU' })).toEqual({ level: 'error', text: 'GPU process ran out of memory (exit code 1)' });
    expect(goneLine('A helper process', { reason: 'clean-exit', exitCode: 0, type: 'Utility', name: 'Audio Service' })).toEqual({ level: 'info', text: 'Audio Service process exited' });
    expect(goneLine('x', { reason: 'some-new-reason', exitCode: 2 }).text).toBe('x some new reason (exit code 2)');
  });

  it('names a window by its page', () => {
    expect(windowName('http://127.0.0.1:47741/')).toBe('Main window');
    expect(windowName('http://127.0.0.1:47741/output.html?id=2')).toBe('Projector window');
  });
});
