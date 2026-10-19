import { describe, expect, it, vi } from 'vitest';
import { captureConsole } from './console-capture';
import { SystemLog } from './system-log';

function fakeWindow() {
  const listeners = new Map<string, (e: Event) => void>();
  return {
    console: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() },
    addEventListener: (type: string, fn: (e: Event) => void) => { listeners.set(type, fn); },
    removeEventListener: (type: string) => { listeners.delete(type); },
    fire: (type: string, e: object) => listeners.get(type)?.(e as Event),
    listeners,
  };
}

describe('captureConsole', () => {
  it('copies each console call into the log at its level, and still prints it', () => {
    const w = fakeWindow();
    const printed = w.console.warn;
    const log = new SystemLog(10, 0);
    const undo = captureConsole(log, w);
    w.console.warn('low', 3);
    w.console.log('plain');
    w.console.debug('quiet');
    expect(printed).toHaveBeenCalledWith('low', 3);
    expect(log.entries().map((e) => [e.level, e.source, e.text])).toEqual([['warn', 'console', 'low 3'], ['info', 'console', 'plain'], ['debug', 'console', 'quiet']]);
    undo();
    expect(w.console.warn).toBe(printed);
    expect(w.listeners.size).toBe(0);
  });

  it('logs errors nothing caught and rejections nothing handled', () => {
    const w = fakeWindow();
    const log = new SystemLog(10, 0);
    captureConsole(log, w);
    w.fire('error', { error: new RangeError('too far'), message: 'too far', filename: 'http://x/src/a.ts', lineno: 3, colno: 7 });
    w.fire('unhandledrejection', { reason: 'nobody listened' });
    expect(log.entries().map((e) => e.text)).toEqual(['Uncaught RangeError: too far (http://x/src/a.ts:3:7)', 'Unhandled rejection: nobody listened']);
    expect(log.entries()[0]!.detail).toContain('RangeError: too far');
  });
});
