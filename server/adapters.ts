// Which way to reach Claude, picked automatically (ASSISTANT_BACKEND overrides):
//   api          an Anthropic API key (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN): TanStack's Anthropic adapter.
//   claude-code  the user's Claude subscription, through the local Claude Code CLI: our own locked-down adapter.

import { execFile } from 'node:child_process';
import { anthropicText } from '@tanstack/ai-anthropic';
import { ClaudeCliAdapter, CLAUDE_BIN } from './claude-cli-adapter';

export type Backend = 'api' | 'claude-code' | 'none';
export const MODEL = process.env.ASSISTANT_MODEL || 'claude-opus-5-5';
export const EFFORT = process.env.ASSISTANT_EFFORT || 'high';
// The director's cycles may run at a lower effort than the chat; same as the chat unless set.
export const DIRECTOR_EFFORT = process.env.ASSISTANT_DIRECTOR_EFFORT || EFFORT;

export const NO_BACKEND = 'The assistant needs Claude. With a Claude subscription: install Claude Code (the `claude` command), sign in once, and restart the dev server. With an API key: export ANTHROPIC_API_KEY=sk-ant-… and restart the dev server.';

export function claudeCodeAvailable(): Promise<string | null> {
  return new Promise((resolve) => execFile(CLAUDE_BIN, ['--version'], { timeout: 15_000 }, (err, out) => resolve(err ? null : String(out).trim())));
}

export async function detectBackend(): Promise<Backend> {
  const forced = process.env.ASSISTANT_BACKEND;
  if (forced === 'api' || forced === 'claude-code') return forced;
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return 'api';
  return (await claudeCodeAvailable()) ? 'claude-code' : 'none';
}

export function createAdapter(backend: Backend, effort = EFFORT) {
  if (backend === 'api') return anthropicText(MODEL as 'claude-opus-5-5');
  if (backend === 'claude-code') return new ClaudeCliAdapter(process.env.ASSISTANT_MODEL, effort);
  return null;
}
