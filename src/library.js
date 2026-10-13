// Scene library: browse every scene with a rendered preview, filter by category or search,
// mark favourites, choose which scenes auto-switch rotates through, and keep your own shaders.

import { CATEGORIES } from './scenes.js';

const PREFS_KEY = 'hallucinate.library';
const USER_KEY = 'hallucinate.userScenes';
// Stand-in audio for the previews, so they look like the scene mid-song rather than silent.
const THUMB_UNIFORMS = { uTime: 14, uBass: 0.5, uMid: 0.5, uHigh: 0.5, uLevel: 0.6, uBeat: 0.4, uHue: 0, uBright: 0.5, uMood: 0.5 };

export class SceneLibrary {
  constructor({ scenes, renderer, keyFor, onPick, onEdit, onDelete }) {
    this.scenes = scenes;          // the app's live scene list; user scenes get appended to it
    this.renderer = renderer;
    this.keyFor = keyFor;
    this.onPick = onPick;
    this.onEdit = onEdit;
    this.onDelete = onDelete;
    this.prefs = { favs: [], off: [], ...loadJSON(PREFS_KEY, {}) };
    this.filter = 'All';
    this.query = '';
    this.current = 0;
    this.thumbs = new Map();       // scene -> image URL
    this.pending = false;

    this.root = document.getElementById('library');
    this.grid = document.getElementById('lib-grid');
    this.filters = document.getElementById('lib-filters');
    this.search = document.getElementById('lib-search');
    this.count = document.getElementById('lib-count');
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      if (this.query) this.filter = 'All';   // search everything, not just the open tab
      this.render();
    });
    document.getElementById('lib-close').onclick = () => this.toggle(false);
    this.root.addEventListener('keydown', (e) => {
      if (e.target === this.search) e.stopPropagation();   // typing shouldn't trigger shortcuts
      if (e.key === 'Escape') { e.stopPropagation(); this.toggle(false); }
    });
  }

  get isOpen() { return !this.root.hidden; }

  toggle(open = !this.isOpen) {
    this.root.hidden = !open;
    if (!open && this.root.contains(document.activeElement)) document.activeElement.blur();   // hand the keyboard back to the shortcuts
    if (open) this.render();
  }

  // Scenes the library lists: the visuals, the game and your saved scenes (not the editor slots).
  listed() {
    return this.scenes.map((s, i) => ({ s, i })).filter(({ s }) => !s.removed && (!s.kind || s.kind === 'game'));
  }

  isFav(s) { return this.prefs.favs.includes(s.name); }
  inRotation(s) { return !this.prefs.off.includes(s.name); }

  // Indices auto-switch may pick from. Favourites count twice, so they come up more often.
  rotation() {
    const visual = this.listed().filter(({ s }) => !s.kind);
    const on = visual.filter(({ s }) => this.inRotation(s));
    return (on.length ? on : visual).flatMap(({ s, i }) => (this.isFav(s) ? [i, i] : [i]));
  }

  setCurrent(i) {
    this.current = i;
    if (this.isOpen) for (const card of this.grid.children) card.classList.toggle('active', Number(card.dataset.index) === i);
  }

  invalidate(scene) {
    this.thumbs.delete(scene);
  }

  togglePref(list, s) {
    const names = this.prefs[list];
    this.prefs[list] = names.includes(s.name) ? names.filter((n) => n !== s.name) : [...names, s.name];
    saveJSON(PREFS_KEY, this.prefs);
    this.render();
  }

  render() {
    const all = this.listed();
    const hasMine = all.some(({ s }) => s.user);
    const tabs = ['All', '★ Favourites', '⚙ Tweakable', ...CATEGORIES, 'Game', ...(hasMine ? ['Mine'] : [])];
    if (!tabs.includes(this.filter)) this.filter = 'All';
    this.filters.replaceChildren(...tabs.map((tab) => {
      const b = document.createElement('button');
      b.textContent = tab;
      b.classList.toggle('active', tab === this.filter);
      b.onclick = () => { this.filter = tab; this.render(); };
      return b;
    }));

    const shown = all.filter(({ s }) => {
      if (this.filter === '★ Favourites' && !this.isFav(s)) return false;
      if (this.filter === '⚙ Tweakable' && !s.params?.length) return false;
      if (!['All', '★ Favourites', '⚙ Tweakable'].includes(this.filter) && s.cat !== this.filter) return false;
      return !this.query || `${s.name} ${s.cat} ${s.desc}`.toLowerCase().includes(this.query);
    });
    const rotating = all.filter(({ s }) => !s.kind && this.inRotation(s)).length;
    this.count.textContent = `${shown.length} of ${all.length} scenes · ${rotating} in auto-switch rotation`;
    this.grid.replaceChildren(...shown.map(({ s, i }) => this.card(s, i)));
    if (!shown.length) this.grid.append(Object.assign(document.createElement('p'), { className: 'lib-empty', textContent: 'No scenes match.' }));
    this.renderThumbs();
  }

  card(s, i) {
    const li = document.createElement('li');
    li.className = 'lib-card';
    li.dataset.index = i;
    li.classList.toggle('active', i === this.current);
    li.classList.toggle('off', !s.kind && !this.inRotation(s));

    const thumb = document.createElement('button');
    thumb.className = 'lib-thumb';
    thumb.title = `Play ${s.name}`;
    const img = document.createElement('img');
    img.alt = '';
    if (this.thumbs.has(s)) img.src = this.thumbs.get(s);
    thumb.append(img);
    const key = this.keyFor(i);
    if (key) thumb.append(Object.assign(document.createElement('kbd'), { textContent: key }));
    if (s.params?.length) {
      thumb.append(Object.assign(document.createElement('span'), {
        className: 'lib-live', textContent: `⚙ ${s.params.length}`,
        title: `Live parameters (P): ${s.params.map((p) => p.label).join(', ')}`,
      }));
    }
    thumb.onclick = () => this.onPick(i);

    const info = document.createElement('div');
    info.className = 'lib-info';
    const title = document.createElement('strong');
    title.textContent = s.name;
    const fav = button(this.isFav(s) ? '★' : '☆', this.isFav(s) ? 'Remove from favourites' : 'Favourite — comes up twice as often in auto-switch', () => this.togglePref('favs', s));
    fav.className = 'lib-fav';
    fav.classList.toggle('on', this.isFav(s));
    const head = document.createElement('div');
    head.className = 'lib-head';
    head.append(title, fav);
    const desc = document.createElement('span');
    desc.textContent = `${s.cat} · ${s.desc}${s.edited ? ' · edited by you' : ''}`;
    info.append(head, desc);

    const tools = document.createElement('div');
    tools.className = 'lib-tools';
    if (!s.kind) {
      const label = document.createElement('label');
      label.title = 'Include this scene when auto-switch picks the next one';
      const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: this.inRotation(s) });
      box.onchange = () => this.togglePref('off', s);
      label.append(box, ' Auto-switch');
      tools.append(label, button('Edit code', 'Play this scene and open its code (E)', () => this.onEdit(i)));
    }
    if (s.user) tools.append(button('Delete', 'Delete this scene from the library', () => this.onDelete(i)));
    li.append(thumb, info, tools);
    return li;
  }

  // Previews render a couple per frame so opening the library doesn't stall the visuals.
  renderThumbs() {
    if (this.pending) return;
    const next = () => {
      const missing = [...this.grid.children].filter((c) => c.dataset.index && !this.thumbs.has(this.scenes[c.dataset.index]));
      if (!this.isOpen || !missing.length) { this.pending = false; return; }
      for (const card of missing.slice(0, 2)) {
        const s = this.scenes[card.dataset.index];
        const url = toImageUrl(this.renderer.snapshot(Number(card.dataset.index), THUMB_UNIFORMS));
        this.thumbs.set(s, url);
        card.querySelector('img').src = url;
      }
      requestAnimationFrame(next);
    };
    this.pending = true;
    requestAnimationFrame(next);
  }
}

// Saved user scenes: [{ name, body }]
export const loadUserScenes = () => loadJSON(USER_KEY, []);
export const saveUserScenes = (list) => saveJSON(USER_KEY, list);

function button(text, title, onclick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = title;
  b.onclick = onclick;
  return b;
}

const canvas = document.createElement('canvas');
function toImageUrl(imageData) {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
