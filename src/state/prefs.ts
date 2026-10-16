// Device preferences: how this computer renders, listens and shows the controls. Set in the Settings
// overlay, stored under KEYS.prefs and deliberately left out of the export (they describe this
// machine; a setup moved to a projector laptop shouldn't carry them).
//
// A preference is a default that seeds live state, never a second control for it: Start resolution
// sets the Look's Resolution when the app starts; the slider stays the live control.

import { z } from 'zod';
import type { OutputPrefs } from '../engine/output-link';
import { KEYS, readFlag, readJSON, writeFlag } from './persistence';
import { Store, useStore } from './store';

export const PIXEL_RATIOS = [1, 1.5, 2] as const;
export const IDLE_SECONDS = [3, 5, 10, 30] as const;

// Every field falls back on its own (`.catch`), so one bad value doesn't reset the others.
export const PrefsSchema = z.object({
  v: z.literal(1),
  startResolution: z.number().min(0.3).max(1).catch(0.75),
  maxPixelRatio: z.literal(PIXEL_RATIOS).catch(2),
  audioSmoothing: z.number().min(0).max(0.95).catch(0.6),
  micEchoCancellation: z.boolean().catch(false),
  micNoiseSuppression: z.boolean().catch(false),
  micAutoGain: z.boolean().catch(false),
  idleHideSeconds: z.literal(IDLE_SECONDS).nullable().catch(3),   // null: the controls never fade
  showKeyBadges: z.boolean().catch(true),
});
export type Prefs = z.infer<typeof PrefsSchema>;
export type PrefKey = Exclude<keyof Prefs, 'v'>;

export const DEFAULT_PREFS: Prefs = PrefsSchema.parse({ v: 1 });

export const loadPrefs = (): Prefs => readJSON(KEYS.prefs, PrefsSchema, DEFAULT_PREFS);

// When a change takes effect, so the Settings overlay can say so. `all-renderers`: the main canvas,
// the studio's Preview monitor and every projector window (sent over the output link).
export type Applies = 'startup' | 'live' | 'next-mic' | 'all-renderers';
export const APPLIES: Record<PrefKey, Applies> = {
  startResolution: 'startup',
  maxPixelRatio: 'all-renderers',
  audioSmoothing: 'live',
  micEchoCancellation: 'next-mic',
  micNoiseSuppression: 'next-mic',
  micAutoGain: 'next-mic',
  idleHideSeconds: 'live',
  showKeyBadges: 'live',
};

// What projector windows get (src/output.ts): every `all-renderers` preference, and only those.
export const outputPrefs = (p: Prefs): OutputPrefs => ({ maxPixelRatio: p.maxPixelRatio });

export const micConstraints = (p: Prefs): MediaTrackConstraints => ({
  echoCancellation: p.micEchoCancellation, noiseSuppression: p.micNoiseSuppression, autoGainControl: p.micAutoGain,
});

// The assistant panel's "Show reasoning" toggle, shared by the panel and Settings. Its own key, as
// before (a UI convenience, not exported).
const thinking = new Store({ on: readFlag(KEYS.assistantThinking) });
export const useShowThinking = (): boolean => useStore(thinking, (s) => s.on);
export function setShowThinking(on: boolean): void {
  thinking.set({ on });
  writeFlag(KEYS.assistantThinking, on);
}
