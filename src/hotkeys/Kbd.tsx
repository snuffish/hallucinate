// A key badge for anything that has a shortcut. Formats platform-aware (⌘ on a Mac) and lights up
// while the shortcut's modifiers are held, so the user can see what a key will do before pressing it.

import { formatForDisplay, useHotkeyHint, type Hotkey } from '@tanstack/react-hotkeys';
import type { HotkeyDef } from './registry';

const LABELS: Record<string, string> = { Space: '␣', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Enter: '↵' };

// `hotkey`: a registry entry, or a bare key for things like scene number keys.
export function Kbd({ hotkey, title }: { hotkey: HotkeyDef | Hotkey; title?: string }) {
  const def = typeof hotkey === 'string' ? null : hotkey;
  const keys: Hotkey = def ? def.keys : (hotkey as Hotkey);
  const hinted = useHotkeyHint(keys);
  return (
    <kbd className="kbd" data-hint={hinted || undefined} title={def?.label ?? title} aria-hidden="true">
      {formatForDisplay(keys, { keyLabels: LABELS })}
    </kbd>
  );
}
