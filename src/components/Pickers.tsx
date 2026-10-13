import { useApp, useUI } from '../app/AppContext';
import { KEYS } from '../state/persistence';
import { RemotePicker } from './RemotePicker';

export function SoundCloudPicker() {
  const app = useApp();
  return (
    <RemotePicker id="sc" site="soundcloud" title="SoundCloud" recentKey={KEYS.scRecent} fetching="Fetching"
      placeholder="Search tracks, or paste a track / playlist / artist link"
      emptyText="Search for a track, or paste a SoundCloud link. Tracks you play show up here."
      onPlay={(src, label) => app.playUrl(src, label, 'soundcloud')} />
  );
}

export function YouTubePicker() {
  const app = useApp();
  const mediaSound = useUI((ui) => ui.mediaSound);
  return (
    <RemotePicker id="yt" site="youtube" title="YouTube" noun="video" recentKey={KEYS.ytRecent} fetching="Downloading"
      placeholder="Search videos, or paste a video / playlist / Shorts link"
      emptyText="Search YouTube, or paste a video, playlist or Shorts link. Videos you use show up here."
      onPlay={(src, _label, track) => app.loadMedia({ url: src, name: track.title, kind: 'video', site: 'youtube' })}>
      <footer className="yt-footer">
        <label className="toggle"><input type="checkbox" id="yt-sound" checked={mediaSound} onChange={(e) => app.setMediaSound(e.target.checked, { quiet: !app.media.el })} /> Use the video's sound as the music</label>
        <span>Videos are fetched at up to 720p into a local cache — long ones take a moment the first time.</span>
      </footer>
    </RemotePicker>
  );
}
