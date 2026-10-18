// The main screen's background (the Background widget's), kept for the next start the way its effects
// are: under KEYS.screenBackground, not exported (show scenes carry their own background in an export).
// Read through the background's clean-up, so a damaged value loads as what it can still mean.

import { BackgroundSchema, NO_BACKGROUND, type Background } from '../engine/background';
import { KEYS, debouncedWriter, readJSON, type DebouncedWriter } from './persistence';

export const loadScreenBackground = (): Background => readJSON(KEYS.screenBackground, BackgroundSchema, NO_BACKGROUND);

// Slider drags coalesce into one write.
export const screenBackgroundWriter = (read: () => Background): DebouncedWriter => debouncedWriter(KEYS.screenBackground, read, 300);
