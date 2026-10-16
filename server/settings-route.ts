// /api/settings: the assistant's settings for the Settings overlay (server/config.ts).
//
//   GET   each field's value, where it comes from (environment / Settings / default) and whether the
//         environment locks it; the API key only as "set" or not, never its value; what there is to
//         choose from; the program paths, read-only.
//   POST  { backend?, model?, effort?, directorEffort?, apiKey? }, null clears one. Answers like GET.
//
// Writing is only for this computer: with HOST=0.0.0.0 or ALLOWED_HOSTS the app is reachable from the
// network, and a device there may look but not change how the server reaches Claude.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ANTHROPIC_MODELS } from '@tanstack/ai-anthropic';
import { z } from 'zod';
import type { Backend } from './adapters';
import { BACKEND_CHOICES, DEFAULT_MODEL, EFFORTS, ENV_NAMES, MODEL_PATTERN, effectiveConfig, type ConfigStore, type EffectiveConfig, type StoredConfig } from './config';
import { isLoopbackHost } from './guard';

const MAX_BODY = 16 * 1024;

const PatchSchema = z.object({
  backend: z.enum(BACKEND_CHOICES).nullable().optional(),
  model: z.string().regex(MODEL_PATTERN).nullable().optional(),
  effort: z.enum(EFFORTS).nullable().optional(),
  directorEffort: z.enum(EFFORTS).nullable().optional(),
  apiKey: z.string().trim().regex(/^\S{20,400}$/, 'That doesn\'t look like an API key.').nullable().optional(),
}).strict();
export type SettingsPatch = z.infer<typeof PatchSchema>;
type FieldId = keyof SettingsPatch;

export interface SettingsRouteOptions {
  env?: NodeJS.ProcessEnv;
  // The backend these settings lead to (the assistant's own detection, shared so a save re-detects both).
  backend: { get(): Promise<Backend>; reset(): void };
  paths: { claudeBin: string; ytdlp: string };
}

export function settingsView(cfg: EffectiveConfig, config: ConfigStore, backend: Backend, paths: SettingsRouteOptions['paths'], canWrite: boolean) {
  const field = <T>(f: { value: T; source: string }) => ({ value: f.value, source: f.source, locked: f.source === 'env' });
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
export type SettingsView = ReturnType<typeof settingsView>;

export function createSettingsRoute(config: ConfigStore, { env = process.env, backend, paths }: SettingsRouteOptions) {
  const effective = (stored = config.read()) => effectiveConfig(env, stored, config.secrets);
  const view = async (req: IncomingMessage) => settingsView(effective(), config, await backend.get(), paths, isLoopbackHost(req.headers.host));

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET') return json(res, 200, await view(req));
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });
    if (!isLoopbackHost(req.headers.host)) return json(res, 403, { error: 'Settings can only be changed on the computer Hallucinate runs on.' });

    let patch: SettingsPatch;
    try {
      const parsed = PatchSchema.safeParse(JSON.parse(await readBody(req)));
      if (!parsed.success) return json(res, 400, { error: parsed.error.issues[0]?.message ?? 'Bad settings' });
      patch = parsed.data;
    } catch (err) {
      return json(res, 400, { error: `Bad request: ${(err as Error).message}` });
    }

    const now = effective();
    for (const id of Object.keys(patch) as FieldId[]) {
      if (now[id].source === 'env') return json(res, 409, { error: `${ENV_NAMES[id]} is set in the environment Hallucinate was started with, and that wins. Remove it there to change this here.` });
    }
    if (patch.apiKey && !config.secrets) return json(res, 400, { error: 'This server can\'t store an API key safely. Set ANTHROPIC_API_KEY in its environment instead.' });

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
      return json(res, 400, { error: `"${model}" isn't a model the Anthropic API offers. Pick one from the list.` });
    }

    try {
      config.write(next);
    } catch (err) {
      return json(res, 500, { error: `Couldn't save the settings: ${(err as Error).message}` });
    }
    backend.reset();
    return json(res, 200, await view(req));
  };
}

// Whether `cfg` reaches Claude through the API (the same rule as detectBackend in adapters.ts).
export const usesApi = (cfg: EffectiveConfig): boolean => cfg.backend.value === 'api' || (cfg.backend.value === 'auto' && cfg.apiKey.value !== null);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
