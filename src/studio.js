// Studio: run a show like OBS's Studio Mode. Build a list of show scenes (a library scene plus its
// parameter values and look), pick one into Preview, Take it live to Program with a cut or a fade,
// and send Program to a projector window. Autopilot steps through the list on the beat.

import { Renderer } from './renderer.js';

const STORAGE_KEY = 'hallucinate.show';

export class Studio {
  constructor({ scenes, output, media, listScenes, capture, take, cueUniforms, programName, onDockChange, toast }) {
    Object.assign(this, { scenes, output, media, listScenes, capture, takeCue: take, cueUniforms, programName, onDockChange, toast });
    this.paramTab = 'preview';   // which scene the Parameters dock edits
    const saved = load();
    this.cues = saved.cues ?? [];
    this.mode = saved.mode ?? 'fade';
    this.seconds = saved.seconds ?? 1.5;
    this.autopilot = { on: false, beats: saved.autoBeats ?? 32 };   // never starts a show on its own after a reload
    this.previewId = this.cues[0]?.id ?? null;
    this.programId = null;
    this.beatCount = 0;
    this.master = 1;
    this.masterTarget = 1;
    this.lastLevel = 1;
    this.previewRenderer = null;

    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.root = $('studio');
    this.list = $('st-cues');
    $('st-close').onclick = () => this.toggle(false);
    $('st-take').onclick = () => this.take();
    $('st-cut').onclick = () => this.setMode('cut');
    $('st-fade').onclick = () => this.setMode('fade');
    $('st-dur').value = this.seconds;
    $('st-dur').oninput = () => { this.seconds = Number($('st-dur').value); this.showTransition(); this.save(); };
    $('st-add').onchange = () => this.addFromSelect();
    $('st-auto').onchange = () => { this.autopilot.on = $('st-auto').checked; this.beatCount = 0; };
    $('st-auto-beats').value = this.autopilot.beats;
    $('st-auto-beats').onchange = () => { this.autopilot.beats = Number($('st-auto-beats').value); this.save(); };
    $('st-master').oninput = () => this.setMaster(Number($('st-master').value));
    $('st-blackout').onclick = () => this.blackout();
    $('st-detect').onclick = () => this.detectScreens();
    $('st-open').onclick = () => this.openProjector();
    $('st-identify').onclick = () => this.output.identify();
    $('st-pp-preview').onclick = () => this.setParamTab('preview');
    $('st-pp-program').onclick = () => this.setParamTab('program');
    this.root.addEventListener('keydown', (e) => {
      if (e.target.matches('input[type=text], select')) e.stopPropagation();
    });
    this.showTransition();
  }

  get isOpen() { return !this.root.hidden; }
  get preview() { return this.cues.find((c) => c.id === this.previewId) ?? null; }
  get program() { return this.cues.find((c) => c.id === this.programId) ?? null; }

  // The main canvas becomes the Program monitor and the Parameters overlay becomes a dock.
  toggle(open = !this.isOpen) {
    if (open === this.isOpen) return;
    this.root.hidden = !open;
    const canvas = this.$('gl'), params = this.$('params');
    if (open) {
      this.$('st-program').append(canvas);
      this.$('st-params-dock').append(params);
      if (!this.previewRenderer) {
        this.previewRenderer = new Renderer(this.$('preview-gl'), this.scenes);
        this.previewRenderer.setMedia(this.media);
      }
      this.previewRenderer.setScale(0.6);
      this.render();
    } else {
      document.body.prepend(canvas);
      document.body.append(params);
      if (this.root.contains(document.activeElement)) document.activeElement.blur();
      this.onDockChange();
    }
  }

  setParamTab(tab) {
    this.paramTab = tab;
    this.render();
  }

  // ---------- Show scenes ----------

  sceneIndex(cue) {
    return this.scenes.findIndex((s) => s.name === cue?.scene && !s.removed);
  }

  addFromSelect() {
    const select = this.$('st-add');
    const value = select.value;
    select.value = '';
    if (!value) return;
    const base = this.capture();
    const cue = value === '@program' ? base : { ...base, scene: value, name: value, values: {} };
    this.add(cue);
  }

  add(cue) {
    cue = { ...cue, id: crypto.randomUUID() };
    this.cues.push(cue);
    this.previewId = cue.id;
    this.changed();
    return cue;
  }

  move(cue, dir) {
    const i = this.cues.indexOf(cue), j = i + dir;
    if (j < 0 || j >= this.cues.length) return;
    [this.cues[i], this.cues[j]] = [this.cues[j], this.cues[i]];
    this.changed();
  }

  rename(cue) {
    const name = prompt('Name for this show scene:', cue.name)?.trim();
    if (name) { cue.name = name; this.changed(); }
  }

  updateFromProgram(cue) {
    const { scene, values, look } = this.capture();
    Object.assign(cue, { scene, values, look });
    this.changed();
    this.toast(`"${cue.name}" now holds what's on Program`);
  }

  duplicate(cue) {
    const copy = { ...structuredClone(cue), id: crypto.randomUUID(), name: `${cue.name} copy` };
    this.cues.splice(this.cues.indexOf(cue) + 1, 0, copy);
    this.changed();
  }

  remove(cue) {
    if (!confirm(`Remove "${cue.name}" from the show?`)) return;
    this.cues = this.cues.filter((c) => c !== cue);
    if (this.previewId === cue.id) this.previewId = this.cues[0]?.id ?? null;
    if (this.programId === cue.id) this.programId = null;
    this.changed();
  }

  setPreview(cue) {
    if (!cue) return;
    this.previewId = cue.id;
    this.render();
  }

  stepPreview(dir) {
    if (!this.cues.length) return;
    const i = this.cues.indexOf(this.preview);
    this.setPreview(this.cues[(i + dir + this.cues.length) % this.cues.length]);
  }

  // Preview -> Program. Afterwards Preview moves on to the next scene, ready for the next take.
  take(cue = this.preview) {
    if (!cue) return this.toast('Add a scene to the show first (+ Add scene…)');
    if (this.sceneIndex(cue) < 0) return this.toast(`"${cue.name}" uses a scene that no longer exists`);
    this.takeCue(cue, this.mode === 'cut' ? 0 : this.seconds);
    this.programId = cue.id;
    this.beatCount = 0;
    const next = this.cues[(this.cues.indexOf(cue) + 1) % this.cues.length];
    if (next) this.previewId = next.id;
    this.render();
  }

  onBeat() {
    if (!this.autopilot.on || this.cues.length < 2) return;
    if (++this.beatCount >= this.autopilot.beats) {
      const i = this.cues.indexOf(this.program);
      this.take(this.cues[(i + 1) % this.cues.length]);
    }
  }

  // ---------- Transition & master ----------

  setMode(mode) {
    this.mode = mode;
    this.showTransition();
    this.save();
  }

  showTransition() {
    this.$('st-cut').classList.toggle('active', this.mode === 'cut');
    this.$('st-fade').classList.toggle('active', this.mode === 'fade');
    this.$('st-dur').disabled = this.mode === 'cut';
    this.$('st-dur-val').textContent = `${this.seconds.toFixed(1)} s`;
  }

  setMaster(level) {
    this.masterTarget = level;
    if (level > 0) this.lastLevel = level;
    this.showMaster();
  }

  blackout() {
    this.setMaster(this.masterTarget > 0 ? 0 : this.lastLevel);
  }

  showMaster() {
    this.$('st-master').value = this.masterTarget;
    this.$('st-master-val').textContent = `${Math.round(this.masterTarget * 100)}%`;
    this.$('st-blackout').classList.toggle('active', this.masterTarget === 0);
    this.$('st-blackout').textContent = this.masterTarget === 0 ? 'Blacked out — click to restore' : 'Blackout';
  }

  // The master fader glides over the transition time (a cut still takes 0.1 s, to avoid a pop).
  update(dt) {
    const step = dt / Math.max(0.1, this.mode === 'cut' ? 0.1 : this.seconds);
    const d = this.masterTarget - this.master;
    this.master += Math.sign(d) * Math.min(Math.abs(d), step);
  }

  // ---------- Monitors ----------

  renderPreview(base, huePhase) {
    if (!this.isOpen) return;
    const cue = this.preview;
    const index = this.sceneIndex(cue);
    if (index < 0) return this.previewRenderer.render({ ...base, scene: -1, prevScene: -1, mix: 1, master: 0 });
    this.previewRenderer.setParams(index, this.cueUniforms(cue, index));
    const look = cue.look;
    this.previewRenderer.render({
      ...base, scene: index, prevScene: -1, mix: 1, master: 1,
      hue: look.hue + huePhase,
      feedback: Math.min(0.97, look.trails * (this.scenes[index].trails ?? 1)),
      aberration: look.aberration,
    });
  }

  // ---------- Projector ----------

  async detectScreens() {
    try {
      const screens = await this.output.screens();
      const select = this.$('st-screen');
      this.screens = screens;
      select.replaceChildren(new Option('New window — drag it to the projector', ''), ...screens.map((s, i) =>
        new Option(`${s.label || `Display ${i + 1}`} · ${s.width}×${s.height}${s.isPrimary ? ' (this screen)' : ''}`, i)));
      const external = screens.findIndex((s) => !s.isPrimary);
      if (external >= 0) select.value = external;
      this.toast(`Found ${screens.length} display${screens.length > 1 ? 's' : ''}`);
    } catch (err) {
      this.toast(err.name === 'NotAllowedError' ? 'Display access was blocked — allow "Window management" for this site.' : err.message, 6000);
    }
  }

  openProjector() {
    try {
      this.output.open(this.screens?.[this.$('st-screen').value]);
      this.toast('Projector opened — double-click it (or press F there) for fullscreen', 5000);
    } catch (err) {
      this.toast(err.message, 6000);
    }
  }

  showOutputs(outputs) {
    if (outputs[0]?.h) this.root.style.setProperty('--aspect', outputs[0].w / outputs[0].h);   // monitors match the projector
    const el = this.$('st-out-status');
    el.classList.toggle('live', outputs.length > 0);
    el.textContent = outputs.length
      ? `● ${outputs.length === 1 ? 'Projector' : `${outputs.length} projectors`} live · ${outputs.map((o) => `${o.w}×${o.h}${o.fullscreen ? ' fullscreen' : ''} · ${o.fps} fps`).join(' | ')}`
      : '○ No projector connected';
  }

  // ---------- UI ----------

  changed() {
    this.save();
    this.render();
  }

  render() {
    if (!this.isOpen) return;
    const select = this.$('st-add');
    select.replaceChildren(new Option('+ Add scene…', ''), new Option('What\'s on Program now', '@program'),
      ...this.listScenes().map(({ s }) => new Option(s.name, s.name)));

    this.list.replaceChildren(...this.cues.map((cue, n) => {
      const li = document.createElement('li');
      li.className = 'cue';
      li.classList.toggle('preview', cue.id === this.previewId);
      li.classList.toggle('program', cue.id === this.programId);
      const missing = this.sceneIndex(cue) < 0;
      li.classList.toggle('missing', missing);
      li.title = 'Click: preview · double-click: take live';
      li.onclick = (e) => { if (!e.target.closest('button')) this.setPreview(cue); };
      li.ondblclick = (e) => { if (!e.target.closest('button')) this.take(cue); };

      const num = document.createElement('kbd');
      num.textContent = n < 9 ? n + 1 : '·';
      const swatch = document.createElement('i');
      swatch.className = 'cue-swatch';
      swatch.style.background = `hsl(${Math.round((cue.look.hue % 1) * 360)} 80% 60%)`;
      const text = document.createElement('div');
      text.className = 'cue-text';
      const name = document.createElement('strong');
      name.textContent = cue.name;
      const sub = document.createElement('span');
      sub.textContent = missing ? `missing scene "${cue.scene}"` : cue.scene;
      text.append(name, sub);
      const tools = document.createElement('div');
      tools.className = 'cue-tools';
      tools.append(
        tool('▲', 'Move up', () => this.move(cue, -1)),
        tool('▼', 'Move down', () => this.move(cue, 1)),
        tool('✎', 'Rename', () => this.rename(cue)),
        tool('⤓', 'Update from Program: store the scene, parameters and look that are live now', () => this.updateFromProgram(cue)),
        tool('⧉', 'Duplicate', () => this.duplicate(cue)),
        tool('×', 'Remove', () => this.remove(cue)),
      );
      li.append(num, swatch, text, tools);
      return li;
    }));
    if (!this.cues.length) {
      const empty = document.createElement('li');
      empty.className = 'cue-empty';
      empty.textContent = 'No show scenes yet. Use "+ Add scene…" — or set up a look on Program and add "What\'s on Program now".';
      this.list.append(empty);
    }
    this.$('st-preview-name').textContent = this.preview?.name ?? '—';
    this.$('st-pp-preview').classList.toggle('active', this.paramTab === 'preview');
    this.$('st-pp-program').classList.toggle('active', this.paramTab === 'program');
    this.onDockChange();
    this.$('st-program-name').textContent = this.program?.name ?? this.programName();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ cues: this.cues, mode: this.mode, seconds: this.seconds, autoBeats: this.autopilot.beats }));
    } catch { /* storage unavailable */ }
  }
}

function tool(text, title, onclick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = title;
  b.onclick = onclick;
  return b;
}

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { return {}; }
}
