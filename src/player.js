// Panel audio player: play/pause, seek, ±10 s, previous/next track, loop, volume and tempo.
// Files and SoundCloud tracks play through the <audio> element (tempo = playbackRate);
// the demo beat gets play/pause, volume and tempo (its BPM). Volume and pitch mode are remembered.

const STORAGE_KEY = 'hallucinate.player';
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ICONS = {
  play: svg('M8 5.5v13l11-6.5z'),
  pause: svg('M7 5h3.5v14H7zM13.5 5H17v14h-3.5z'),
  prev: svg('M6 5h2v14H6zM20 5v14L9 12z'),
  next: svg('M16 5h2v14h-2zM4 5v14l11-7z'),
  back: svg('M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z'),
  fwd: svg('M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z'),
  loop: svg('M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z'),
  vol: svg('M4 9v6h4l5 4V5L8 9zm12.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z'),
  mute: svg('M4 9v6h4l5 4V5L8 9zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z'),
};

export class Player {
  constructor({ el, audio, onTogglePlay, onPrev, onNext }) {
    this.el = el;
    this.audio = audio;
    this.onTogglePlay = onTogglePlay;
    this.onPrev = onPrev;
    this.onNext = onNext;
    this.mode = null;          // 'element' | 'demo' | null (mic / tab audio: nothing to control)
    this.scrubbing = false;
    const saved = load();
    this.volume = saved.volume ?? 0.8;
    this.muted = false;
    this.pitchFollows = saved.pitchFollows ?? false;
    this.rate = 1;

    const $ = (id) => document.getElementById(id);
    this.root = $('transport');
    this.ui = {
      play: $('tp-play'), prev: $('tp-prev'), next: $('tp-next'), back: $('tp-back'), fwd: $('tp-fwd'), loop: $('tp-loop'),
      seek: $('tp-seek'), cur: $('tp-cur'), dur: $('tp-dur'), seekRow: $('tp-seek-row'),
      mute: $('tp-mute'), volume: $('tp-volume'), volVal: $('tp-vol-val'),
      rate: $('tp-rate'), rateVal: $('tp-rate-val'), pitch: $('tp-pitch'),
    };
    const u = this.ui;
    for (const k of ['play', 'prev', 'next', 'back', 'fwd', 'loop']) u[k].innerHTML = ICONS[k];

    u.play.onclick = () => this.onTogglePlay();
    u.prev.onclick = () => this.prev();
    u.next.onclick = () => this.onNext();
    u.back.onclick = () => this.skip(-10);
    u.fwd.onclick = () => this.skip(10);
    u.loop.onclick = () => { el.loop = !el.loop; u.loop.classList.toggle('active', el.loop); };

    u.seek.addEventListener('pointerdown', () => { this.scrubbing = true; });
    window.addEventListener('pointerup', () => { this.scrubbing = false; });
    u.seek.addEventListener('input', () => {
      if (isFinite(el.duration)) el.currentTime = (u.seek.value / 1000) * el.duration;
      this.showTime();
    });

    u.volume.value = this.volume;
    u.volume.addEventListener('input', () => this.setVolume(parseFloat(u.volume.value)));
    u.mute.onclick = () => this.toggleMute();

    u.rate.addEventListener('input', () => this.setRate(parseFloat(u.rate.value)));
    u.rate.addEventListener('dblclick', () => this.setRate(1));
    u.rateVal.onclick = () => this.setRate(1);
    u.pitch.checked = this.pitchFollows;
    u.pitch.addEventListener('change', () => { this.pitchFollows = u.pitch.checked; this.applyRate(); this.save(); });

    for (const ev of ['play', 'pause', 'playing']) el.addEventListener(ev, () => this.setPlaying(!el.paused));
    for (const ev of ['timeupdate', 'durationchange', 'loadedmetadata']) el.addEventListener(ev, () => this.showTime());
    el.addEventListener('loadedmetadata', () => this.applyRate());   // a new src resets playbackRate

    this.setVolume(this.volume);
    this.setRate(1);
    this.setMode(null);
  }

  // hasQueue: SoundCloud results can be stepped through; a single local file can't.
  setMode(mode, { hasQueue = false } = {}) {
    this.mode = mode;
    this.root.hidden = !mode;
    this.root.classList.toggle('demo', mode === 'demo');
    this.ui.prev.disabled = mode !== 'element';
    this.ui.next.disabled = !hasQueue;
    this.applyRate();
    this.showTime();
  }

  setPlaying(playing) {
    this.ui.play.innerHTML = playing ? ICONS.pause : ICONS.play;
    this.ui.play.title = `${playing ? 'Pause' : 'Play'} (Space)`;
  }

  prev() {
    if (this.el.currentTime > 3 || !this.onPrev()) this.el.currentTime = 0;   // restart, like most players
  }

  skip(seconds) {
    if (this.mode !== 'element' || !isFinite(this.el.duration)) return;
    this.el.currentTime = Math.min(this.el.duration - 0.1, Math.max(0, this.el.currentTime + seconds));
    this.showTime();
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.volume > 0) this.muted = false;
    this.ui.volume.value = this.volume;
    this.applyVolume();
    this.save();
  }

  changeVolume(delta) { this.setVolume(this.volume + delta); return this.volume; }

  toggleMute() {
    this.muted = !this.muted;
    this.applyVolume();
    return this.muted;
  }

  applyVolume() {
    const v = this.muted ? 0 : this.volume;
    this.audio.setVolume(v * v);   // squared feels closer to even loudness steps
    this.ui.mute.innerHTML = v ? ICONS.vol : ICONS.mute;
    this.ui.mute.title = this.muted ? 'Unmute (M)' : 'Mute (M)';
    this.ui.volVal.textContent = `${Math.round(v * 100)}%`;
    this.ui.volume.style.setProperty('--p', `${v * 100}%`);
  }

  setRate(rate) {
    this.rate = Math.round(Math.min(2, Math.max(0.5, rate)) * 100) / 100;
    this.ui.rate.value = this.rate;
    this.applyRate();
    return this.rate;
  }

  changeRate(delta) { return this.setRate(this.rate + delta); }

  applyRate() {
    this.el.playbackRate = this.rate;
    this.el.preservesPitch = !this.pitchFollows;
    this.audio.setDemoRate(this.rate);
    const u = this.ui;
    u.rateVal.textContent = `${this.rate.toFixed(2)}×`;
    u.rateVal.title = this.mode === 'demo' ? `${Math.round(124 * this.rate)} BPM · click to reset` : 'Click to reset to 1×';
    u.rate.style.setProperty('--p', `${((this.rate - 0.5) / 1.5) * 100}%`);
    u.pitch.disabled = this.mode === 'demo';
  }

  showTime() {
    const { el, ui } = this;
    const d = el.duration;
    if (!this.scrubbing) ui.seek.value = isFinite(d) && d ? (el.currentTime / d) * 1000 : 0;
    ui.seek.style.setProperty('--p', `${ui.seek.value / 10}%`);
    ui.cur.textContent = formatTime(el.currentTime);
    ui.dur.textContent = isFinite(d) ? formatTime(d) : '–:––';
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: this.volume, pitchFollows: this.pitchFollows })); } catch { /* storage unavailable */ }
  }
}

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { return {}; }
}

function formatTime(seconds) {
  const s = Math.floor(seconds || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
