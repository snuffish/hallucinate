// A Look slider following the music (ADR 0005): the ♪ button on its row, and the row under it that sets
// what it follows, how far (Depth, either way) and how fast it rises and falls back (Attack, Release).
// The caps (never above the higher of the hand value and the top of its Randomize range, never faster than
// the minimum attack) are the engine's: src/engine/look-routes.ts.

import { useApp } from '../../app/AppContext';
import { HUE_MIN_ATTACK, MIN_ATTACK, NEW_ROUTE, ROUTE_SECONDS, ROUTE_SOURCES, type Route, type RouteSource, type RouteTarget } from '../../engine/look-routes';
import { FineRange, LOOK_DISPLAY, NumberField } from './LookSlider';

const SOURCE_LABEL: Record<RouteSource, string> = { bass: 'Bass', mid: 'Mids', high: 'Highs', level: 'Level', kick: 'Kick', tone: 'Tone', mood: 'Mood' };
const DEPTH = { label: 'Depth', scale: 100, unit: '%', digits: 0 };
const ATTACK = { label: 'Attack', scale: 1000, unit: 'ms', digits: 0 };
const RELEASE = { label: 'Release', scale: 1000, unit: 'ms', digits: 0 };

export function FollowButton({ target, route, open, onToggle }: { target: RouteTarget; route: Route | undefined; open: boolean; onToggle: () => void }) {
  const label = LOOK_DISPLAY[target].label;
  return (
    <button type="button" className={`look-follow${route ? ' on' : ''}`} aria-expanded={open} aria-label={`${label} follows the music`}
      title={route ? `${label} follows the ${SOURCE_LABEL[route.source].toLowerCase()}: set how` : `Make ${label} follow the music`}
      onClick={(e) => { e.preventDefault(); onToggle(); }}>♪</button>
  );
}

export function FollowEditor({ target, route }: { target: RouteTarget; route: Route | undefined }) {
  const app = useApp();
  const label = LOOK_DISPLAY[target].label;
  const r = route ?? NEW_ROUTE;
  const set = (change: Partial<Route>) => app.setRoute(target, { ...r, ...change });
  const minAttack = target === 'hue' ? HUE_MIN_ATTACK : MIN_ATTACK;
  return (
    <div className="look-follow-edit" role="group" aria-label={`How ${label} follows the music`}>
      <div className="look-follow-head">
        <select aria-label={`What ${label} follows`} value={route?.source ?? ''} onChange={(e) => (e.target.value ? set({ source: e.target.value as RouteSource }) : app.setRoute(target, null))}>
          <option value="">Not the music</option>
          {ROUTE_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
        </select>
        {route && <button type="button" onClick={() => app.setRoute(target, null)}>Stop</button>}
      </div>
      {route && (
        <>
          <div className="look-row" title={`How far ${label} moves with it, up or (below 0) down; never above the higher of where you set it and the top of the Randomize range`}>
            <span /><label htmlFor={`follow-${target}-depth`}>Depth</label>
            <FineRange id={`follow-${target}-depth`} label={`${label} depth`} value={r.depth} r={{ min: -1, max: 1, step: 0.01 }} onSet={(v) => set({ depth: v })} onReset={() => set({ depth: NEW_ROUTE.depth })} />
            <NumberField d={{ ...DEPTH, label: `${label} depth` }} value={r.depth} onSet={(v) => set({ depth: Math.min(1, Math.max(-1, v)) })} />
          </div>
          <div className="look-row" title={`How fast it rises (at least ${minAttack * 1000} ms)`}>
            <span /><label htmlFor={`follow-${target}-attack`}>Attack</label>
            <FineRange id={`follow-${target}-attack`} label={`${label} attack`} value={r.attack} r={{ ...ROUTE_SECONDS, min: minAttack }} onSet={(v) => set({ attack: v })} onReset={() => set({ attack: Math.max(minAttack, NEW_ROUTE.attack) })} />
            <NumberField d={{ ...ATTACK, label: `${label} attack` }} value={r.attack} onSet={(v) => set({ attack: Math.min(ROUTE_SECONDS.max, Math.max(minAttack, v)) })} />
          </div>
          <div className="look-row" title="How fast it falls back">
            <span /><label htmlFor={`follow-${target}-release`}>Release</label>
            <FineRange id={`follow-${target}-release`} label={`${label} release`} value={r.release} r={ROUTE_SECONDS} onSet={(v) => set({ release: v })} onReset={() => set({ release: NEW_ROUTE.release })} />
            <NumberField d={{ ...RELEASE, label: `${label} release` }} value={r.release} onSet={(v) => set({ release: Math.min(ROUTE_SECONDS.max, Math.max(ROUTE_SECONDS.min, v)) })} />
          </div>
        </>
      )}
    </div>
  );
}
