// /api/settings: the assistant's settings for the Settings overlay (server/config.ts).
//
//   GET   each field's value, where it comes from (environment / Settings / default) and whether the
//         environment locks it; the API key only as "set" or not, never its value; what there is to
//         choose from; the program paths, read-only.
//   POST  { backend?, model?, effort?, directorEffort?, apiKey? }, null clears one. Answers like GET.
// Both shapes are declared in src/assistant/settings-wire.ts, which the browser parses them with.
//
// Writing is only for this computer: with HOST=0.0.0.0 or ALLOWED_HOSTS the app is reachable from the
// network, and a device there may look but not change how the server reaches Claude.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ANTHROPIC_MODELS } from '@tanstack/ai-anthropic';
import { SettingsPatchSchema, type Backend, type SettingsPatch, type SettingsView } from '../src/assistant/settings-wire';
import { BACKEND_CHOICES, DEFAULT_MODEL, EFFORTS, ENV_NAMES, effectiveConfig, type ConfigStore, type EffectiveConfig, type Field, type StoredConfig } from './config';
import { isLoopbackHost } from './guard';
import { readBody, sendJSON } from './http';

const MAX_BODY = 16 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };   // a settings answer is never reused

export type { SettingsPatch, SettingsView };
type FieldId = keyof SettingsPatch;

export interface SettingsRouteOptions {
  env?: NodeJS.ProcessEnv;
  // The backend these settings lead to (the assistant's own detection, shared so a save re-detects both).
  backend: { get(): Promise<Backend>; reset(): void };
  paths: { claudeBin: string; ytdlp: string };
}

export function settingsView(cfg: EffectiveConfig, config: ConfigStore, backend: Backend, paths: SettingsRouteOptions['paths'], canWrite: boolean): SettingsView {
  const field = <T>(f: Field<T>) => ({ value: f.value, source: f.source, locked: f.source === 'env' });
  return {
    backend: field(cfg.backend),
    model: field(cfg.model),
    effort: field(cfg.effort),
    directorEffort: field(cfg.directorEffort),
    apiKey: {
      set: cfg.apiKey.value !== null,
      source: cfg.apiKey.source,
      locked: cfg.apiKey.source === 'env',
      editable: canWrite && !!config.secrets && cfg.apiKey.source !== 'env',
      unreadable: !!cfg.apiKey.unreadable,
    },
    detected: backend,
    canWrite,
    options: { backends: BACKEND_CHOICES, efforts: EFFORTS, apiModels: ANTHROPIC_MODELS, defaultModel: DEFAULT_MODEL },
    env: ENV_NAMES,
    paths,
  };
}

export function createSettingsRoute(config: ConfigStore, { env = process.env, backend, paths }: SettingsRouteOptions) {
  const effective = (stored = config.read()) => effectiveConfig(env, stored, config.secrets);
  const view = async (req: IncomingMessage) => settingsView(effective(), config, await backend.get(), paths, isLoopbackHost(req.headers.host));

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET') return sendJSON(res, 200, await view(req), NO_STORE);
    if (req.method !== 'POST') return sendJSON(res, 405, { error: 'GET or POST' }, NO_STORE);
    if (!isLoopbackHost(req.headers.host)) return sendJSON(res, 403, { error: 'Settings can only be changed on the computer Hallucinate runs on.' }, NO_STORE);

    let patch: SettingsPatch;
    try {
      const parsed = SettingsPatchSchema.safeParse(JSON.parse(await readBody(req, MAX_BODY)));
      if (!parsed.success) return sendJSON(res, 400, { error: parsed.error.issues[0]?.message ?? 'Bad settings' }, NO_STORE);
      patch = parsed.data;
    } catch (err) {
      return sendJSON(res, 400, { error: `Bad request: ${(err as Error).message}` }, NO_STORE);
    }

    const now = effective();
    for (const id of Object.keys(patch) as FieldId[]) {
      if (now[id].source === 'env') return sendJSON(res, 409, { error: `${ENV_NAMES[id]} is set in the environment Hallucinate was started with, and that wins. Remove it there to change this here.` }, NO_STORE);
    }
    if (patch.apiKey && !config.secrets) return sendJSON(res, 400, { error: 'This server can\'t store an API key safely. Set ANTHROPIC_API_KEY in its environment instead.' }, NO_STORE);

    const stored = config.read();
    const next: StoredConfig = { ...stored };
    for (const id of Object.keys(patch) as FieldId[]) {
      const value = patch[id];
      if (value === null || value === undefined) delete next[id];
      else if (id === 'apiKey') next.apiKey = config.secrets!.encrypt(value);
      else (next as Record<string, unknown>)[id] = value;
    }

    // On the API only Anthropic's model ids work; the CLI also takes its aliases (opus, sonnet…).
    const after = effective(next);
    const model = after.model.value;
    if (model && usesApi(after) && !(ANTHROPIC_MODELS as readonly string[]).includes(model)) {
      return sendJSON(res, 400, { error: `"${model}" isn't a model the Anthropic API offers. Pick one from the list.` }, NO_STORE);
    }

    try {
      config.write(next);
    } catch (err) {
      return sendJSON(res, 500, { error: `Couldn't save the settings: ${(err as Error).message}` }, NO_STORE);
    }
    backend.reset();
    return sendJSON(res, 200, await view(req), NO_STORE);
  };
}

// Whether `cfg` reaches Claude through the API (the same rule as detectBackend in adapters.ts).
export const usesApi = (cfg: EffectiveConfig): boolean => cfg.backend.value === 'api' || (cfg.backend.value === 'auto' && cfg.apiKey.value !== null);
