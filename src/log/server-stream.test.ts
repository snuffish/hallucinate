import { describe, expect, it } from 'vitest';
import { isNew } from './server-stream';

describe('isNew', () => {
  it('skips the lines a reconnect sends again, and keeps a restarted server\'s', () => {
    expect(isNew({ id: 1, t: 10 }, null)).toBe(true);
    expect(isNew({ id: 4, t: 10 }, { id: 5, t: 12 })).toBe(false);
    expect(isNew({ id: 5, t: 12 }, { id: 5, t: 12 })).toBe(false);
    expect(isNew({ id: 6, t: 12 }, { id: 5, t: 12 })).toBe(true);
    expect(isNew({ id: 1, t: 20 }, { id: 5, t: 12 })).toBe(true);   // started again: numbered from 1, but later
  });
});
