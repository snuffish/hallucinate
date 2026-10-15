import type { Hotkey } from '@tanstack/react-hotkeys';

// Every keyboard shortcut in the app, in one place: the hooks register them, the badges display them
// and the help sheet lists them. `when` encodes the old overlay rules (src/main.js keydown handler).

export type HotkeyWhen =
  | 'always'
  | 'noOverlay'      // no overlay open and not the visual maker
  | 'noNodes'        // everything except while the visual maker is open
  | 'notGame'        // scene keys that the game reuses
  | 'game'
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
  group: 'Playback' | 'Scenes' | 'Panels' | 'Studio' | 'Game' | 'Look';
  when: HotkeyWhen;
  // Fires even while a text field has focus (Escape and the like).
  inInputs?: boolean;
}

export const HOTKEYS = {
  playPause: { id: 'playPause', keys: 'Space', label: 'Play / pause', group: 'Playback', when: 'noNodes' },
  seekBack: { id: 'seekBack', keys: 'Shift+ArrowLeft', label: 'Seek −10 s', group: 'Playback', when: 'notGame' },
  seekFwd: { id: 'seekFwd', keys: 'Shift+ArrowRight', label: 'Seek +10 s', group: 'Playback', when: 'notGame' },
  volumeUp: { id: 'volumeUp', keys: 'ArrowUp', label: 'Volume up', group: 'Playback', when: 'noLibrary' },
  volumeDown: { id: 'volumeDown', keys: 'ArrowDown', label: 'Volume down', group: 'Playback', when: 'noLibrary' },
  tempoDown: { id: 'tempoDown', keys: '[', label: 'Tempo −5 %', group: 'Playback', when: 'noNodes' },
  tempoUp: { id: 'tempoUp', keys: ']', label: 'Tempo +5 %', group: 'Playback', when: 'noNodes' },
  mute: { id: 'mute', keys: 'M', label: 'Mute', group: 'Playback', when: 'noNodes' },

  scenePrev: { id: 'scenePrev', keys: 'ArrowLeft', label: 'Previous scene', group: 'Scenes', when: 'noOverlay' },
  sceneNext: { id: 'sceneNext', keys: 'ArrowRight', label: 'Next scene', group: 'Scenes', when: 'noOverlay' },
  library: { id: 'library', keys: 'L', label: 'Scene library', group: 'Scenes', when: 'noNodes' },
  librarySearch: { id: 'librarySearch', keys: '/', label: 'Search scenes', group: 'Scenes', when: 'library' },
  libraryLeft: { id: 'libraryLeft', keys: 'ArrowLeft', label: 'Previous hit', group: 'Scenes', when: 'library', inInputs: true },
  libraryRight: { id: 'libraryRight', keys: 'ArrowRight', label: 'Next hit', group: 'Scenes', when: 'library', inInputs: true },
  libraryTabNext: { id: 'libraryTabNext', keys: 'Tab', label: 'Next category', group: 'Scenes', when: 'library', inInputs: true },
  libraryTabPrev: { id: 'libraryTabPrev', keys: 'Shift+Tab', label: 'Previous category', group: 'Scenes', when: 'library', inInputs: true },
  libraryUp: { id: 'libraryUp', keys: 'ArrowUp', label: 'Hit above', group: 'Scenes', when: 'library', inInputs: true },
  libraryDown: { id: 'libraryDown', keys: 'ArrowDown', label: 'Hit below', group: 'Scenes', when: 'library', inInputs: true },
  libraryPick: { id: 'libraryPick', keys: 'Enter', label: 'Play the highlighted scene', group: 'Scenes', when: 'library', inInputs: true },
  auto: { id: 'auto', keys: 'A', label: 'Auto-switch', group: 'Scenes', when: 'noNodes' },
  randomize: { id: 'randomize', keys: 'R', label: 'Randomize', group: 'Look', when: 'noNodes' },
  game: { id: 'game', keys: 'G', label: 'Beat Racer', group: 'Game', when: 'noNodes' },
  steerLeft: { id: 'steerLeft', keys: 'ArrowLeft', label: 'Steer left', group: 'Game', when: 'game' },
  steerRight: { id: 'steerRight', keys: 'ArrowRight', label: 'Steer right', group: 'Game', when: 'game' },
  restartGame: { id: 'restartGame', keys: 'Enter', label: 'Race again', group: 'Game', when: 'game' },

  assistant: { id: 'assistant', keys: 'I', label: 'AI assistant', group: 'Panels', when: 'noNodes' },
  assistantNew: { id: 'assistantNew', keys: 'Alt+N', label: 'New conversation', group: 'Panels', when: 'assistantOpen', inInputs: true },
  assistantPrev: { id: 'assistantPrev', keys: 'Alt+ArrowUp', label: 'Previous conversation', group: 'Panels', when: 'assistantOpen', inInputs: true },
  assistantNext: { id: 'assistantNext', keys: 'Alt+ArrowDown', label: 'Next conversation', group: 'Panels', when: 'assistantOpen', inInputs: true },
  assistantSearch: { id: 'assistantSearch', keys: 'Mod+K', label: 'Find a conversation', group: 'Panels', when: 'assistantOpen', inInputs: true },
  editor: { id: 'editor', keys: 'E', label: 'Shader editor', group: 'Panels', when: 'always' },
  visualMaker: { id: 'visualMaker', keys: 'N', label: 'Visual maker', group: 'Panels', when: 'always' },
  params: { id: 'params', keys: 'P', label: 'Collapse parameters', group: 'Panels', when: 'paramsVisible' },
  hidePanel: { id: 'hidePanel', keys: 'H', label: 'Hide controls', group: 'Panels', when: 'noNodes' },
  resetLayout: { id: 'resetLayout', keys: 'Shift+H', label: 'Reset layout', group: 'Panels', when: 'noNodes' },
  fullscreen: { id: 'fullscreen', keys: 'F', label: 'Fullscreen', group: 'Panels', when: 'always' },
  record: { id: 'record', keys: 'C', label: 'Record', group: 'Panels', when: 'noNodes' },
  help: { id: 'help', keys: '?', label: 'Help & shortcuts', group: 'Panels', when: 'always' },
  closeOverlay: { id: 'closeOverlay', keys: 'Escape', label: 'Close', group: 'Panels', when: 'overlayOpen', inInputs: true },
  deleteNode: { id: 'deleteNode', keys: 'Delete', label: 'Delete block', group: 'Panels', when: 'nodesOpen' },
  deleteNodeBackspace: { id: 'deleteNodeBackspace', keys: 'Backspace', label: 'Delete block', group: 'Panels', when: 'nodesOpen' },

  studio: { id: 'studio', keys: 'O', label: 'Studio & projector', group: 'Studio', when: 'noNodes' },
  take: { id: 'take', keys: 'T', label: 'Take', group: 'Studio', when: 'noNodes' },
  blackout: { id: 'blackout', keys: 'B', label: 'Blackout', group: 'Studio', when: 'noNodes' },
  studioPrev: { id: 'studioPrev', keys: 'ArrowLeft', label: 'Previous cue', group: 'Studio', when: 'studio' },
  studioNext: { id: 'studioNext', keys: 'ArrowRight', label: 'Next cue', group: 'Studio', when: 'studio' },
} as const satisfies Record<string, HotkeyDef>;

export type HotkeyId = keyof typeof HOTKEYS;

// Scene number keys: 1–9 and 0 outside the studio, cue keys 1–9 inside it.
export const SCENE_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;
export const CUE_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
