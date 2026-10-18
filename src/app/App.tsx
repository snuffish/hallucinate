// The shell: one canvas that never moves, the start screen, the control widgets (incl. parameters)
// and every other overlay. Overlays stay mounted and toggle with `hidden`, which keeps the stylesheet's
// `body:has(#x:not([hidden]))` rules, the canvases and focus handling exactly as they were.

import { HotkeysProvider } from '@tanstack/react-hotkeys';
import { useEffect, useRef } from 'react';
import { AppProvider, useApp, useUI } from './AppContext';
import type { AppController } from './controller';
import { Assistant, AssistantBubble } from '../components/Assistant';
import { Editor } from '../components/Editor';
import { FooterPlayerPrototype } from '../components/FooterPlayer.prototype';   // PROTOTYPE
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SessionsProvider, useSessions } from './sessions';
import { HelpLayer } from '../components/Help';
import { Library } from '../components/Library';
import { PerfOverlay } from '../components/PerfOverlay';
import { Settings } from '../components/Settings';
import { SoundCloudPicker, YouTubePicker } from '../components/Pickers';
import { StartScreen } from '../components/StartScreen';
import { Studio } from '../components/Studio';
import { Toast } from '../components/Toast';
import { VisualMaker } from '../components/VisualMaker';
import { Widgets } from '../components/widgets/Widgets';
import { useAppHotkeys } from '../hooks/useAppHotkeys';
import { useEngines } from '../hooks/useEngines';
import type { SourceButton } from '../state/app-state';

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { app, sessions, error } = useEngines(canvas);
  return (
    <>
      <canvas id="gl" ref={canvas} />
      {error && <pre style={{ padding: 24, color: '#f88', whiteSpace: 'pre-wrap' }}>{error}</pre>}
      {app && sessions && (
        <AppProvider value={app}>
          <SessionsProvider value={sessions}>
            <ErrorBoundary>
              <HotkeysProvider defaultOptions={{ hotkey: { preventDefault: true } }}>
                <Shell app={app} />
              </HotkeysProvider>
            </ErrorBoundary>
          </SessionsProvider>
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
      <Widgets
        onSource={onSource}
        onOpenMediaFile={() => mediaInput.current?.click()}
        onOpenYouTube={() => app.setOverlay('youtube')}
        onOpenLibrary={() => app.toggleOverlay('library')}
        onOpenEditor={() => app.toggleOverlay('editor')}
        onOpenVisualMaker={() => app.toggleOverlay('nodes')}
        onOpenStudio={() => app.toggleOverlay('studio')}
      />
      <AssistantBubble />
      <FooterPlayerPrototype onSource={onSource} />
      <Library onEdit={(i) => { app.setScene(i); app.setOverlay('editor'); }} />
      <Editor />
      <VisualMaker />
      <Studio />
      <Assistant />
      <SoundCloudPicker />
      <YouTubePicker />
      <Settings />
      <PerfOverlay />
      <Toast />
      <HelpLayer />
      <Hotkeys />
      <input type="file" id="file" accept="audio/*" hidden ref={fileInput} onChange={(e) => { void app.playFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input type="file" id="media-file" accept="image/*,video/*" hidden ref={mediaInput} onChange={(e) => { const f = e.target.files?.[0]; if (f) void app.loadMedia(f); e.target.value = ''; }} />
    </>
  );
}

function Hotkeys() {
  const app = useApp();
  const { studio } = useSessions();
  const tr = app.transport;
  useAppHotkeys({
    playPause: () => app.togglePlay(),
    seekBack: () => tr.skip(-10),
    seekFwd: () => tr.skip(10),
    volumeUp: () => app.toast(`Volume ${Math.round(tr.changeVolume(0.05) * 100)}%`, 900),
    volumeDown: () => app.toast(`Volume ${Math.round(tr.changeVolume(-0.05) * 100)}%`, 900),
    tempoDown: () => app.toast(`Tempo ${tr.changeRate(-0.05).toFixed(2)}×`, 900),
    tempoUp: () => app.toast(`Tempo ${tr.changeRate(0.05).toFixed(2)}×`, 900),
    mute: () => app.toast(tr.toggleMute() ? 'Muted' : 'Sound on', 900),
    scenePrev: () => app.stepScene(-1),
    sceneNext: () => app.stepScene(1),
    library: () => app.toggleOverlay('library'),
    auto: () => app.toggleAuto(),
    randomize: () => app.randomize(),
    randomizeBack: () => app.randomizeBack(),
    assistant: () => app.toggleAssistant(),
    editor: () => app.toggleOverlay('editor'),
    visualMaker: () => app.toggleOverlay('nodes'),
    params: () => app.toggleWidgetCollapsed('params'),
    hidePanel: () => app.toggleWidgets(),
    resetLayout: () => app.resetLayout(),
    perf: () => app.togglePerf(),
    fullscreen: () => app.toggleFullscreen(),
    record: () => app.toggleRecording(),
    help: () => app.toggleHelp('sheet'),
    settings: () => app.toggleOverlay('settings'),
    // Esc: close help first (it sits on top), then leave a text field, then close the open overlay, then the assistant bubble.
    closeOverlay: () => {
      if (app.ui.get().help) { app.setHelp(null); return; }
      if (app.hooks.escape?.()) return;
      const active = document.activeElement;
      // A draft in the assistant's composer is protected: Esc leaves the field first, a second Esc closes.
      if (active instanceof HTMLTextAreaElement && active.closest('#ai') && active.value.trim()) { active.blur(); return; }
      if (app.overlay) app.setOverlay(null);
      else app.toggleAssistant(false);
    },
    studio: () => app.toggleOverlay('studio'),
    take: () => studio.take(),
    blackout: () => studio.blackout(),
    studioPrev: () => studio.stepPreviewKey(-1),
    studioNext: () => studio.stepPreviewKey(1),
  }, {
    pickScene: (n) => { const i = app.state.keyedScenes[n]; if (i !== undefined) app.setScene(i); },
    studioCue: (n) => studio.cueKey(n),
  });
  return null;
}
