import { useApp, useUI } from '../app/AppContext';
import { STATIC_DEMO } from '../app/static-demo';
import type { SourceButton } from '../state/app-state';

const ALL_SOURCES: { kind: SourceButton; label: string; short: string }[] = [
  { kind: 'file', label: 'Open audio file', short: 'File' },
  { kind: 'mic', label: 'Microphone / line-in', short: 'Mic' },
  { kind: 'soundcloud', label: 'SoundCloud', short: 'SoundCloud' },
  { kind: 'display', label: 'Tab / system audio', short: 'Tab audio' },
  { kind: 'demo', label: 'Play demo beat', short: 'Demo' },
];

// The SoundCloud bridge needs the local server.
export const SOURCES = STATIC_DEMO ? ALL_SOURCES.filter((s) => s.kind !== 'soundcloud') : ALL_SOURCES;

export function StartScreen({ onSource }: { onSource: (kind: SourceButton) => void }) {
  const started = useUI((ui) => ui.started);
  useApp();
  return (
    <section id="start" className={`start${started ? ' hidden' : ''}`}>
      <h1>Hallucinate</h1>
      <p>Drop an audio file anywhere, or choose a source — drop an image or video{STATIC_DEMO ? '' : ' (or pick one from YouTube in the panel)'} to distort it</p>
      <div className="sources">
        {SOURCES.map((s) => <button key={s.kind} data-source={s.kind} onClick={() => onSource(s.kind)}>{s.label}</button>)}
      </div>
      <p className="hint">{STATIC_DEMO ? 'Use' : 'Search SoundCloud right here, or use'} "Tab / system audio" for Spotify, YouTube or anything playing in another tab.</p>
    </section>
  );
}
