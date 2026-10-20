// An XY pad: two Look sliders on one surface, one across and one up, picked per pad. A press jumps the
// puck there, then the drag is relative: Shift is ten times finer. The wheel steps the one going up (Shift:
// one step), the arrow keys step either, double-click resets both. A pad on Colour shows the laser wheel
// along that axis, and its puck is the colour on screen.

import { useRef, type CSSProperties } from 'react';
import { useApp, useUI } from '../../app/AppContext';
import { LASER_GRADIENT, laserCss } from '../../engine/laser-colour';
import { LOOK_RANGES, SLIDER_KEYS, defaultLook, type SliderKey, type XYAxes } from '../../state/app-state';
import { FINE, LOOK_DISPLAY, clampTo, useWheelStep } from './LookSlider';

const INSET = 7;   // px: the puck's radius, so it stays whole at the pad's edges

const fraction = (k: SliderKey, v: number) => (v - LOOK_RANGES[k].min) / (LOOK_RANGES[k].max - LOOK_RANGES[k].min);

function background(axes: XYAxes): string | undefined {
  if (axes.x === 'hue') return `linear-gradient(0deg, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0.25)), ${LASER_GRADIENT('90deg')}`;
  if (axes.y === 'hue') return `linear-gradient(90deg, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0.25)), ${LASER_GRADIENT('0deg')}`;
  return undefined;
}

export function XYPad({ index, axes }: { index: number; axes: XYAxes }) {
  const app = useApp();
  const look = useUI((ui) => ui.look);
  const liveHue = useUI((ui) => ui.liveHue);
  const { x, y } = axes;
  const rx = LOOK_RANGES[x], ry = LOOK_RANGES[y];
  const drag = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  const set = (k: SliderKey, v: number) => app.setLook(k, clampTo(v, LOOK_RANGES[k].min, LOOK_RANGES[k].max));
  const pad = useWheelStep<HTMLDivElement>((by) => set(y, look[y] + by * ry.step));
  const tx = fraction(x, look[x]), ty = fraction(y, look[y]);
  const name = `XY pad ${index + 1}`;
  const across = LOOK_DISPLAY[x].label, up = LOOK_DISPLAY[y].label;

  const pick = (which: 'x' | 'y', k: SliderKey) => {
    const other = which === 'x' ? y : x;
    const swapped = k === other ? (which === 'x' ? x : y) : other;   // picking the other axis's slider swaps them
    app.setXYAxes(index, which === 'x' ? { x: k, y: swapped } : { x: swapped, y: k });
  };
  const axisPicker = (which: 'x' | 'y') => (
    <select aria-label={`${name} ${which === 'x' ? 'across' : 'up'}`} value={which === 'x' ? x : y} onChange={(e) => pick(which, e.target.value as SliderKey)}>
      {SLIDER_KEYS.map((k) => <option key={k} value={k}>{LOOK_DISPLAY[k].label}</option>)}
    </select>
  );
  const hue = x === 'hue' || y === 'hue';
  const puck: CSSProperties = {
    left: `calc(${INSET}px + ${tx} * (100% - ${2 * INSET}px))`,
    bottom: `calc(${INSET}px + ${ty} * (100% - ${2 * INSET}px))`,
    ...(hue && { background: laserCss(liveHue), boxShadow: `0 0 12px ${laserCss(liveHue)}` }),
  };

  return (
    <div className="xy">
      <div className="xy-axes"><span aria-hidden="true">↕</span>{axisPicker('y')}<span aria-hidden="true">↔</span>{axisPicker('x')}</div>
      <div ref={pad} className="xy-pad" data-own-press role="group" tabIndex={0} aria-label={`${name}: ${across} across, ${up} up`}
        title="Drag to set both · Shift-drag: finer · wheel steps ↕ · arrow keys step · double-click resets both"
        style={{ background: background(axes) }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          let vx = look[x], vy = look[y];
          if (!e.shiftKey) {
            const b = e.currentTarget.getBoundingClientRect();
            vx = rx.min + clampTo((e.clientX - b.left - INSET) / (b.width - 2 * INSET), 0, 1) * (rx.max - rx.min);
            vy = ry.min + clampTo(1 - (e.clientY - b.top - INSET) / (b.height - 2 * INSET), 0, 1) * (ry.max - ry.min);
            set(x, vx); set(y, vy);
          }
          drag.current = { px: e.clientX, py: e.clientY, vx, vy };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const b = e.currentTarget.getBoundingClientRect(), f = e.shiftKey ? FINE : 1;
          d.vx = clampTo(d.vx + ((e.clientX - d.px) / (b.width - 2 * INSET)) * (rx.max - rx.min) * f, rx.min, rx.max);
          d.vy = clampTo(d.vy - ((e.clientY - d.py) / (b.height - 2 * INSET)) * (ry.max - ry.min) * f, ry.min, ry.max);
          d.px = e.clientX; d.py = e.clientY;
          set(x, d.vx); set(y, d.vy);
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={() => { set(x, defaultLook()[x]); set(y, defaultLook()[y]); }}
        onKeyDown={(e) => {
          const k = e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? x : e.key === 'ArrowUp' || e.key === 'ArrowDown' ? y : null;
          if (!k) return;
          e.preventDefault(); e.stopPropagation();
          const by = (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 10);
          set(k, look[k] + by * LOOK_RANGES[k].step);
        }}>
        <i className="xy-line across" style={{ bottom: puck.bottom }} />
        <i className="xy-line up" style={{ left: puck.left }} />
        <i className="xy-puck" style={puck} />
      </div>
    </div>
  );
}
