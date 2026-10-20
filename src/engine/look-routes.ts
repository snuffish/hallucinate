// Look sliders that follow the music (ADR 0005). A route makes one slider follow one part of the music:
// it moves by `depth` (−1…1) of the slider's watchable span, through an envelope that rises over `attack`
// and falls over `release` seconds. The safety rules know the worst case, because it is capped: a followed
// slider never goes above the higher of its hand value and the top of its Randomize range, never rises
// faster than MIN_ATTACK, and Colour moves at most ±HUE_SPAN, no faster than HUE_MIN_ATTACK. Reactivity
// can't follow: it already scales the sound. STRONGEST_ROUTES is the worst case the strobe rule checks.

import { LOOK_RANGES } from '../state/app-state';
import { RANDOM_RANGES } from '../state/look-drift';
import type { Hearing } from './listener';
import type { FrameLook } from './look';
import { clamp, clamp01 } from './math';

export const ROUTE_SOURCES = ['bass', 'mid', 'high', 'level', 'kick', 'tone', 'mood'] as const;
export type RouteSource = (typeof ROUTE_SOURCES)[number];
export const ROUTE_TARGETS = ['speed', 'trails', 'hue', 'synesthesia', 'aberration'] as const;
export type RouteTarget = (typeof ROUTE_TARGETS)[number];
export interface Route { source: RouteSource; depth: number; attack: number; release: number }
export type Routes = Partial<Record<RouteTarget, Route>>;

export const MIN_ATTACK = 0.05;       // s: no followed slider rises faster
export const HUE_MIN_ATTACK = 0.15;   // s: nor Colour, so the colour never flickers
export const HUE_SPAN = 0.1;          // how far round the wheel Colour moves at depth 1
export const ROUTE_SECONDS = { min: MIN_ATTACK, max: 2, step: 0.01 } as const;   // attack and release
export const NEW_ROUTE: Route = { source: 'bass', depth: 0.5, attack: 0.1, release: 0.4 };

// What depth 1 moves a slider by: its whole Randomize range; Colour, ±HUE_SPAN of the wheel.
const routeSpan = (t: RouteTarget): number => (t === 'hue' ? HUE_SPAN : RANDOM_RANGES[t][1] - RANDOM_RANGES[t][0]);
const attackOf = (t: RouteTarget, r: Readonly<Route>): number => Math.max(t === 'hue' ? HUE_MIN_ATTACK : MIN_ATTACK, r.attack);
const releaseOf = (r: Readonly<Route>): number => Math.max(MIN_ATTACK, r.release);

// The music a route follows, 0–1: the bands as heard (not scaled by Reactivity), the kick's pulse, the
// tone and the mood.
function heard(h: Readonly<Hearing>, s: RouteSource): number {
  const v = s === 'kick' ? h.beat : s === 'tone' ? h.bright : h[s];
  return clamp01(v);
}

// Where a followed slider sits: its hand value moved by the envelope, inside its range and never above
// the higher of the hand value and the top of the Randomize range. Colour wraps round the wheel instead.
export function followed(t: RouteTarget, base: number, r: Readonly<Route>, env: number): number {
  const v = base + clamp(r.depth, -1, 1) * env * routeSpan(t);
  if (t === 'hue') return v;
  const top = Math.min(LOOK_RANGES[t].max, Math.max(base, RANDOM_RANGES[t][1]));
  return clamp(v, LOOK_RANGES[t].min, top);
}

// `look` with its routes applied, written into `out` (a reused object), the envelopes in `env` stepped
// by `dt`. Allocation-free. A target without a route keeps its hand value; its envelope rests.
export function followMusic(out: FrameLook, look: Readonly<FrameLook>, env: Float32Array, h: Readonly<Hearing>, dt: number): FrameLook {
  out.reactivity = look.reactivity; out.speed = look.speed; out.cycle = look.cycle; out.hue = look.hue;
  out.trails = look.trails; out.aberration = look.aberration; out.synesthesia = look.synesthesia;
  out.palette = look.palette;
  out.routes = undefined;
  const routes = look.routes;
  if (!routes) return out;
  for (let i = 0; i < ROUTE_TARGETS.length; i++) {
    const t = ROUTE_TARGETS[i]!, r = routes[t];
    if (!r) { env[i] = 0; continue; }
    const target = heard(h, r.source), e = env[i]!;
    const seconds = target > e ? attackOf(t, r) : releaseOf(r);
    env[i] = e + (target - e) * (1 - Math.exp(-dt / seconds));
    out[t] = followed(t, look[t], r, env[i]!);
  }
  return out;
}

// The worst case the strobe rule checks: every slider that can follow, at full depth on the kick, as fast
// as it may rise and fall.
export const STRONGEST_ROUTES: Readonly<Routes> = Object.fromEntries(ROUTE_TARGETS.map((t) => [t, { source: 'kick', depth: 1, attack: 0, release: 0 }]));
