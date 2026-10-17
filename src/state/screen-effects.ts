// The main screen's effects (the Effects widget's stack), kept for the next start the way the scene on
// screen is: under KEYS.screenEffects, not exported (show scenes carry their own effects in an export).
// Read through the catalogue's clean-up, so a damaged value loads as what it can still mean.

import { EffectStackSchema, NO_EFFECTS, type EffectStack } from '../engine/effects';
import { KEYS, debouncedWriter, readJSON, type DebouncedWriter } from './persistence';

export const loadScreenEffects = (): EffectStack => readJSON(KEYS.screenEffects, EffectStackSchema, NO_EFFECTS);

// Slider drags coalesce into one write.
export const screenEffectsWriter = (read: () => EffectStack): DebouncedWriter => debouncedWriter(KEYS.screenEffects, read, 300);
