// Search a site through the local yt-dlp bridge (or paste a link) and pick a result: SoundCloud
// tracks to play as the music, YouTube videos to distort as media. The server fetches the file so it
// can be analysed / drawn like a local one. Results double as a queue, and what you pick is
// remembered: the picker opens on that "Recently played" list so you can pick it again.

const RECENT_MAX = 25;

export class RemotePicker {
  // id: element id prefix (#<id>, #<id>-query, …); site: /api/<site>/…
  constructor({ id, site, noun = 'track', recentKey, fetching, emptyText, onPlay, onProgress, onError }) {
    Object.assign(this, { site, noun, recentKey, fetching, emptyText, onPlay, onProgress, onError });
    const $ = (suffix) => document.getElementById(suffix ? `${id}-${suffix}` : id);
    this.root = $();
    this.input = $('query');
    this.list = $('results');
    this.status = $('status');
    this.progressBar = $('progress');
    this.download = null;      // { promise, cancel } while a pick is downloading
    this.playRequest = 0;
    this.results = [];
    this.current = -1;
    this.request = 0;

    $('form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.search(this.input.value);
    });
    $('close').onclick = () => this.toggle(false);
    $('recent').onclick = () => this.showRecent();
    $('clear-recent').onclick = () => this.clearRecent();
    this.input.addEventListener('input', () => { if (!this.input.value.trim()) this.showRecent(); });
    this.recent = loadRecent(recentKey);
    this.view = null;   // 'recent' | 'search'
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing here shouldn't trigger the app's shortcuts
      if (e.key === 'Escape') this.toggle(false);
    });
  }

  get isOpen() { return !this.root.hidden; }

  toggle(open = !this.isOpen) {
    this.root.hidden = !open;
    if (!open && this.root.contains(document.activeElement)) document.activeElement.blur();   // hand the keyboard back to the shortcuts
    if (open) {
      if (this.view !== 'search' || !this.input.value.trim()) this.showRecent();
      this.input.focus();
    }
  }

  async search(query) {
    if (!query.trim()) return;
    const id = ++this.request;
    this.setStatus('Searching…');
    this.list.replaceChildren();
    try {
      const { results } = await api(`/api/${this.site}/search?q=${encodeURIComponent(query)}`);
      if (id !== this.request) return;
      this.results = results;
      this.current = -1;
      this.view = 'search';
      this.root.classList.remove('recent-view');
      this.render();
      this.setStatus(results.length ? `${results.length} ${this.noun}${results.length > 1 ? 's' : ''} — click one to play` : 'Nothing found');
    } catch (err) {
      if (id === this.request) this.setStatus(err.message, true);
    }
  }

  // Downloads the pick with live progress (row, status line, and onProgress for the panel), then
  // hands it on. Picking something else cancels a download still running.
  async play(index) {
    const track = this.results[index];
    if (!track) return;
    this.cancel({ quiet: true });
    const id = ++this.playRequest;
    this.current = index;
    this.render();
    this.showProgress(track, { percent: 0, stage: 'starting' });
    try {
      this.download = download(this.site, track.url, (p) => { if (id === this.playRequest) this.showProgress(track, p); });
      const src = await this.download.promise;
      if (id !== this.playRequest) return;
      this.endDownload();
      this.setStatus(`Playing "${track.title}"`);
      this.remember(track);
      await this.onPlay(src, track.artist ? `${track.artist} — ${track.title}` : track.title, track);
      this.toggle(false);
    } catch (err) {
      if (id !== this.playRequest || err.name === 'AbortError') return;
      this.endDownload();
      this.setStatus(err.message, true);
      this.onError(err.message);
    }
  }

  get busy() { return !!this.download; }

  cancel({ quiet = false } = {}) {
    if (!this.download) return;
    this.download.cancel();
    this.playRequest++;
    this.endDownload();
    if (!quiet) this.setStatus('Download cancelled');
  }

  endDownload() {
    this.download = null;
    this.list.querySelector('.loading')?.classList.remove('loading');
    this.progressBar.hidden = true;
    this.onProgress?.(null);
  }

  showProgress(track, p) {
    const li = [...this.list.children].find((l) => l.dataset.url === track.url);
    if (li) { li.classList.add('loading'); li.style.setProperty('--p', `${p.percent}%`); }
    this.progressBar.hidden = false;
    this.progressBar.firstElementChild.style.width = `${p.percent}%`;
    this.setStatus(progressText(this.fetching, track, p));
    this.onProgress?.(track, p);
  }

  get hasQueue() { return this.results.length > 1; }

  showRecent() {
    this.request++;   // drop any search still in flight
    this.view = 'recent';
    this.results = [...this.recent];
    this.current = -1;
    this.render();
    this.setStatus(this.recent.length ? 'Recently played — click one to play it again' : this.emptyText);
    this.root.classList.add('recent-view');
    this.root.classList.toggle('has-recent', this.recent.length > 0);
  }

  // Newest first, no duplicates. Only what the list needs is kept.
  remember(track) {
    const { url, title, artist, duration, artwork } = track;
    this.recent = [{ url, title, artist, duration, artwork }, ...this.recent.filter((t) => t.url !== url)].slice(0, RECENT_MAX);
    try { localStorage.setItem(this.recentKey, JSON.stringify(this.recent)); } catch { /* storage unavailable */ }
  }

  clearRecent() {
    if (!confirm('Forget the recently played tracks?')) return;
    this.recent = [];
    try { localStorage.removeItem(this.recentKey); } catch { /* storage unavailable */ }
    this.showRecent();
  }

  // Called by the player's next / previous buttons and when a track ends. Returns false at the end of the list.
  playNext() {
    if (this.current < 0 || this.current >= this.results.length - 1) return false;
    this.play(this.current + 1);
    return true;
  }

  playPrev() {
    if (this.current <= 0) return false;
    this.play(this.current - 1);
    return true;
  }

  render() {
    this.list.replaceChildren(...this.results.map((t, i) => {
      const li = document.createElement('li');
      li.dataset.url = t.url;
      li.classList.toggle('current', i === this.current);
      const art = document.createElement(t.artwork ? 'img' : 'div');
      art.className = 'sc-art';
      if (t.artwork) { art.src = t.artwork; art.alt = ''; art.loading = 'lazy'; }
      const text = document.createElement('div');
      text.className = 'sc-text';
      const title = document.createElement('strong');
      title.textContent = t.title;
      const artist = document.createElement('span');
      artist.textContent = t.artist;
      text.append(title, artist);
      const time = document.createElement('time');
      time.textContent = formatTime(t.duration);
      li.append(art, text, time);
      li.onclick = () => this.play(i);
      return li;
    }));
  }

  setStatus(text, error = false) {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
  }
}

// GET /api/<site>/fetch as an event stream: `progress` events, then `done` or `failed`.
function download(site, url, onProgress) {
  let source, fail;
  const promise = new Promise((resolve, reject) => {
    fail = reject;
    source = new EventSource(`/api/${site}/fetch?url=${encodeURIComponent(url)}`);
    source.addEventListener('progress', (e) => onProgress(JSON.parse(e.data)));
    source.addEventListener('done', (e) => { source.close(); resolve(JSON.parse(e.data).src); });
    source.addEventListener('failed', (e) => { source.close(); reject(new Error(JSON.parse(e.data).error)); });
    source.onerror = () => { source.close(); reject(new Error('Lost the connection to the local server. Is the dev server ("npm run dev") running?')); };
  });
  return {
    promise,
    cancel() { source.close(); fail(Object.assign(new Error('Cancelled'), { name: 'AbortError' })); },
  };
}

// "Downloading (video) 45% · 120.3 MB of 280.1 MB · 8.2 MB/s · 0:18 left"
export function progressText(verb, track, p) {
  const pct = `${Math.floor(p.percent)}%`;
  if (p.stage === 'starting') return `${verb} "${track.title}"…`;
  if (p.stage === 'merging') return `Merging video and sound… ${pct}`;
  if (p.stage === 'finishing') return `Finishing… ${pct}`;
  const part = p.stage === 'video' ? ' (video)' : p.stage === 'sound' ? ' (sound)' : '';
  const size = p.total ? ` · ${mb(p.bytes)} of ${mb(p.total)}` : '';
  const speed = p.speed ? ` · ${mb(p.speed)}/s` : '';
  const eta = p.eta ? ` · ${formatTime(p.eta)} left` : '';
  return `${verb}${part} ${pct}${size}${speed}${eta}`;
}

const mb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${((bytes ?? 0) / 1e6).toFixed(1)} MB`);

function loadRecent(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? []; } catch { return []; }
}

async function api(path) {
  let res;
  try {
    res = await fetch(path);
  } catch {
    throw new Error('Could not reach the local server. Is the dev server ("npm run dev") running?');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

function formatTime(seconds) {
  if (!seconds) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
