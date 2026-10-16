// Which way to reach Claude, picked automatically (Settings → Assistant or ASSISTANT_BACKEND override it):
//   api          an Anthropic API key (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, or one saved in the desktop
//                app's Settings): TanStack's Anthropic adapter.
//   claude-code  the user's Claude subscription, through the local Claude Code CLI: our own locked-down adapter.
// Model, effort and backend come from server/config.ts: the environment, then Settings, then the default.

import { execFile } from 'node:child_process';
import { anthropicText, createAnthropicChat, type ANTHROPIC_MODELS } from '@tanstack/ai-anthropic';
import { ClaudeCliAdapter, CLAUDE_BIN } from './claude-cli-adapter';
import { DEFAULT_MODEL, effectiveConfig, type ConfigStore, type EffectiveConfig } from './config';

export type Backend = 'api' | 'claude-code' | 'none';

export const NO_BACKEND = 'The assistant needs Claude. With a Claude subscription: install Claude Code (the `claude` command) and sign in once. With an API key: add it in Settings → Assistant (desktop app), or export ANTHROPIC_API_KEY=sk-ant-… and restart the dev server.';

export function claudeCodeAvailable(): Promise<string | null> {
  return new Promise((resolve) => execFile(CLAUDE_BIN, ['--version'], { timeout: 15_000 }, (err, out) => resolve(err ? null : String(out).trim())));
}

// `auto` takes the API when there is a key, else the subscription when the CLI is installed.
export async function detectBackend(cfg: EffectiveConfig): Promise<Backend> {
  const choice = cfg.backend.value;
  if (choice === 'api' || choice === 'claude-code') return choice;
  if (cfg.apiKey.value) return 'api';
  return (await claudeCodeAvailable()) ? 'claude-code' : 'none';
}

// The settings as they are now, and the backend they lead to. Detection probes the CLI, so it is
// remembered until the settings change (a save from Settings re-detects, without a restart).
export interface AssistantConfig {
  current(): EffectiveConfig;
  backend(): Promise<Backend>;
  resetBackend(): void;
}

export function assistantConfig(config: ConfigStore, env: NodeJS.ProcessEnv = process.env): AssistantConfig {
  let backend: Promise<Backend> | undefined;
  const current = () => effectiveConfig(env, config.read(), config.secrets);
  config.onChange(() => { backend = undefined; });
  return {
    current,
    backend: () => (backend ??= detectBackend(current())),
    resetBackend: () => { backend = undefined; },
  };
}

// The model a run uses: the setting, else the API's default (the CLI picks its own).
export const apiModel = (cfg: EffectiveConfig): string => cfg.model.value ?? DEFAULT_MODEL;

export function createAdapter(backend: Backend, cfg: EffectiveConfig, effort: string) {
  if (backend === 'api') {
    const model = apiModel(cfg) as (typeof ANTHROPIC_MODELS)[number];
    // A key from Settings is passed in; one from the environment is read by the SDK itself (incl. ANTHROPIC_AUTH_TOKEN).
    return cfg.apiKey.source === 'settings' && cfg.apiKey.value ? createAnthropicChat(model, cfg.apiKey.value) : anthropicText(model);
  }
  if (backend === 'claude-code') return new ClaudeCliAdapter(cfg.model.value ?? undefined, effort);
  return null;
}
