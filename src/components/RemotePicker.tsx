// Search a site through the local yt-dlp bridge (or paste a link) and pick a result: SoundCloud
// tracks to play as the music, YouTube videos to distort as media. The server fetches the file so it
// can be analysed / drawn like a local one. Results double as a queue, and what you pick is
// remembered: the picker opens on that "Recently played" list so you can pick it again.

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useApp, useUI } from '../app/AppContext';
import type { PickerApi } from '../app/controller';
import { HOTKEYS } from '../hotkeys/registry';
import { Kbd } from '../hotkeys/Kbd';
import { remoteSite, type Download } from '../remote/client';
import { RemoteTrackSchema, type Progress, type RemoteTrack as Track, type SiteName } from '../remote/wire';
import { readJSON, writeJSON, remove as removeKey } from '../state/persistence';
import { HelpButton } from './Help';

const RECENT_MAX = 25;

export interface RemotePickerProps {
  id: 'sc' | 'yt';
  site: SiteName;
  title: string;
  noun?: string;
  recentKey: string;
  fetching: string;
  emptyText: string;
  placeholder: string;
  onPlay: (src: string, label: string, track: Track) => Promise<void> | void;
  children?: React.ReactNode;   // footer
}

export function RemotePicker({ id, site, title, noun = 'track', recentKey, fetching, emptyText, placeholder, onPlay, children }: RemotePickerProps) {
  const app = useApp();
  const open = useUI((ui) => ui.overlay === (id === 'sc' ? 'soundcloud' : 'youtube'));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [current, setCurrent] = useState(-1);
  const [view, setView] = useState<'recent' | 'search'>('recent');
  const [recent, setRecent] = useState<Track[]>(() => readJSON(recentKey, z.array(RemoteTrackSchema), []));
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: '' });
  const [progress, setProgress] = useState<{ track: Track; p: Progress } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const playRequest = useRef(0);
  const download = useRef<Download | null>(null);
  // The newest state for callbacks registered once (the play queue's next / previous).
  const latest = useRef({ results, current, recent });
  useEffect(() => { latest.current = { results, current, recent }; });

  const showRecent = (list = recent) => {
    setView('recent');
    setResults([...list]);
    setCurrent(-1);
    setStatus({ text: list.length ? `Recently played — click one to play it again` : emptyText });
  };

  const search = async (q: string) => {
    if (!q.trim()) return;
    const n = ++request.current;   // a newer search (or showing recents) drops this one's answer
    setStatus({ text: 'Searching…' });
    setResults([]);
    try {
      const found = await remoteSite(site).search(q);
      if (n !== request.current) return;
      setResults(found);
      setCurrent(-1);
      setView('search');
      const k = found.length;
      setStatus({ text: k ? `${k} ${noun}${k > 1 ? 's' : ''} — click one to play` : 'Nothing found' });
    } catch (err) {
      if (n === request.current) setStatus({ text: (err as Error).message, error: true });
    }
  };

  const endDownload = () => {
    download.current = null;
    setProgress(null);
    app.setDownload(id, null);
  };
  const cancel = (quiet = false) => {
    if (!download.current) return;
    download.current.cancel();
    playRequest.current++;
    endDownload();
    if (!quiet) setStatus({ text: 'Download cancelled' });
  };

  // Downloads the pick with live progress (row, status line, and the panel), then hands it on.
  // Picking something else cancels a download still running.
  const play = async (index: number) => {
    const track = latest.current.results[index];
    if (!track) return;
    cancel(true);
    const n = ++playRequest.current;
    setCurrent(index);
    const report = (p: Progress) => {
      if (n !== playRequest.current) return;
      setProgress({ track, p });
      const text = progressText(fetching, track, p);
      setStatus({ text });
      app.setDownload(id, { title: track.title, percent: p.percent, text });
    };
    report({ percent: 0, stage: 'starting' });
    try {
      const dl = remoteSite(site).download(track.url, report);
      download.current = dl;
      const src = await dl.promise;
      if (n !== playRequest.current) return;
      endDownload();
      setStatus({ text: `Playing "${track.title}"` });
      const next = [track, ...latest.current.recent.filter((t) => t.url !== track.url)].slice(0, RECENT_MAX);
      latest.current.recent = next;
      setRecent(next);
      writeJSON(recentKey, next);
      await onPlay(src, track.artist ? `${track.artist} — ${track.title}` : track.title, track);
      app.setOverlay(null);
    } catch (err) {
      if (n !== playRequest.current || (err as Error).name === 'AbortError') return;
      endDownload();
      setStatus({ text: (err as Error).message, error: true });
      app.toast((err as Error).message, 6000);
    }
  };

  // Register as the play queue for this source.
  useEffect(() => {
    const api: PickerApi = {
      playNext: () => { const { results, current } = latest.current; if (current < 0 || current >= results.length - 1) return false; void play(current + 1); return true; },
      playPrev: () => { const { current } = latest.current; if (current <= 0) return false; void play(current - 1); return true; },
      get hasQueue() { return latest.current.results.length > 1; },
      get busy() { return !!download.current; },
      cancel: () => cancel(),
      clearRecent: () => {   // Settings → Data (it asks first)
        latest.current.recent = [];
        setRecent([]);
        removeKey(recentKey);
      },
    };
    return app.registerPicker(id, api);
  }, [app, id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Opening shows the recent list unless a search is on screen (state adjusted during render).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && (view !== 'search' || !query.trim())) showRecent();
  }
  useEffect(() => {
    if (!open) return;
    request.current++;   // drop any search still in flight
    input.current?.focus();
  }, [open]);

  const clearRecent = () => {
    if (!confirm('Forget the recently played tracks?')) return;
    setRecent([]);
    removeKey(recentKey);
    request.current++;
    showRecent([]);
  };

  return (
    <section id={id} className={`sc${id === 'yt' ? ' yt' : ''}${view === 'recent' ? ' recent-view' : ''}${recent.length ? ' has-recent' : ''}`} hidden={!open}>
      <header>
        <strong>{title}</strong>
        <HelpButton topic={site} />
        <button id={`${id}-close`} className="icon" title="Close (Esc)" onClick={() => app.setOverlay(null)}>×<Kbd hotkey={HOTKEYS.closeOverlay} /></button>
      </header>
      <form id={`${id}-form`} onSubmit={(e) => { e.preventDefault(); void search(query); }}>
        <input id={`${id}-query`} ref={input} type="search" placeholder={placeholder} autoComplete="off" value={query}
          onChange={(e) => { setQuery(e.target.value); if (!e.target.value.trim()) { request.current++; showRecent(); } }} />
        <button type="submit">Search</button>
        <button type="button" id={`${id}-recent`} title="Show what you used recently" onClick={() => { request.current++; showRecent(); }}>Recent</button>
      </form>
      <div className="sc-status-row">
        <p id={`${id}-status`} className={`sc-status${status.error ? ' error' : ''}`}>{status.text}</p>
        <button type="button" id={`${id}-clear-recent`} className="sc-clear" title="Forget the recent items" onClick={clearRecent}>Clear history</button>
      </div>
      <div id={`${id}-progress`} className="dl-bar" hidden={!progress}><i style={{ width: `${progress?.p.percent ?? 0}%` }} /></div>
      <ul id={`${id}-results`} className="sc-results">
        {results.map((t, i) => (
          <li key={t.url} data-url={t.url} className={`${i === current ? 'current' : ''}${progress?.track.url === t.url ? ' loading' : ''}`}
            style={progress?.track.url === t.url ? ({ '--p': `${progress.p.percent}%` } as React.CSSProperties) : undefined}
            onClick={() => void play(i)}>
            {t.artwork ? <img className="sc-art" src={t.artwork} alt="" loading="lazy" /> : <div className="sc-art" />}
            <div className="sc-text"><strong>{t.title}</strong><span>{t.artist}</span></div>
            <time>{formatDuration(t.duration)}</time>
          </li>
        ))}
      </ul>
      {children}
    </section>
  );
}

// "Downloading (video) 45% · 120.3 MB of 280.1 MB · 8.2 MB/s · 0:18 left"
export function progressText(verb: string, track: Track, p: Progress): string {
  const pct = `${Math.floor(p.percent)}%`;
  if (p.stage === 'starting') return `${verb} "${track.title}"…`;
  if (p.stage === 'merging') return `Merging video and sound… ${pct}`;
  if (p.stage === 'finishing') return `Finishing… ${pct}`;
  const part = p.stage === 'video' ? ' (video)' : p.stage === 'sound' ? ' (sound)' : '';
  const size = p.total ? ` · ${mb(p.bytes ?? 0)} of ${mb(p.total)}` : '';
  const speed = p.speed ? ` · ${mb(p.speed)}/s` : '';
  const eta = p.eta ? ` · ${formatDuration(p.eta)} left` : '';
  return `${verb}${part} ${pct}${size}${speed}${eta}`;
}

const mb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`);

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
