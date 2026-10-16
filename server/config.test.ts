import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConfigPath, effectiveConfig, fileConfigStore, type Secrets } from './config';

// A reversible stand-in for safeStorage.
const fakeSecrets: Secrets = {
  encrypt: (s) => Buffer.from(`enc:${s}`).toString('base64'),
  decrypt: (s) => { const p = Buffer.from(s, 'base64').toString(); if (!p.startsWith('enc:')) throw new Error('not ours'); return p.slice(4); },
};

describe('assistant settings precedence', () => {
  it('uses the defaults when nothing is set', () => {
    const c = effectiveConfig({}, { v: 1 }, null);
    expect(c.backend).toEqual({ value: 'auto', source: 'default' });
    expect(c.model).toEqual({ value: null, source: 'default' });
    expect(c.effort).toEqual({ value: 'high', source: 'default' });
    expect(c.directorEffort).toEqual({ value: 'high', source: 'default' });
    expect(c.apiKey).toEqual({ value: null, source: 'default' });
  });

  it('takes Settings over the defaults, and the environment over both', () => {
    const stored = { v: 1 as const, backend: 'claude-code' as const, model: 'sonnet', effort: 'low' as const };
    expect(effectiveConfig({}, stored, null)).toMatchObject({
      backend: { value: 'claude-code', source: 'settings' }, model: { value: 'sonnet', source: 'settings' },
      effort: { value: 'low', source: 'settings' }, directorEffort: { value: 'low', source: 'default' },
    });
    const env = { ASSISTANT_BACKEND: 'api', ASSISTANT_MODEL: 'claude-sonnet-5-5', ASSISTANT_EFFORT: 'max' };
    expect(effectiveConfig(env, stored, null)).toMatchObject({
      backend: { value: 'api', source: 'env' }, model: { value: 'claude-sonnet-5-5', source: 'env' },
      effort: { value: 'max', source: 'env' }, directorEffort: { value: 'max', source: 'default' },
    });
  });

  it('treats an empty or unknown environment value as unset', () => {
    expect(effectiveConfig({ ASSISTANT_MODEL: '', ASSISTANT_BACKEND: 'nonsense' }, { v: 1, model: 'opus' }, null)).toMatchObject({
      backend: { value: 'auto', source: 'default' }, model: { value: 'opus', source: 'settings' },
    });
  });

  it('decrypts a saved API key, prefers the environment\'s, and reports one it can\'t read', () => {
    const stored = { v: 1 as const, apiKey: fakeSecrets.encrypt('sk-ant-saved') };
    expect(effectiveConfig({}, stored, fakeSecrets).apiKey).toEqual({ value: 'sk-ant-saved', source: 'settings' });
    expect(effectiveConfig({ ANTHROPIC_API_KEY: 'sk-ant-env' }, stored, fakeSecrets).apiKey).toEqual({ value: 'sk-ant-env', source: 'env' });
    expect(effectiveConfig({ ANTHROPIC_AUTH_TOKEN: 'tok' }, stored, fakeSecrets).apiKey).toEqual({ value: 'tok', source: 'env' });
    expect(effectiveConfig({}, stored, null).apiKey).toEqual({ value: null, source: 'settings', unreadable: true });
    expect(effectiveConfig({}, { v: 1, apiKey: 'garbage' }, fakeSecrets).apiKey).toEqual({ value: null, source: 'settings', unreadable: true });
  });

  it('keeps the config file in the user\'s config directory', () => {
    expect(defaultConfigPath({ XDG_CONFIG_HOME: '/x' }, 'linux')).toBe(join('/x', 'hallucinate', 'config.json'));
    expect(defaultConfigPath({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32')).toBe(join('C:\\Users\\a\\AppData\\Roaming', 'hallucinate', 'config.json'));
  });
});

describe('the config file', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hallucinate-config-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads nothing as empty and round-trips what it writes', () => {
    const path = join(dir, 'nested', 'config.json');
    const store = fileConfigStore(path);
    expect(store.read()).toEqual({ v: 1 });
    store.write({ v: 1, model: 'opus', effort: 'low' });
    expect(fileConfigStore(path).read()).toEqual({ v: 1, model: 'opus', effort: 'low' });
  });

  it('is readable by this user only, and leaves no temporary file behind', () => {
    const path = join(dir, 'config.json');
    fileConfigStore(path).write({ v: 1, effort: 'max' });
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['config.json']);
  });

  it('drops invalid fields one by one and ignores a broken file', () => {
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ v: 1, model: 'rm -rf /', effort: 'low', backend: 'nope' }));
    expect(fileConfigStore(path).read()).toEqual({ v: 1, effort: 'low' });
    writeFileSync(path, '{broken');
    expect(fileConfigStore(path).read()).toEqual({ v: 1 });
  });

  it('notices a write by another process', async () => {
    const path = join(dir, 'config.json');
    const store = fileConfigStore(path);
    store.write({ v: 1, effort: 'low' });
    await new Promise((r) => setTimeout(r, 20));   // a different mtime
    writeFileSync(path, JSON.stringify({ v: 1, effort: 'max' }));
    expect(store.read()).toEqual({ v: 1, effort: 'max' });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ v: 1, effort: 'max' });
  });

  it('tells its listeners about a write', () => {
    const store = fileConfigStore(join(dir, 'config.json'));
    let calls = 0;
    const off = store.onChange(() => calls++);
    store.write({ v: 1 });
    off();
    store.write({ v: 1 });
    expect(calls).toBe(1);
  });
});
