// How the server reaches Claude, on the wire, declared once for both ends: the server (server/config.ts,
// server/settings-route.ts, /info in server/assistant.ts) answers with these shapes and the browser's
// Settings → Assistant and assistant panels parse them. A leaf: zod only, so both can load it.
//
//   GET  /api/settings         SettingsView
//   POST /api/settings         SettingsPatch (null clears a field) -> SettingsView, or { error }
//   GET  /api/assistant/info   AssistantInfo

import { z } from 'zod';

export const SETTINGS_URL = '/api/settings';
export const INFO_URL = '/api/assistant/info';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;   // `claude --effort`, and TanStack's reasoning levels
export type Effort = (typeof EFFORTS)[number];
// What Settings chooses between; `auto` takes an API key when there is one, else the subscription.
export const BACKEND_CHOICES = ['auto', 'api', 'claude-code'] as const;
export type BackendChoice = (typeof BACKEND_CHOICES)[number];
// What the settings lead to: the API, the Claude subscription through the CLI, or nothing set up yet.
export const BACKENDS = ['api', 'claude-code', 'none'] as const;
export type Backend = (typeof BACKENDS)[number];
// A model id or a CLI alias (`opus`, `sonnet[1m]`). It is passed to the CLI as one argument, never through a shell.
export const MODEL_PATTERN = /^[a-z0-9][a-z0-9.\-[\]]{0,63}$/i;

// Where a field's value comes from: the environment the server was started with (it wins and locks the
// field), Settings, or the default.
const SourceSchema = z.enum(['env', 'settings', 'default']);
export type Source = z.infer<typeof SourceSchema>;
const field = <T extends z.ZodType>(value: T) => z.object({ value, source: SourceSchema, locked: z.boolean() });

export const SettingsViewSchema = z.object({
  backend: field(z.enum(BACKEND_CHOICES)),
  model: field(z.string().nullable()),       // null: the backend's own default
  effort: field(z.string()),                 // as the environment has it, which isn't checked
  directorEffort: field(z.string()),
  // The key is never sent: only whether there is one. `unreadable`: one is saved but can't be decrypted here.
  apiKey: z.object({ set: z.boolean(), source: SourceSchema, locked: z.boolean(), editable: z.boolean(), unreadable: z.boolean() }),
  detected: z.enum(BACKENDS),
  canWrite: z.boolean(),                     // only on the computer the server runs on
  options: z.object({
    backends: z.array(z.enum(BACKEND_CHOICES)).readonly(),
    efforts: z.array(z.string()).readonly(),
    apiModels: z.array(z.string()).readonly(),
    defaultModel: z.string(),
  }),
  // The environment variable behind each field, for the "set by …" note.
  env: z.object({ backend: z.string(), model: z.string(), effort: z.string(), directorEffort: z.string(), apiKey: z.string() }),
  paths: z.object({ claudeBin: z.string(), ytdlp: z.string() }),   // read-only: set in the environment only
});
export type SettingsView = z.infer<typeof SettingsViewSchema>;

export const SettingsPatchSchema = z.object({
  backend: z.enum(BACKEND_CHOICES).nullable().optional(),
  model: z.string().regex(MODEL_PATTERN).nullable().optional(),
  effort: z.enum(EFFORTS).nullable().optional(),
  directorEffort: z.enum(EFFORTS).nullable().optional(),
  apiKey: z.string().trim().regex(/^\S{20,400}$/, 'That doesn\'t look like an API key.').nullable().optional(),
}).strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

// The assistant panel's question: which backend, which model, and what to do when there is none.
export const AssistantInfoSchema = z.object({ backend: z.enum(BACKENDS), model: z.string().nullable().optional(), setup: z.string().optional() });
export type AssistantInfo = z.infer<typeof AssistantInfoSchema>;

export const ErrorBodySchema = z.object({ error: z.string() });
