import { describe, expect, it } from 'vitest';
import { complete, helpText, parseCommand, value, words } from './commands';

describe('parseCommand', () => {
  it('reads the log\'s own commands', () => {
    expect(parseCommand('   ')).toBeNull();
    expect(parseCommand('help')).toEqual({ kind: 'builtin', name: 'help', topic: null });
    expect(parseCommand('help set_look')).toEqual({ kind: 'builtin', name: 'help', topic: 'set_look' });
    expect(parseCommand('CLEAR')).toEqual({ kind: 'builtin', name: 'clear' });
    expect(parseCommand('level warn')).toEqual({ kind: 'builtin', name: 'level', levels: ['error', 'warn'] });
    expect(parseCommand('level loud')).toMatchObject({ kind: 'error' });
    expect(parseCommand('source server')).toEqual({ kind: 'builtin', name: 'source', sources: ['server', 'command'] });
    expect(parseCommand('source all')).toMatchObject({ sources: ['console', 'server', 'app', 'command'] });
    expect(parseCommand('source disk')).toMatchObject({ kind: 'error' });
    expect(parseCommand('filter Ring Run')).toEqual({ kind: 'builtin', name: 'filter', query: 'Ring Run' });
    expect(parseCommand('state')).toEqual({ kind: 'tool', name: 'get_app_state', input: {} });
  });

  it('runs a tool by name, its input as key=value pairs or JSON', () => {
    expect(parseCommand('switch_scene scene="Ring Run"')).toEqual({ kind: 'tool', name: 'switch_scene', input: { scene: 'Ring Run' } });
    expect(parseCommand('switch_scene scene=Vortex')).toEqual({ kind: 'tool', name: 'switch_scene', input: { scene: 'Vortex' } });
    expect(parseCommand('set_look hue=0.3 speed=1.5')).toEqual({ kind: 'tool', name: 'set_look', input: { hue: 0.3, speed: 1.5 } });
    expect(parseCommand('set_look {"hue": 0.3}')).toEqual({ kind: 'tool', name: 'set_look', input: { hue: 0.3 } });
    expect(parseCommand('set_parameters values={"Size": 2, "On": true}')).toEqual({ kind: 'tool', name: 'set_parameters', input: { values: { Size: 2, On: true } } });
    expect(parseCommand('get_app_state')).toEqual({ kind: 'tool', name: 'get_app_state', input: {} });
  });

  it('says what is wrong with a line it can\'t read', () => {
    expect(parseCommand('set_look {"hue": }')).toMatchObject({ kind: 'error', message: expect.stringContaining('valid JSON') });
    expect(parseCommand('set_look [1]')).toMatchObject({ kind: 'error', message: expect.stringContaining('key=value') });
    expect(parseCommand('set_look hue')).toMatchObject({ kind: 'error', message: expect.stringContaining('key=value') });
    expect(parseCommand('swich_scene')).toMatchObject({ kind: 'error', message: expect.stringContaining('switch_scene') });
  });
});

describe('words and values', () => {
  it('keeps quoted strings and JSON together', () => {
    expect(words('a="b c" d={"e": [1, 2]} f')).toEqual(['a="b c"', 'd={"e": [1, 2]}', 'f']);
    expect(words('a="say \\"hi\\""')).toEqual(['a="say \\"hi\\""']);
    expect(value('"say \\"hi\\""')).toBe('say "hi"');
    expect(value('12')).toBe(12);
    expect(value('false')).toBe(false);
    expect(value('Ring')).toBe('Ring');
  });
});

describe('complete', () => {
  it('completes one name, or the prefix the names share', () => {
    expect(complete('swi')).toEqual({ text: 'switch_scene ', options: ['switch_scene'] });
    const c = complete('set_');
    expect(c.text).toBe('set_');
    expect(c.options).toEqual(expect.arrayContaining(['set_look', 'set_parameters']));
    expect(complete('re', ['read_scene_code', 'reorder_show', 'remove_show_scene']).text).toBe('re');
    expect(complete('rem', ['remove_a', 'remove_b']).text).toBe('remove_');
    expect(complete('zz').options).toEqual([]);
  });
});

describe('helpText', () => {
  it('lists everything, or says what one command or tool takes', () => {
    expect(helpText(null)).toContain('switch_scene');
    expect(helpText('level')).toContain('level <error|warn|info|debug>');
    const tool = helpText('switch_scene');
    expect(tool).toContain('Play another scene');
    expect(tool).toContain('scene: Exact scene name.');
    expect(helpText('get_app_state')).toContain('No input.');
    expect(helpText('nope')).toContain('no command or tool');
  });
});
