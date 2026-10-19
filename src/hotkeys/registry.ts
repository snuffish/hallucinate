import type { Hotkey } from '@tanstack/react-hotkeys';
import type { Overlay } from '../state/ui-state';

// Every keyboard shortcut in the app, in one place: the hooks register them, the badges display them
// and the help sheet lists them. `when` says under which UI state a binding is live (`isEnabled`).

export type HotkeyWhen =
  | 'always'
  | 'noOverlay'      // no overlay open (the code editor excepted: it follows the scene)
  | 'noNodes'        // everything except while the visual maker is open
  | 'studio'
  | 'notStudio'
  | 'nodesOpen'
  | 'paramsVisible'
  | 'overlayOpen'
  | 'assistantOpen'  // the assistant's panel is open (its own shortcuts, registered by the panel)
  | 'library'        // the scene library is open
  | 'noLibrary';     // not the library, not the visual maker

export interface HotkeyDef {
  id: string;
  keys: Hotkey;               // TanStack Hotkeys syntax, e.g. 'Shift+ArrowLeft'
  label: string;
  group: 'Playback' | 'Scenes' | 'Panels' | 'Studio' | 'Look';
  when: HotkeyWhen;
  // Fires even while a text field has focus (Escape and the like).
  inInputs?: boolean;
  // The panel that registers it with its action (useHotkeyActions); the app's own when absent.
  owner?: PanelOwner;
}

type PanelOwner = 'library' | 'nodes' | 'assistant';
export type HotkeyOwner = 'app' | PanelOwner;

export const HOTKEYS = {
  playPause: { id: 'playPause', keys: 'Space', label: 'Play / pause', group: 'Playback', when: 'noNodes' },
  seekBack: { id: 'seekBack', keys: 'Shift+ArrowLeft', label: 'Seek −10 s', group: 'Playback', when: 'noNodes' },
  seekFwd: { id: 'seekFwd', keys: 'Shift+ArrowRight', label: 'Seek +10 s', group: 'Playback', when: 'noNodes' },
  volumeUp: { id: 'volumeUp', keys: 'ArrowUp', label: 'Volume up', group: 'Playback', when: 'noLibrary' },
  volumeDown: { id: 'volumeDown', keys: 'ArrowDown', label: 'Volume down', group: 'Playback', when: 'noLibrary' },
  tempoDown: { id: 'tempoDown', keys: '[', label: 'Playback speed −5 %', group: 'Playback', when: 'noNodes' },
  tempoUp: { id: 'tempoUp', keys: ']', label: 'Playback speed +5 %', group: 'Playback', when: 'noNodes' },
  mute: { id: 'mute', keys: 'M', label: 'Mute', group: 'Playback', when: 'noNodes' },

  scenePrev: { id: 'scenePrev', keys: 'ArrowLeft', label: 'Previous scene', group: 'Scenes', when: 'noOverlay' },
  sceneNext: { id: 'sceneNext', keys: 'ArrowRight', label: 'Next scene', group: 'Scenes', when: 'noOverlay' },
  library: { id: 'library', keys: 'L', label: 'Scene library', group: 'Scenes', when: 'noNodes' },
  librarySearch: { id: 'librarySearch', keys: '/', label: 'Search scenes', group: 'Scenes', when: 'library', owner: 'library' },
  libraryLeft: { id: 'libraryLeft', keys: 'ArrowLeft', label: 'Previous hit', group: 'Scenes', when: 'library', inInputs: true, owner: 'library' },
  libraryRight: { id: 'libraryRight', keys: 'ArrowRight', label: 'Next hit', group: 'Scenes', when: 'library', inInputs: true, owner: 'library' },
  libraryTabNext: { id: 'libraryTabNext', keys: 'Tab', label: 'Next category', group: 'Scenes', when: 'library', inInputs: true, owner: 'library' },
  libraryTabPrev: { id: 'libraryTabPrev', keys: 'Shift+Tab', label: 'Previous category', group: 'Scenes', when: 'library', inInputs: true, owner: 'library' },
  libraryUp: { id: 'libraryUp', keys: 'ArrowUp', label: 'Hit above', group: 'Scenes', when: 'library', inInputs: true, owner: 'library' },
  libraryDown: { id: 'libraryDown', keys: 'ArrowDown', label: 'Hit below', group: 'Scenes', when: 'library', inInputs: true, owner: 'library' },
  libraryPick: { id: 'libraryPick', keys: 'Enter', label: 'Play the highlighted scene', group: 'Scenes', when: 'library', inInputs: true, owner: 'library' },
  auto: { id: 'auto', keys: 'A', label: 'Auto-switch', group: 'Scenes', when: 'noNodes' },
  randomize: { id: 'randomize', keys: 'R', label: 'Randomize', group: 'Look', when: 'noNodes' },
  randomizeBack: { id: 'randomizeBack', keys: 'Shift+R', label: 'Back to the previous random look', group: 'Look', when: 'noNodes' },
  lookSlotA: { id: 'lookSlotA', keys: 'Alt+1', label: 'Glide to Look slot A', group: 'Look', when: 'noNodes' },
  lookSlotB: { id: 'lookSlotB', keys: 'Alt+2', label: 'Glide to Look slot B', group: 'Look', when: 'noNodes' },
  lookSlotC: { id: 'lookSlotC', keys: 'Alt+3', label: 'Glide to Look slot C', group: 'Look', when: 'noNodes' },
  lookSlotD: { id: 'lookSlotD', keys: 'Alt+4', label: 'Glide to Look slot D', group: 'Look', when: 'noNodes' },

  assistant: { id: 'assistant', keys: 'I', label: 'AI assistant', group: 'Panels', when: 'noNodes' },
  assistantNew: { id: 'assistantNew', keys: 'Alt+N', label: 'New conversation', group: 'Panels', when: 'assistantOpen', inInputs: true, owner: 'assistant' },
  assistantPrev: { id: 'assistantPrev', keys: 'Alt+ArrowUp', label: 'Previous conversation', group: 'Panels', when: 'assistantOpen', inInputs: true, owner: 'assistant' },
  assistantNext: { id: 'assistantNext', keys: 'Alt+ArrowDown', label: 'Next conversation', group: 'Panels', when: 'assistantOpen', inInputs: true, owner: 'assistant' },
  assistantSearch: { id: 'assistantSearch', keys: 'Mod+K', label: 'Find a conversation', group: 'Panels', when: 'assistantOpen', inInputs: true, owner: 'assistant' },
  editor: { id: 'editor', keys: 'E', label: 'Shader editor', group: 'Panels', when: 'always' },
  visualMaker: { id: 'visualMaker', keys: 'N', label: 'Visual maker', group: 'Panels', when: 'always' },
  params: { id: 'params', keys: 'P', label: 'Collapse parameters', group: 'Panels', when: 'paramsVisible' },
  hidePanel: { id: 'hidePanel', keys: 'H', label: 'Hide controls', group: 'Panels', when: 'noNodes' },
  resetLayout: { id: 'resetLayout', keys: 'Shift+H', label: 'Reset layout', group: 'Panels', when: 'noNodes' },
  perf: { id: 'perf', keys: 'Shift+P', label: 'Performance monitor', group: 'Panels', when: 'noNodes' },
  hearingMonitor: { id: 'hearingMonitor', keys: 'Shift+L', label: 'Hearing monitor', group: 'Panels', when: 'noNodes' },
  systemLog: { id: 'systemLog', keys: 'Shift+S', label: 'System log', group: 'Panels', when: 'noNodes' },
  fullscreen: { id: 'fullscreen', keys: 'F', label: 'Fullscreen', group: 'Panels', when: 'always' },
  record: { id: 'record', keys: 'C', label: 'Record', group: 'Panels', when: 'noNodes' },
  help: { id: 'help', keys: '?', label: 'Help & shortcuts', group: 'Panels', when: 'always' },
  settings: { id: 'settings', keys: ',', label: 'Settings', group: 'Panels', when: 'noNodes' },
  closeOverlay: { id: 'closeOverlay', keys: 'Escape', label: 'Close', group: 'Panels', when: 'overlayOpen', inInputs: true },
  deleteNode: { id: 'deleteNode', keys: 'Delete', label: 'Delete block', group: 'Panels', when: 'nodesOpen', owner: 'nodes' },
  deleteNodeBackspace: { id: 'deleteNodeBackspace', keys: 'Backspace', label: 'Delete block', group: 'Panels', when: 'nodesOpen', owner: 'nodes' },

  studio: { id: 'studio', keys: 'O', label: 'Studio & projector', group: 'Studio', when: 'noNodes' },
  take: { id: 'take', keys: 'T', label: 'Take', group: 'Studio', when: 'noNodes' },
  blackout: { id: 'blackout', keys: 'B', label: 'Blackout', group: 'Studio', when: 'noNodes' },
  studioPrev: { id: 'studioPrev', keys: 'ArrowLeft', label: 'Previous cue', group: 'Studio', when: 'studio' },
  studioNext: { id: 'studioNext', keys: 'ArrowRight', label: 'Next cue', group: 'Studio', when: 'studio' },
} as const satisfies Record<string, HotkeyDef>;

export type HotkeyId = keyof typeof HOTKEYS;

// The bindings an owner registers, and its actions for them: one per binding, so a binding nobody
// gives an action doesn't compile.
type OwnerOf<K extends HotkeyId> = (typeof HOTKEYS)[K] extends { owner: infer O } ? O : 'app';
export type HotkeyIdOf<O extends HotkeyOwner> = { [K in HotkeyId]: OwnerOf<K> extends O ? K : never }[HotkeyId];
export type HotkeyActions<O extends HotkeyOwner> = Record<HotkeyIdOf<O>, () => void>;

// Scene number keys: 1–9 and 0 outside the studio, cue keys 1–9 inside it.
export const SCENE_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;
export const CUE_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
export const SCENE_DIGITS_WHEN: HotkeyWhen = 'notStudio';
export const CUE_DIGITS_WHEN: HotkeyWhen = 'studio';

// The UI state the `when` conditions read.
export interface HotkeyContext {
  overlay: Overlay;
  assistantOpen: boolean;
  helpOpen: boolean;
  paramsVisible: boolean;
}

// Whether a binding is live. Bindings that share a key must never be live together: the registry
// test runs this over every context, and `useAppHotkeys` registers conflicts as errors.
export function isEnabled(when: HotkeyWhen, c: HotkeyContext): boolean {
  const nodesOpen = c.overlay === 'nodes';
  const studioOpen = c.overlay === 'studio';
  switch (when) {
    case 'always': return true;
    case 'noOverlay': return c.overlay === null || c.overlay === 'editor';
    case 'noNodes': return !nodesOpen;
    case 'studio': return studioOpen;
    case 'notStudio': return !studioOpen && !nodesOpen;
    case 'nodesOpen': return nodesOpen;
    case 'paramsVisible': return c.paramsVisible && !nodesOpen;
    case 'overlayOpen': return c.overlay !== null || c.assistantOpen || c.helpOpen;
    case 'library': return c.overlay === 'library';
    case 'noLibrary': return c.overlay !== 'library' && !nodesOpen;
    case 'assistantOpen': return c.assistantOpen;
  }
}
