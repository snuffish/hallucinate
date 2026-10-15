import { describe, expect, it } from 'vitest';
import { adoptShellVars, extractMarked, mergePath, parseEnv } from './env';

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

describe('shell variables', () => {
  it('reads env -0 output, values with = and newlines included', () => {
    const vars = parseEnv('PATH=/a:/b\0ANTHROPIC_API_KEY=sk-1=2\0NOTE=two\nlines\0');
    expect(vars.get('PATH')).toBe('/a:/b');
    expect(vars.get('ANTHROPIC_API_KEY')).toBe('sk-1=2');
    expect(vars.get('NOTE')).toBe('two\nlines');
    expect(parseEnv(null).size).toBe(0);
  });

  it('takes only the app\'s own settings, and never overrides what the app was started with', () => {
    const env: NodeJS.ProcessEnv = { CLAUDE_BIN: '/mine/claude' };
    const shell = new Map([['ANTHROPIC_API_KEY', 'sk'], ['CLAUDE_BIN', '/shell/claude'], ['AWS_SECRET_ACCESS_KEY', 'x'], ['YTDLP', '']]);
    expect(adoptShellVars(env, shell)).toEqual(['ANTHROPIC_API_KEY']);
    expect(env).toEqual({ CLAUDE_BIN: '/mine/claude', ANTHROPIC_API_KEY: 'sk' });
  });
});
