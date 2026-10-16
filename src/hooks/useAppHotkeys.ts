// Registers the shortcuts from the registry with TanStack Hotkeys. Every binding has one owner: the
// app (App.tsx) or a panel (the library, the visual maker, the assistant), which registers it with its
// action through useHotkeyActions. The actions are a map typed by binding, so a binding without one
// doesn't compile. Overlays and the game take some keys over, the visual maker takes them all;
// `isEnabled` in the registry decides which is live, for every registration.

import { useHotkeys, type UseHotkeyDefinition } from '@tanstack/react-hotkeys';
import { useApp, useUI } from '../app/AppContext';
import { CUE_DIGITS, CUE_DIGITS_WHEN, HOTKEYS, isEnabled, SCENE_DIGITS, SCENE_DIGITS_WHEN, type HotkeyActions, type HotkeyContext, type HotkeyDef, type HotkeyIdOf, type HotkeyOwner } from '../hotkeys/registry';

function useHotkeyContext(): HotkeyContext {
  const app = useApp();
  const overlay = useUI((ui) => ui.overlay);
  const assistantOpen = useUI((ui) => ui.assistantOpen);
  const helpOpen = useUI((ui) => ui.help !== null);
  const paramsVisible = useUI((ui) => ui.paramsVisible);
  const sceneIndex = useUI((ui) => ui.sceneIndex);
  return { overlay, inGame: sceneIndex === app.state.gameIndex, assistantOpen, helpOpen, paramsVisible };
}

// After a shortcut, hand the keyboard back from any focused control (the old handler blurred too).
const binding = (def: HotkeyDef, fn: () => void, context: HotkeyContext): UseHotkeyDefinition => ({
  hotkey: def.keys,
  callback: (event) => {
    fn();
    if (event.target instanceof HTMLInputElement && !def.inInputs) event.target.blur();
  },
  options: { enabled: isEnabled(def.when, context), preventDefault: true, ...(def.inInputs && { ignoreInputs: false }), meta: { name: def.label, group: def.group } },
});

// Several actions share a key (← is scene / steer / cue / library hit) and exactly one is enabled at a
// time, so only the enabled ones are registered. Conflicts are allowed: when a panel takes a key over
// (opening the library takes ←), its registration runs before the app's (a child's effects run first),
// so both are registered until the app's effect drops its own, within the same commit. The registry
// test is what proves no two bindings are ever live together.
function useBindings(defs: UseHotkeyDefinition[]): void {
  useHotkeys(defs.filter((d) => d.options?.enabled !== false), { conflictBehavior: 'allow' });
}

// An owner's bindings with their actions: `useHotkeyActions<'library'>({ librarySearch: …, … })`.
export function useHotkeyActions<O extends HotkeyOwner>(actions: HotkeyActions<O>): void {
  const context = useHotkeyContext();
  useBindings((Object.keys(actions) as HotkeyIdOf<O>[]).map((id) => binding(HOTKEYS[id], actions[id], context)));
}

// The app's bindings, plus the number keys: 1–9, 0 pick scenes; inside the studio 1–9 pick cues.
export function useAppHotkeys(actions: HotkeyActions<'app'>, digits: { pickScene(n: number): void; studioCue(n: number): void }): void {
  const context = useHotkeyContext();
  const digit = (key: string, when: HotkeyDef['when'], name: string, group: HotkeyDef['group'], fn: () => void): UseHotkeyDefinition => ({
    hotkey: key as UseHotkeyDefinition['hotkey'], callback: fn, options: { enabled: isEnabled(when, context), preventDefault: true, meta: { name, group } },
  });
  useBindings([
    ...(Object.keys(actions) as HotkeyIdOf<'app'>[]).map((id) => binding(HOTKEYS[id], actions[id], context)),
    ...SCENE_DIGITS.map((d, n) => digit(d, SCENE_DIGITS_WHEN, `Scene ${d}`, 'Scenes', () => digits.pickScene(n))),
    ...CUE_DIGITS.map((d, n) => digit(d, CUE_DIGITS_WHEN, `Cue ${d}`, 'Studio', () => digits.studioCue(n))),
  ]);
}
