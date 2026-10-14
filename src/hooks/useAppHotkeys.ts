// Registers every shortcut from the registry with TanStack Hotkeys. `when` rules come from the
// old keydown handler: overlays and the game take some keys over, the visual maker takes them all.

import { useHotkeys, type UseHotkeyDefinition } from '@tanstack/react-hotkeys';
import { useApp, useUI } from '../app/AppContext';
import { CUE_DIGITS, HOTKEYS, SCENE_DIGITS, type HotkeyDef, type HotkeyWhen } from '../hotkeys/registry';

export interface HotkeyActions {
  playPause(): void; seek(seconds: number): void; changeVolume(delta: number): void; changeRate(delta: number): void; toggleMute(): void;
  stepScene(dir: number): void; pickScene(digit: number): void; steer(dir: number): void; restartGame(): void;
  toggleLibrary(): void; toggleAssistant(): void; toggleHelp(): void; toggleEditor(): void; toggleVisualMaker(): void; toggleStudio(): void;
  toggleParams(): void; togglePanel(): void; toggleFullscreen(): void; toggleRecording(): void; toggleAuto(): void; randomize(): void;
  closeOverlay(): void; take(): void; blackout(): void; studioStep(dir: number): void; studioCue(n: number): void; game(): void;
  librarySearch(): void; libraryMove(dx: number, dy: number): void; libraryPick(): void; libraryTab(dir: number): void; deleteNode(): void;
}

export function useAppHotkeys(actions: HotkeyActions): void {
  const app = useApp();
  const overlay = useUI((ui) => ui.overlay);
  const assistantOpen = useUI((ui) => ui.assistantOpen);
  const helpOpen = useUI((ui) => ui.help !== null);
  const paramsVisible = useUI((ui) => ui.paramsVisible);
  const sceneIndex = useUI((ui) => ui.sceneIndex);
  const inGame = sceneIndex === app.state.gameIndex;
  const nodesOpen = overlay === 'nodes';
  const studioOpen = overlay === 'studio';

  const enabled = (when: HotkeyWhen): boolean => {
    switch (when) {
      case 'always': return true;
      case 'noOverlay': return overlay === null && !inGame;
      case 'noNodes': return !nodesOpen;
      case 'notGame': return !inGame && !nodesOpen;
      case 'game': return inGame && !nodesOpen && !studioOpen;
      case 'studio': return studioOpen;
      case 'notStudio': return !studioOpen && !nodesOpen;
      case 'nodesOpen': return nodesOpen;
      case 'paramsVisible': return paramsVisible && !nodesOpen;
      case 'overlayOpen': return overlay !== null || assistantOpen || helpOpen;
      case 'library': return overlay === 'library';
      case 'noLibrary': return overlay !== 'library' && !nodesOpen;
    }
  };

  // After a shortcut, hand the keyboard back from any focused control (the old handler blurred too).
  const fire = (def: HotkeyDef, fn: () => void): UseHotkeyDefinition => ({
    hotkey: def.keys,
    callback: (event) => {
      fn();
      if (event.target instanceof HTMLInputElement && !def.inInputs) event.target.blur();
    },
    options: { enabled: enabled(def.when), preventDefault: true, ...(def.inInputs && { ignoreInputs: false }), meta: { name: def.label, group: def.group } },
  });

  const defs: UseHotkeyDefinition[] = [
    fire(HOTKEYS.playPause, actions.playPause),
    fire(HOTKEYS.seekBack, () => actions.seek(-10)),
    fire(HOTKEYS.seekFwd, () => actions.seek(10)),
    fire(HOTKEYS.volumeUp, () => actions.changeVolume(0.05)),
    fire(HOTKEYS.volumeDown, () => actions.changeVolume(-0.05)),
    fire(HOTKEYS.tempoDown, () => actions.changeRate(-0.05)),
    fire(HOTKEYS.tempoUp, () => actions.changeRate(0.05)),
    fire(HOTKEYS.mute, actions.toggleMute),
    fire(HOTKEYS.scenePrev, () => actions.stepScene(-1)),
    fire(HOTKEYS.sceneNext, () => actions.stepScene(1)),
    fire(HOTKEYS.steerLeft, () => actions.steer(-1)),
    fire(HOTKEYS.steerRight, () => actions.steer(1)),
    fire(HOTKEYS.restartGame, actions.restartGame),
    fire(HOTKEYS.studioPrev, () => actions.studioStep(-1)),
    fire(HOTKEYS.studioNext, () => actions.studioStep(1)),
    fire(HOTKEYS.library, actions.toggleLibrary),
    fire(HOTKEYS.assistant, actions.toggleAssistant),
    fire(HOTKEYS.help, actions.toggleHelp),
    fire(HOTKEYS.editor, actions.toggleEditor),
    fire(HOTKEYS.visualMaker, actions.toggleVisualMaker),
    fire(HOTKEYS.studio, actions.toggleStudio),
    fire(HOTKEYS.take, actions.take),
    fire(HOTKEYS.blackout, actions.blackout),
    fire(HOTKEYS.params, actions.toggleParams),
    fire(HOTKEYS.game, actions.game),
    fire(HOTKEYS.hidePanel, actions.togglePanel),
    fire(HOTKEYS.fullscreen, actions.toggleFullscreen),
    fire(HOTKEYS.record, actions.toggleRecording),
    fire(HOTKEYS.auto, actions.toggleAuto),
    fire(HOTKEYS.randomize, actions.randomize),
    fire(HOTKEYS.closeOverlay, actions.closeOverlay),
    fire(HOTKEYS.deleteNode, actions.deleteNode),
    fire(HOTKEYS.deleteNodeBackspace, actions.deleteNode),
    fire(HOTKEYS.librarySearch, actions.librarySearch),
    fire(HOTKEYS.libraryLeft, () => actions.libraryMove(-1, 0)),
    fire(HOTKEYS.libraryRight, () => actions.libraryMove(1, 0)),
    fire(HOTKEYS.libraryUp, () => actions.libraryMove(0, -1)),
    fire(HOTKEYS.libraryDown, () => actions.libraryMove(0, 1)),
    fire(HOTKEYS.libraryPick, actions.libraryPick),
    fire(HOTKEYS.libraryTabNext, () => actions.libraryTab(1)),
    fire(HOTKEYS.libraryTabPrev, () => actions.libraryTab(-1)),
    // 1–9, 0 pick scenes; inside the studio 1–9 pick cues.
    ...SCENE_DIGITS.map((d, n): UseHotkeyDefinition => ({
      hotkey: d, callback: () => actions.pickScene(n), options: { enabled: !studioOpen && !nodesOpen, preventDefault: true, meta: { name: `Scene ${d}`, group: 'Scenes' } },
    })),
    ...CUE_DIGITS.map((d, n): UseHotkeyDefinition => ({
      hotkey: d, callback: () => actions.studioCue(n), options: { enabled: studioOpen, preventDefault: true, meta: { name: `Cue ${d}`, group: 'Studio' } },
    })),
  ];
  // Several actions share a key (← is scene / steer / cue) and exactly one is enabled at a time, so
  // only the enabled ones are registered and any real double binding is an error.
  useHotkeys(defs.filter((d) => d.options?.enabled !== false), { conflictBehavior: 'error' });
}
