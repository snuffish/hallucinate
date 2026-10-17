// The Effects widget's body: the main screen's effect stack, made from the catalogue (src/engine/effects.ts).
// An "Add effect" menu offering the effects not yet added, then one row per effect, in the order they run:
// its on/off checkbox, a remove button and its settings (a choice as a menu, a number as a slider). Inputs
// are prefixed `fx-<effect>-`: the Look's sliders already use bare ids such as #speed.

import { useApp, useUI } from '../../app/AppContext';
import { effectDef, effectsToAdd, type EffectEntry, type EffectId, type EffectSetting } from '../../engine/effects';

export function EffectsBody() {
  const app = useApp();
  const stack = useUI((ui) => ui.effects);
  const addable = effectsToAdd(stack);
  return (
    <>
      <select id="fx-add" aria-label="Add effect" value="" disabled={addable.length === 0}
        onChange={(e) => { if (e.target.value) app.addEffect(e.target.value as EffectId); }}>
        <option value="">{addable.length ? 'Add effect…' : 'Every effect is added'}</option>
        {addable.map((e) => <option key={e.id} value={e.id} title={e.help}>{e.label}</option>)}
      </select>
      {stack.length > 0 && <ol className="fx-stack">{stack.map((entry) => <EffectRow key={entry.id} entry={entry} />)}</ol>}
    </>
  );
}

function EffectRow({ entry }: { entry: EffectEntry }) {
  const app = useApp();
  const def = effectDef(entry.id);
  if (!def) return null;
  const id = `fx-${entry.id}`;
  return (
    <li className={`fx${entry.on ? '' : ' off'}`} data-effect={entry.id}>
      <div className="fx-head">
        <label className="toggle" title={`${def.help} ${def.music}`}>
          <input type="checkbox" id={`${id}-on`} checked={entry.on} onChange={(e) => app.setEffectOn(entry.id, e.target.checked)} /> {def.label}
        </label>
        <button className="icon fx-remove" aria-label={`Remove ${def.label}`} title={`Remove ${def.label}`} onClick={() => app.removeEffect(entry.id)}>×</button>
      </div>
      {def.settings.map((s) => <Setting key={s.key} id={`${id}-${s.key}`} setting={s} value={entry.settings[s.key] ?? s.default}
        onChange={(v) => app.setEffectSetting(entry.id, s.key, v)} />)}
    </li>
  );
}

function Setting({ id, setting: s, value, onChange }: { id: string; setting: EffectSetting; value: number; onChange: (v: number) => void }) {
  if (s.options) {
    return (
      <label>{s.label}
        <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
          {s.options.map((label, i) => <option key={label} value={s.min + i * s.step}>{label}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label>{s.label}
      <input type="range" id={id} min={s.min} max={s.max} step={s.step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(s.default)} title="Double-click to reset" />
    </label>
  );
}
