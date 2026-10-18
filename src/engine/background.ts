// A show scene's background: what shows behind its lines instead of pure black (ADR 0004). None, a colour,
// a gradient between two colours, or the media (your image or video). It is drawn after the trails and
// before the Look, behind the lines (where a line is lit the background gives way), so the Look grades it
// with the picture and the trails never smear it. Effects don't reshape it.
//
// It stays dim and safe: at most BACKGROUND_MAX of full brightness on screen, faded to black towards the
// edges like the effects (EDGE_CLEAR … EDGE_FULL), so the border band stays as black as the scene keeps
// it (ADR 0002). It moves only with slow inputs: Breathe dims it in calm music (the mood) and turns a
// gradient with the music's clock. It never reads the bass or the kick, which jump on every hit, so a
// kick can't flash it. Everything that lists background settings is made from this file: the Background
// widget, the clean-up of a stored one, the renderer's background pass and the built-in scenes safety
// spec. Pure: the safety spec imports it in Node.

import { z } from 'zod';
import { EDGE_CLEAR, EDGE_FULL } from './effects';

export const BACKGROUND_KINDS = [
  { id: 'none', label: 'None', help: 'Pure black behind the lines, as the scene draws it.' },
  { id: 'colour', label: 'Colour', help: 'One colour behind the lines.' },
  { id: 'gradient', label: 'Gradient', help: 'A blend from one colour to another, across the picture at an angle.' },
  { id: 'media', label: 'Media', help: 'Your image or video behind the lines (drop one, or open it in the Media section).' },
] as const;
export type BackgroundKind = (typeof BACKGROUND_KINDS)[number]['id'];

// A background's numbers: their ranges, steps and defaults. Brightness is a share of BACKGROUND_MAX.
export interface BackgroundSetting { readonly key: 'angle' | 'brightness' | 'breathe'; readonly label: string; readonly min: number; readonly max: number; readonly step: number; readonly default: number }
export const BACKGROUND_SETTINGS = [
  { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, default: 90 },
  { key: 'brightness', label: 'Brightness', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'breathe', label: 'Breathe', min: 0, max: 1, step: 0.01, default: 0.5 },
] as const satisfies readonly BackgroundSetting[];
export type BackgroundSettingKey = (typeof BACKGROUND_SETTINGS)[number]['key'];

export interface Background {
  readonly kind: BackgroundKind;
  readonly colour: string;    // #rrggbb: the colour, or where the gradient starts
  readonly colour2: string;   // #rrggbb: where the gradient ends
  readonly angle: number;     // the gradient's direction, degrees
  readonly brightness: number;
  readonly breathe: number;   // how much it moves with the music: dims in calm music, turns a gradient
}

// The brightest a background gets on screen (after the display's tonemap), at Brightness 1, in
// energetic music: dim enough that every line stays clearly brighter than it.
export const BACKGROUND_MAX = 0.3;

export const NO_BACKGROUND: Background = Object.freeze({ kind: 'none', colour: '#1a2a80', colour2: '#80104a', angle: 90, brightness: 0.5, breathe: 0.5 });

const HEX = /^#[0-9a-f]{6}$/i;
const KINDS = new Set<string>(BACKGROUND_KINDS.map((k) => k.id));
const decimals = (step: number): number => (String(step).split('.')[1] ?? '').length;

// A setting's value as the background can take it: a number inside its range, on its step.
export function clampBackgroundSetting(s: BackgroundSetting, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return s.default;
  const v = Math.min(s.max, Math.max(s.min, value));
  return Math.min(s.max, Number((s.min + Math.round((v - s.min) / s.step) * s.step).toFixed(decimals(s.step))));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const cleanColour = (v: unknown, def: string): string => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : def);

// A stored background, cleaned up: an unknown kind reads as none, a colour that isn't #rrggbb as its
// default, each number clamped to its range and step. Never throws: a damaged show can't produce an
// unsafe picture.
export function cleanBackground(raw: unknown): Background {
  if (!isRecord(raw)) return NO_BACKGROUND;
  const settings = Object.fromEntries(BACKGROUND_SETTINGS.map((s) => [s.key, clampBackgroundSetting(s, raw[s.key])])) as Record<BackgroundSettingKey, number>;
  return {
    kind: typeof raw.kind === 'string' && KINDS.has(raw.kind) ? (raw.kind as BackgroundKind) : 'none',
    colour: cleanColour(raw.colour, NO_BACKGROUND.colour),
    colour2: cleanColour(raw.colour2, NO_BACKGROUND.colour2),
    ...settings,
  };
}

// A stored background (the main screen's, a show scene's) as zod reads it: anything, cleaned up, so it
// never fails the value it sits in; missing reads as none.
export const BackgroundSchema: z.ZodType<Background, unknown> = z.unknown().optional().transform(cleanBackground);

export const hasBackground = (b: Background): boolean => b.kind !== 'none';

// The edits the Background widget makes. Each returns a new background, or the same one when nothing
// changes (so a captured one never follows later edits).
export function setBackgroundKind(b: Background, kind: BackgroundKind): Background {
  return b.kind === kind || !KINDS.has(kind) ? b : { ...b, kind };
}

export function setBackgroundColour(b: Background, which: 'colour' | 'colour2', value: string): Background {
  const v = cleanColour(value, b[which]);
  return b[which] === v ? b : { ...b, [which]: v };
}

export function setBackgroundSetting(b: Background, key: BackgroundSettingKey, value: number): Background {
  const s = BACKGROUND_SETTINGS.find((x) => x.key === key);
  if (!s) return b;
  const v = clampBackgroundSetting(s, value);
  return b[key] === v ? b : { ...b, [key]: v };
}

// A background of `kind` at its brightest: white, full Brightness, no breathing (Breathe only ever dims).
// The built-in scenes safety spec checks each kind this way.
export const brightest = (kind: BackgroundKind): Background => ({ kind, colour: '#ffffff', colour2: '#ffffff', angle: 0, brightness: 1, breathe: 0 });

// The background pass's uniforms for one picture: [kind index, angle in radians, brightness, breathe]
// and its two colours, linear 0…1.
export interface BackgroundUniforms { params: [number, number, number, number]; colour: [number, number, number]; colour2: [number, number, number] }

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
const KIND_INDEX: Record<BackgroundKind, number> = { none: 0, colour: 1, gradient: 2, media: 3 };

export function backgroundUniforms(b: Background, to: BackgroundUniforms): BackgroundUniforms {
  to.params[0] = KIND_INDEX[b.kind]; to.params[1] = (b.angle * Math.PI) / 180; to.params[2] = b.brightness; to.params[3] = b.breathe;
  const [r, g, bl] = rgb(b.colour), [r2, g2, b2] = rgb(b.colour2);
  to.colour[0] = r; to.colour[1] = g; to.colour[2] = bl;
  to.colour2[0] = r2; to.colour2[1] = g2; to.colour2[2] = b2;
  return to;
}

const glslFloat = (x: number): string => (Number.isInteger(x) ? `${x}.` : String(x));

// The background pass: the trails (uTex, lines on black) with each picture's background behind them,
// crossfading from the outgoing one (B) to the incoming one (A) by uMix. Where a line is lit the
// background gives way, so a line keeps its colour. The background is aimed at what the display shows
// (it undoes the tonemap, as untone() does in a scene), so Brightness 1 shows at BACKGROUND_MAX.
export const BACKGROUND_SHADER = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex, uMedia;
uniform vec2 uRes, uMediaSize;
uniform float uHasMedia, uMix, uTime, uMood;
uniform vec4 uBgA, uBgB;           // per picture: kind (0 none, 1 colour, 2 gradient, 3 media), angle, brightness, breathe
uniform vec3 uColA, uColA2, uColB, uColB2;

vec3 untone(vec3 c) { return -log(1. - clamp(c, 0., .985)) / 1.3; }

// The media covering the picture (cropped, never stretched); black until there is any.
vec3 mediaCover() {
  if (uHasMedia < .5) return vec3(0.);
  float screen = uRes.x / uRes.y, aspect = uMediaSize.x / max(uMediaSize.y, 1.);
  vec2 uv = vUv - .5;
  if (aspect > screen) uv.x *= screen / aspect; else uv.y *= aspect / screen;
  return texture(uMedia, uv + .5).rgb;   // uploaded flipped, so its rows run bottom-up like the picture's
}

vec3 background(vec4 bg, vec3 col, vec3 col2) {
  float kind = floor(bg.x + .5);
  if (kind < .5) return vec3(0.);
  vec3 c = col;
  if (kind > 2.5) c = mediaCover();
  else if (kind > 1.5) {
    // Breathe turns the gradient slowly with the music's clock.
    float a = bg.y + uTime * .05 * bg.w;
    vec2 p = (vUv - .5) * uRes / min(uRes.x, uRes.y);
    c = mix(col, col2, smoothstep(-.6, .6, dot(p, vec2(cos(a), sin(a)))));
  }
  // Breathe dims it in calm music (the mood changes over seconds, never on a kick).
  float level = ${glslFloat(BACKGROUND_MAX)} * bg.z * (1. - bg.w * .5 * (1. - clamp(uMood, 0., 1.)));
  return untone(c * level);
}

void main() {
  vec3 lines = texture(uTex, vUv).rgb;
  vec3 bg = uMix >= 1. ? background(uBgA, uColA, uColA2) : mix(background(uBgB, uColB, uColB2), background(uBgA, uColA, uColA2), uMix);
  // The edge fade: none of it within EDGE_CLEAR of an edge, all of it from EDGE_FULL in.
  vec2 px = min(vUv, 1. - vUv) * uRes;
  bg *= smoothstep(${glslFloat(EDGE_CLEAR)}, ${glslFloat(EDGE_FULL)}, min(px.x, px.y) / min(uRes.x, uRes.y));
  fragColor = vec4(lines + bg * (1. - clamp(max(lines.r, max(lines.g, lines.b)), 0., 1.)), 1.);
}
`;
