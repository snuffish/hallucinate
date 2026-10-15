import { describe, expect, it } from 'vitest';
import { extractMarked, mergePath } from './env';

describe('mergePath', () => {
  it('puts the login shell PATH first, then the current one, then the usual tool dirs, without duplicates', () => {
    const merged = mergePath('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin', '/Users/me', 'darwin').split(':');
    expect(merged.slice(0, 3)).toEqual(['/opt/homebrew/bin', '/usr/bin', '/bin']);
    expect(merged).toContain('/Users/me/.local/bin');
    expect(new Set(merged).size).toBe(merged.length);
  });

  it('still finds the usual tool dirs when the shell could not be asked', () => {
    const merged = mergePath('/usr/bin:/bin', null, '/home/me', 'linux').split(':');
    expect(merged.slice(0, 2)).toEqual(['/usr/bin', '/bin']);
    expect(merged).toContain('/usr/local/bin');
    expect(merged).not.toContain('/opt/homebrew/bin');
  });

  it('leaves Windows alone', () => {
    expect(mergePath('C:\\Windows', 'x', 'C:\\Users\\me', 'win32')).toBe('C:\\Windows');
  });
});

describe('extractMarked', () => {
  it('reads the PATH between the markers, ignoring what the login shell prints around it', () => {
    const out = 'Now using node v20\nHEJ!\n__HALLUCINATE_PATH__/a:/b__HALLUCINATE_PATH__\nbye';
    expect(extractMarked(out)).toBe('/a:/b');
  });

  it('gives null when the markers are missing or empty', () => {
    expect(extractMarked('nothing here')).toBeNull();
    expect(extractMarked('__HALLUCINATE_PATH____HALLUCINATE_PATH__')).toBeNull();
  });
});
