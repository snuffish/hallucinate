import { useApp, useUI } from '../app/AppContext';
import type { SourceButton } from '../state/app-state';

export const SOURCES: { kind: SourceButton; label: string; short: string }[] = [
  { kind: 'file', label: 'Open audio file', short: 'File' },
  { kind: 'mic', label: 'Microphone / line-in', short: 'Mic' },
  { kind: 'soundcloud', label: 'SoundCloud', short: 'SoundCloud' },
  { kind: 'display', label: 'Tab / system audio', short: 'Tab audio' },
  { kind: 'demo', label: 'Play demo beat', short: 'Demo' },
];

export function StartScreen({ onSource }: { onSource: (kind: SourceButton) => void }) {
  const started = useUI((ui) => ui.started);
  useApp();
  return (
    <section id="start" className={`start${started ? ' hidden' : ''}`}>
      <h1>Hallucinate</h1>
      <p>Drop an audio file anywhere, or choose a source — drop an image or video (or pick one from YouTube in the panel) to distort it</p>
      <div className="sources">
        {SOURCES.map((s) => <button key={s.kind} data-source={s.kind} onClick={() => onSource(s.kind)}>{s.label}</button>)}
      </div>
      <p className="hint">Search SoundCloud right here, or use "Tab / system audio" for Spotify, YouTube or anything playing in another tab.</p>
    </section>
  );
}
