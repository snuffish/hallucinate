import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { commitRaw, debouncedWriter, flushAll, freeze, readJSON, remove, unfreeze, writeJSON } from './persistence';

// A minimal localStorage for Node.
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    writes: 0,
  };
}

describe('persistence', () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    const original = storage.setItem;
    storage.setItem = (k, v) => { storage.writes++; original(k, v); };
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => { unfreeze(); vi.unstubAllGlobals(); });

  it('readJSON falls back on missing, malformed and mismatching data', () => {
    const schema = z.object({ volume: z.number() });
    expect(readJSON('x', schema, { volume: 0.8 })).toEqual({ volume: 0.8 });
    storage.setItem('x', '{not json');
    expect(readJSON('x', schema, { volume: 0.8 })).toEqual({ volume: 0.8 });
    storage.setItem('x', JSON.stringify({ volume: 'loud' }));
    expect(readJSON('x', schema, { volume: 0.8 })).toEqual({ volume: 0.8 });
    writeJSON('x', { volume: 0.3 });
    expect(readJSON('x', schema, { volume: 0.8 })).toEqual({ volume: 0.3 });
  });

  it('debouncedWriter coalesces a burst into one write', () => {
    vi.useFakeTimers();
    let value = 0;
    const writer = debouncedWriter('k', () => ({ value }), 100);
    for (let i = 0; i < 50; i++) { value = i; writer.schedule(); }
    expect(storage.writes).toBe(0);
    vi.advanceTimersByTime(150);
    expect(storage.writes).toBe(1);
    expect(storage.getItem('k')).toBe(JSON.stringify({ value: 49 }));
    writer.schedule();
    writer.dispose();   // flushes
    expect(storage.writes).toBe(2);
    vi.useRealTimers();
  });

  it('flushAll stores every live writer\'s pending change, and forgets disposed writers', () => {
    const a = debouncedWriter('a', () => 1, 10_000);
    const b = debouncedWriter('b', () => 2, 10_000);
    a.schedule(); b.schedule();
    flushAll();
    expect([storage.getItem('a'), storage.getItem('b')]).toEqual(['1', '2']);
    b.dispose();
    storage.removeItem('b');
    b.schedule();
    flushAll();
    expect(storage.getItem('b')).toBeNull();
    a.dispose();
  });

  // An import freezes storage so a stale writer (e.g. the pagehide flush during the reload) can't
  // overwrite what was just imported.
  it('freeze blocks every write except commitRaw', () => {
    storage.setItem('k', 'imported');
    const w = debouncedWriter('k', () => 'stale', 10_000);
    w.schedule();
    freeze();
    w.flush();
    writeJSON('k', 'stale');
    remove('k');
    expect(storage.getItem('k')).toBe('imported');
    commitRaw('k', 'newer');
    expect(storage.getItem('k')).toBe('newer');
    commitRaw('k', null);
    expect(storage.getItem('k')).toBeNull();
    w.dispose();
  });

  it('commitRaw throws when the write fails or does not read back', () => {
    storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    expect(() => commitRaw('k', 'v')).toThrow('full');
    storage.setItem = () => {};
    expect(() => commitRaw('k', 'v')).toThrow("Couldn't store k.");
  });
});
