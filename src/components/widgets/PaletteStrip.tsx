// The Look's palette, under Colour (ADR 0004): the whole laser wheel, or 2–5 hues on it that every scene's
// colours walk instead. Pick a swatch and set its hue on the bar below; + adds a colour, × removes the
// picked one; Steps holds each colour and eases to the next instead of blending. Colour still shifts where
// the colours start along the palette, and Colour cycling walks it.

import { useState } from 'react';
import { useApp, useUI } from '../../app/AppContext';
import { laserCss } from '../../engine/laser-colour';
import { PALETTE_MAX } from '../../state/app-state';
import { FineRange } from './LookSlider';

const fract = (x: number) => x - Math.floor(x);

export function PaletteStrip() {
  const app = useApp();
  const { palette, hue } = useUI((ui) => ui.look);
  const [picked, setPicked] = useState(0);
  const { hues, steps } = palette;
  const on = hues.length > 0;
  const at = Math.min(picked, hues.length - 1);
  const set = (next: readonly number[], nextSteps = steps) => app.setPalette({ hues: next, steps: nextSteps });
  const add = () => {
    if (!on) { set([hue, fract(hue + 1 / 3)]); setPicked(1); return; }   // start from the colour on the Colour slider
    set([...hues, fract(hues.at(-1)! + 1 / 6)]);
    setPicked(hues.length);
  };
  return (
    <div className="palette" role="group" aria-label="Palette">
      <div className="palette-row">
        <button type="button" className={`palette-wheel${on ? '' : ' active'}`} aria-pressed={!on} title="Every scene's colours walk the whole laser wheel" onClick={() => set([])}>Wheel</button>
        {hues.map((h, i) => (
          <button key={i} type="button" className={`palette-swatch${i === at ? ' picked' : ''}`} style={{ background: laserCss(h) }}
            aria-pressed={i === at} aria-label={`Palette colour ${i + 1}: ${Math.round(h * 360)}°`} title="Pick it, then set its colour on the bar below"
            onClick={() => setPicked(i)} />
        ))}
        {hues.length < PALETTE_MAX && <button type="button" className="palette-add" aria-label="Add a colour to the palette" title={on ? 'Add a colour' : 'Make a palette: the colours walk only the ones you pick'} onClick={add}>+</button>}
        {on && <button type="button" className="palette-remove" aria-label="Remove the picked colour" title="Remove the picked colour (a palette keeps two; Wheel lets them all go)" disabled={hues.length <= 2}
          onClick={() => set(hues.filter((_, i) => i !== at))}>×</button>}
        {on && <button type="button" className={`palette-steps${steps ? ' active' : ''}`} aria-pressed={steps} title="Steps: hold each colour and ease to the next, instead of blending through the ones between" onClick={() => set(hues, !steps)}>Steps</button>}
      </div>
      {on && <FineRange id="palette-hue" label={`Palette colour ${at + 1}`} value={hues[at]!} r={{ min: 0, max: 1, step: 0.001 }} hue
        onSet={(v) => set(hues.map((h, i) => (i === at ? fract(Math.min(v, 0.999)) : h)))} />}
    </div>
  );
}
