// Settings → Assistant: which way the server reaches Claude, the model and effort, and (in the desktop
// app) an API key. They live on the server (server/config.ts, /api/settings): an environment variable
// the server was started with wins and locks its field here; the key is sent once and never comes back.

import { useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { useApp } from '../app/AppContext';
import { STATIC_DEMO, STATIC_DEMO_NOTE } from '../app/static-demo';

const Source = z.enum(['env', 'settings', 'default']);
const field = <T extends z.ZodType>(value: T) => z.object({ value, source: Source, locked: z.boolean() });
const ViewSchema = z.object({
  backend: field(z.enum(['auto', 'api', 'claude-code'])),
  model: field(z.string().nullable()),
  effort: field(z.string()),
  directorEffort: field(z.string()),
  apiKey: z.object({ set: z.boolean(), source: Source, locked: z.boolean(), editable: z.boolean(), unreadable: z.boolean() }),
  detected: z.enum(['api', 'claude-code', 'none']),
  canWrite: z.boolean(),
  options: z.object({ efforts: z.array(z.string()), apiModels: z.array(z.string()), defaultModel: z.string() }),
  env: z.record(z.string(), z.string()),
  paths: z.object({ claudeBin: z.string(), ytdlp: z.string() }),
});
type View = z.infer<typeof ViewSchema>;
type Patch = Partial<Record<'backend' | 'model' | 'effort' | 'directorEffort' | 'apiKey', string | null>>;

const DETECTED = { 'api': 'the Anthropic API', 'claude-code': 'your Claude subscription (Claude Code)', 'none': 'nothing yet: Claude isn\'t set up' } as const;
const BACKENDS = { 'auto': 'Automatic: an API key if there is one, else Claude Code', 'api': 'Anthropic API key', 'claude-code': 'Claude subscription (Claude Code)' } as const;

async function request(init?: RequestInit): Promise<View> {
  const res = await fetch('/api/settings', init);
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `The server answered ${res.status}.`);
  return ViewSchema.parse(json);
}

export function AssistantSettings() {
  const app = useApp();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');

  useEffect(() => {
    if (STATIC_DEMO) return;
    request().then((v) => { setView(v); setModel(v.model.value ?? ''); }, (err: Error) => setError(err.message));
  }, []);

  if (STATIC_DEMO) return <><h3>Assistant</h3><p className="settings-note">{STATIC_DEMO_NOTE}</p></>;
  if (!view) return <><h3>Assistant</h3><p className={`settings-note${error ? ' error' : ''}`}>{error || 'Asking the server…'}</p></>;

  const save = async (patch: Patch) => {
    setBusy(true);
    setError('');
    try {
      const next = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      setView(next);
      setModel(next.model.value ?? '');
      if ('apiKey' in patch) setKey('');
      app.assistantConfigChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const off = (f: { locked: boolean }) => busy || f.locked || !view.canWrite;
  const lockedNote = (id: keyof View['env'], f: { locked: boolean }) => (f.locked ? <> Set by <code>{view.env[id]}</code> in the environment Hallucinate was started with, which wins.</> : null);
  const onApi = view.backend.value === 'api' || (view.backend.value === 'auto' && view.detected === 'api');

  return (
    <>
      <h3>Assistant</h3>
      <p className="settings-note" id="settings-detected">Hallucinate reaches Claude through <strong>{DETECTED[view.detected]}</strong>. Changes apply to the next reply.</p>
      {!view.canWrite && <p className="settings-note error">These can only be changed on the computer Hallucinate runs on.</p>}

      <Row label="Connection" note={lockedNote('backend', view.backend)}>
        <select id="ai-backend" value={view.backend.value} disabled={off(view.backend)} onChange={(e) => void save({ backend: e.target.value === 'auto' ? null : e.target.value })}>
          {(Object.keys(BACKENDS) as (keyof typeof BACKENDS)[]).map((b) => <option key={b} value={b}>{BACKENDS[b]}</option>)}
        </select>
      </Row>

      <Row label="Model" note={lockedNote('model', view.model) ?? (onApi
        ? `Empty: ${view.options.defaultModel}.`
        : 'Empty: Claude Code\'s default. Aliases like opus or sonnet work too.')}>
        <form className="settings-inline" onSubmit={(e) => { e.preventDefault(); void save({ model: model.trim() || null }); }}>
          <input type="text" id="ai-model" list="ai-models" value={model} placeholder={onApi ? view.options.defaultModel : 'default'} disabled={off(view.model)}
            spellCheck={false} autoComplete="off" onChange={(e) => setModel(e.target.value)} />
          <datalist id="ai-models">{view.options.apiModels.map((m) => <option key={m} value={m} />)}</datalist>
          <button type="submit" disabled={off(view.model) || model.trim() === (view.model.value ?? '')}>Save</button>
        </form>
      </Row>

      <Row label="Effort" note={lockedNote('effort', view.effort) ?? 'Lower is faster and uses fewer tokens.'}>
        <EffortSelect id="ai-effort" value={view.effort} efforts={view.options.efforts} disabled={off(view.effort)} onChange={(v) => void save({ effort: v })} />
      </Row>
      <Row label="Director effort" note={lockedNote('directorEffort', view.directorEffort) ?? 'For the studio Director\'s planning cycles. Unset: the same as Effort.'}>
        <EffortSelect id="ai-director-effort" value={view.directorEffort} efforts={view.options.efforts} disabled={off(view.directorEffort)} onChange={(v) => void save({ directorEffort: v })} />
      </Row>

      <h4>API key</h4>
      {view.apiKey.locked
        ? <p className="settings-note" id="ai-key-status">Set by <code>{view.env.apiKey}</code> in the environment Hallucinate was started with.</p>
        : view.apiKey.set
          ? (
            <div className="settings-inline">
              <span id="ai-key-status">Saved, encrypted on this computer.</span>
              <button id="ai-key-remove" disabled={busy || !view.canWrite} onClick={() => void save({ apiKey: null })}>Remove</button>
            </div>
          )
          : view.apiKey.editable
            ? (
              <form className="settings-inline" onSubmit={(e) => { e.preventDefault(); if (key.trim()) void save({ apiKey: key.trim() }); }}>
                <input type="password" id="ai-key" value={key} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} onChange={(e) => setKey(e.target.value)} />
                <button type="submit" disabled={busy || !key.trim()}>Save</button>
              </form>
            )
            : <p className="settings-note" id="ai-key-status">Export <code>ANTHROPIC_API_KEY</code> before starting Hallucinate. The desktop app can also keep a key here, encrypted with your system's keychain.</p>}
      {view.apiKey.unreadable && <p className="settings-note error">A saved key can't be read on this computer. Save it again, or remove it.</p>}
      {view.apiKey.editable && !view.apiKey.set && <p className="settings-note">Billed to your Anthropic account. It is stored encrypted and never shown again.</p>}

      {error && <p className="settings-note error" role="alert">{error}</p>}

      <h4>Programs</h4>
      <dl className="settings-facts">
        <dt>Claude Code</dt><dd><code>{view.paths.claudeBin}</code></dd>
        <dt>yt-dlp</dt><dd><code>{view.paths.ytdlp}</code></dd>
      </dl>
      <p className="settings-note">Set with <code>CLAUDE_BIN</code> and <code>YTDLP</code> in the environment, never from here: the server runs them.</p>
    </>
  );
}

function Row({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-field">
      <span className="settings-label">{label}</span>
      {children}
      {note && <small>{note}</small>}
    </div>
  );
}

function EffortSelect({ id, value, efforts, disabled, onChange }: { id: string; value: { value: string; source: string }; efforts: string[]; disabled: boolean; onChange: (v: string | null) => void }) {
  const current = value.source === 'default' ? '' : value.value;
  return (
    <select id={id} value={current} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{value.source === 'default' ? `Default (${value.value})` : 'Default'}</option>
      {efforts.map((e) => <option key={e} value={e}>{e}</option>)}
      {current && !efforts.includes(current) && <option value={current}>{current}</option>}
    </select>
  );
}
