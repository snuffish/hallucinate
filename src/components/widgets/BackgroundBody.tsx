// The Background widget's body: the main screen's background (src/engine/background.ts). A menu for its
// kind, then the controls that kind uses: a colour, or two and an angle for a gradient, and Brightness and
// Breathe for every kind but none. Inputs are prefixed `bg-`: the Look's sliders already use bare ids.

import { useApp, useUI } from '../../app/AppContext';
import { BACKGROUND_KINDS, BACKGROUND_SETTINGS, hasBackground, type BackgroundKind, type BackgroundSetting } from '../../engine/background';

export function BackgroundBody() {
  const app = useApp();
  const bg = useUI((ui) => ui.background);
  const kind = BACKGROUND_KINDS.find((k) => k.id === bg.kind)!;
  const shown = BACKGROUND_SETTINGS.filter((s) => s.key !== 'angle' || bg.kind === 'gradient');
  return (
    <>
      <label>Kind
        <select id="bg-kind" value={bg.kind} title={kind.help} onChange={(e) => app.setBackgroundKind(e.target.value as BackgroundKind)}>
          {BACKGROUND_KINDS.map((k) => <option key={k.id} value={k.id} title={k.help}>{k.label}</option>)}
        </select>
      </label>
      {(bg.kind === 'colour' || bg.kind === 'gradient') && (
        <div className="bg-colours">
          <label>{bg.kind === 'gradient' ? 'From' : 'Colour'}
            <input type="color" id="bg-colour" value={bg.colour} onChange={(e) => app.setBackgroundColour('colour', e.target.value)} />
          </label>
          {bg.kind === 'gradient' && (
            <label>To
              <input type="color" id="bg-colour2" value={bg.colour2} onChange={(e) => app.setBackgroundColour('colour2', e.target.value)} />
            </label>
          )}
        </div>
      )}
      {hasBackground(bg) && shown.map((s) => <Setting key={s.key} setting={s} value={bg[s.key]} onChange={(v) => app.setBackgroundSetting(s.key, v)} />)}
    </>
  );
}

function Setting({ setting: s, value, onChange }: { setting: BackgroundSetting; value: number; onChange: (v: number) => void }) {
  return (
    <label>{s.label}
      <input type="range" id={`bg-${s.key}`} min={s.min} max={s.max} step={s.step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(s.default)} title="Double-click to reset" />
    </label>
  );
}
