// The shell: one canvas that never moves, the start screen, the panel, the parameters overlay and
// every other overlay. Overlays stay mounted and toggle with `hidden`, which keeps the stylesheet's
// `body:has(#x:not([hidden]))` rules, the canvases and focus handling exactly as they were.

import { HotkeysProvider } from '@tanstack/react-hotkeys';
import { useEffect, useRef } from 'react';
import { AppProvider, useApp, useUI } from './AppContext';
import type { AppController } from './controller';
import { Assistant, AssistantBubble } from '../components/Assistant';
import { Editor } from '../components/Editor';
import { Hud } from '../components/Hud';
import { Library } from '../components/Library';
import { Panel } from '../components/Panel';
import { SoundCloudPicker, YouTubePicker } from '../components/Pickers';
import { ParamOverlay } from '../components/ParamOverlay';
import { StartScreen } from '../components/StartScreen';
import { Studio } from '../components/Studio';
import { Toast } from '../components/Toast';
import { VisualMaker } from '../components/VisualMaker';
import { useAppHotkeys } from '../hooks/useAppHotkeys';
import { useEngines } from '../hooks/useEngines';
import type { SourceButton } from '../state/app-state';

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { app, error } = useEngines(canvas);
  return (
    <>
      <canvas id="gl" ref={canvas} />
      {error && <pre style={{ padding: 24, color: '#f88', whiteSpace: 'pre-wrap' }}>{error}</pre>}
      {app && (
        <AppProvider value={app}>
          <HotkeysProvider defaultOptions={{ hotkey: { preventDefault: true } }}>
            <Shell app={app} />
          </HotkeysProvider>
        </AppProvider>
      )}
    </>
  );
}

function Shell({ app }: { app: AppController }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const started = useUI((ui) => ui.started);

  useEffect(() => {
    document.body.classList.toggle('started', started);
  }, [started]);

  // Drag & drop anywhere: audio plays, pictures and videos become the media.
  useEffect(() => {
    const over = (e: DragEvent) => { e.preventDefault(); document.body.classList.add('dragging'); };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); };
    const drop = (e: DragEvent) => { e.preventDefault(); document.body.classList.remove('dragging'); app.drop(e.dataTransfer?.files[0]); };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, [app]);

  const onSource = (kind: SourceButton) => void app.startSource(kind, () => fileInput.current?.click(), () => app.setOverlay('soundcloud'));

  return (
    <>
      <StartScreen onSource={onSource} />
      <Panel
        onSource={onSource}
        onOpenMediaFile={() => mediaInput.current?.click()}
        onOpenYouTube={() => app.setOverlay('youtube')}
        onOpenLibrary={() => app.toggleOverlay('library')}
        onOpenEditor={() => app.toggleOverlay('editor')}
        onOpenVisualMaker={() => app.toggleOverlay('nodes')}
        onOpenStudio={() => app.toggleOverlay('studio')}
      />
      <AssistantBubble />
      <ParamOverlay />
      <Library onEdit={(i) => { app.setScene(i); app.setOverlay('editor'); }} />
      <Editor />
      <VisualMaker />
      <Studio />
      <Assistant />
      <SoundCloudPicker />
      <YouTubePicker />
      <Hud />
      <Toast />
      <Hotkeys />
      <input type="file" id="file" accept="audio/*" hidden ref={fileInput} onChange={(e) => { void app.playFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input type="file" id="media-file" accept="image/*,video/*" hidden ref={mediaInput} onChange={(e) => { const f = e.target.files?.[0]; if (f) void app.loadMedia(f); e.target.value = ''; }} />
    </>
  );
}

function Hotkeys() {
  const app = useApp();
  const tr = app.transport;
  useAppHotkeys({
    playPause: () => app.togglePlay(),
    seek: (s) => tr.skip(s),
    changeVolume: (d) => app.toast(`Volume ${Math.round(tr.changeVolume(d) * 100)}%`, 900),
    changeRate: (d) => app.toast(`Tempo ${tr.changeRate(d).toFixed(2)}×`, 900),
    toggleMute: () => app.toast(tr.toggleMute() ? 'Muted' : 'Sound on', 900),
    stepScene: (dir) => app.stepScene(dir),
    pickScene: (n) => { const i = app.state.keyedScenes[n]; if (i !== undefined) app.setScene(i); },
    steer: (dir) => app.game.steer(dir),
    restartGame: () => app.game.reset(),
    game: () => app.setScene(app.state.gameIndex),
    toggleLibrary: () => app.toggleOverlay('library'),
    toggleAssistant: () => app.toggleAssistant(),
    toggleEditor: () => app.toggleOverlay('editor'),
    toggleVisualMaker: () => app.toggleOverlay('nodes'),
    toggleStudio: () => app.toggleOverlay('studio'),
    toggleParams: () => app.toggleParamsCollapsed(),
    togglePanel: () => app.togglePanel(),
    toggleFullscreen: () => app.toggleFullscreen(),
    toggleRecording: () => app.toggleRecording(),
    toggleAuto: () => app.toggleAuto(),
    randomize: () => app.randomize(),
    // Esc: leave a text field first, then close the open overlay, then the assistant bubble.
    closeOverlay: () => {
      if (app.hooks.escape?.()) return;
      const active = document.activeElement;
      // A draft in the assistant's composer is protected: Esc leaves the field first, a second Esc closes.
      if (active instanceof HTMLTextAreaElement && active.closest('#ai') && active.value.trim()) { active.blur(); return; }
      if (app.overlay) app.setOverlay(null);
      else app.toggleAssistant(false);
    },
    take: () => app.hooks.take?.(),
    blackout: () => app.hooks.blackout?.(),
    studioStep: (dir) => app.hooks.studioStep?.(dir),
    studioCue: (n) => app.hooks.studioCue?.(n),
    librarySearch: () => app.hooks.librarySearch?.(),
    libraryMove: (dx, dy) => app.hooks.libraryMove?.(dx, dy),
    libraryPick: () => app.hooks.libraryPick?.(),
    libraryTab: (dir) => app.hooks.libraryTab?.(dir),
    deleteNode: () => app.hooks.deleteNode?.(),
  });
  return null;
}
