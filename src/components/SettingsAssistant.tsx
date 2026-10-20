// Settings → Assistant: which way the server reaches Claude, the model and effort, and (in the desktop
// app) an API key. They live on the server (server/config.ts, /api/settings): an environment variable
// the server was started with wins and locks its field here; the key is sent once and never comes back.
// What the server answers and takes is declared in src/assistant/settings-wire.ts.

import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../app/AppContext';
import { STATIC_DEMO, STATIC_DEMO_NOTE } from '../app/static-demo';
import { postJSON } from '../app/http';
import { ErrorBodySchema, SETTINGS_URL, SettingsViewSchema, type Backend, type BackendChoice, type Effort, type SettingsPatch, type SettingsView as View } from '../assistant/settings-wire';

const DETECTED: Record<Backend, string> = { 'api': 'the Anthropic API', 'claude-code': 'your Claude subscription (Claude Code)', 'none': 'nothing yet: Claude isn\'t set up' };
const BACKENDS: Record<BackendChoice, string> = { 'auto': 'Automatic: an API key if there is one, else Claude Code', 'api': 'Anthropic API key', 'claude-code': 'Claude subscription (Claude Code)' };

async function request(patch?: SettingsPatch): Promise<View> {
  const res = await (patch ? postJSON(SETTINGS_URL, patch) : fetch(SETTINGS_URL));
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = ErrorBodySchema.safeParse(json);
    throw new Error(e.success ? e.data.error : `The server answered ${res.status}.`);
  }
  return SettingsViewSchema.parse(json);
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

  const save = async (patch: SettingsPatch) => {
    setBusy(true);
    setError('');
    try {
      const next = await request(patch);
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
        <select id="ai-backend" value={view.backend.value} disabled={off(view.backend)} onChange={(e) => void save({ backend: e.target.value === 'auto' ? null : e.target.value as BackendChoice })}>
          {(Object.keys(BACKENDS) as BackendChoice[]).map((b) => <option key={b} value={b}>{BACKENDS[b]}</option>)}
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

function EffortSelect({ id, value, efforts, disabled, onChange }: { id: string; value: { value: string; source: string }; efforts: readonly string[]; disabled: boolean; onChange: (v: Effort | null) => void }) {
  const current = value.source === 'default' ? '' : value.value;
  return (
    <select id={id} value={current} disabled={disabled} onChange={(e) => onChange((e.target.value || null) as Effort | null)}>
      <option value="">{value.source === 'default' ? `Default (${value.value})` : 'Default'}</option>
      {efforts.map((e) => <option key={e} value={e}>{e}</option>)}
      {current && !efforts.includes(current) && <option value={current}>{current}</option>}
    </select>
  );
}
