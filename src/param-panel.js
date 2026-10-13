// The Parameters overlay: one control per `@param` of the scene on screen.
// Sliders for numbers (with an editable value), checkboxes for bools, colour pickers for colours.

const AXES = ['x', 'y', 'z', 'w'];

export class ParamPanel {
  constructor({ onChange, onReset }) {
    this.onChange = onChange;
    this.onReset = onReset;
    this.root = document.getElementById('params');
    this.list = document.getElementById('params-list');
    this.title = document.getElementById('params-title');
    this.signature = '';
    try { this.collapsed = localStorage.getItem('hallucinate.paramsCollapsed') === '1'; } catch { this.collapsed = false; }
    this.root.classList.toggle('collapsed', this.collapsed);
    document.getElementById('params-reset').onclick = () => this.onReset();
    document.getElementById('params-collapse').onclick = () => this.toggleCollapsed();
    this.root.addEventListener('keydown', (e) => {
      if (e.target.type === 'number' || e.target.type === 'text') e.stopPropagation();   // typing a value
    });
    this.makeDraggable();
  }

  // Drag the panel by its header; it remembers where you put it. Double-click the header to send it
  // back to its corner. (Inside the studio it's a dock and stays put.)
  makeDraggable() {
    const header = this.root.querySelector('header');
    header.title = 'Drag to move · double-click to put it back';
    header.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button') || this.docked) return;
      const r = this.root.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      header.setPointerCapture(e.pointerId);
      this.root.classList.add('dragging');
      const move = (ev) => this.place(ev.clientX - dx, ev.clientY - dy);
      const up = () => {
        header.removeEventListener('pointermove', move);
        header.removeEventListener('pointerup', up);
        this.root.classList.remove('dragging');
        try { localStorage.setItem('hallucinate.paramsPos', JSON.stringify(this.pos)); } catch { /* storage unavailable */ }
      };
      header.addEventListener('pointermove', move);
      header.addEventListener('pointerup', up);
    });
    header.addEventListener('dblclick', (e) => { if (!e.target.closest('button') && !this.docked) this.resetPosition(); });
    window.addEventListener('resize', () => { if (this.pos) this.place(this.pos.x, this.pos.y); });
    try { this.pos = JSON.parse(localStorage.getItem('hallucinate.paramsPos')); } catch { this.pos = null; }
    if (this.pos) requestAnimationFrame(() => this.place(this.pos.x, this.pos.y));
  }

  get docked() { return !!this.root.closest('.params-dock'); }

  // Keeps at least the header on screen.
  place(x, y) {
    const w = this.root.offsetWidth || 270;
    x = Math.min(Math.max(0, x), window.innerWidth - Math.min(w, 120));
    y = Math.min(Math.max(0, y), window.innerHeight - 40);
    this.pos = { x, y };
    Object.assign(this.root.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
    this.root.classList.add('moved');
  }

  resetPosition() {
    this.pos = null;
    Object.assign(this.root.style, { left: '', top: '', right: '', bottom: '' });
    this.root.classList.remove('moved');
    try { localStorage.removeItem('hallucinate.paramsPos'); } catch { /* storage unavailable */ }
  }

  get visible() { return !this.root.hidden; }

  toggleCollapsed() {
    this.collapsed = !this.collapsed;
    this.root.classList.toggle('collapsed', this.collapsed);
    try { localStorage.setItem('hallucinate.paramsCollapsed', this.collapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  }

  // Rebuilds only when the set of parameters changes, so recompiling while you type keeps the controls steady.
  show(title, specs, values) {
    this.root.hidden = !specs.length;
    this.title.textContent = title;
    const signature = JSON.stringify(specs);
    if (signature === this.signature && this.list.children.length) return this.update(specs, values);
    this.signature = signature;
    this.specs = specs;
    this.list.replaceChildren(...specs.map((s) => this.row(s, values[s.name])));
  }

  update(specs, values) {
    specs.forEach((s, i) => this.list.children[i]?.setValue?.(values[s.name]));
  }

  row(spec, value) {
    const row = document.createElement('div');
    row.className = 'param';
    const label = document.createElement('span');
    label.className = 'param-label';
    label.textContent = spec.label;
    label.title = spec.name;
    row.append(label);

    if (spec.type === 'bool') {
      const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: value });
      box.onchange = () => this.onChange(spec, box.checked);
      row.classList.add('param-bool');
      row.prepend(box);
      row.setValue = (v) => { box.checked = v; };
      return row;
    }

    if (spec.color) {
      let current = [...value];
      const picker = Object.assign(document.createElement('input'), { type: 'color', value: toHex(current) });
      const hex = document.createElement('code');
      hex.textContent = picker.value;
      picker.oninput = () => {
        current = [...fromHex(picker.value), ...current.slice(3)];
        hex.textContent = picker.value;
        this.onChange(spec, current);
      };
      const head = document.createElement('div');
      head.className = 'param-head';
      head.append(label, hex, picker);
      row.replaceChildren(head);
      if (spec.type === 'vec4') {
        row.append(this.slider({ ...spec, min: 0, max: 1, step: 0.01 }, current[3], 'alpha', (a) => { current = [...current.slice(0, 3), a]; this.onChange(spec, current); }));
      }
      row.setValue = (v) => { current = [...v]; picker.value = toHex(v); hex.textContent = picker.value; };
      return row;
    }

    if (spec.type === 'float') {
      const s = this.slider(spec, value, null, (v) => this.onChange(spec, v));
      const head = document.createElement('div');
      head.className = 'param-head';
      head.append(label, s.field);
      row.replaceChildren(head, s);
      row.setValue = s.setValue;
      return row;
    }

    let current = [...value];   // vec2 / vec3 / vec4: one slider per component
    const sliders = current.map((v, i) => this.slider(spec, v, AXES[i], (x) => {
      current = current.map((c, j) => (j === i ? x : c));
      this.onChange(spec, current);
    }));
    row.append(...sliders);
    row.setValue = (v) => { current = [...v]; sliders.forEach((s, i) => s.setValue(v[i])); };
    return row;
  }

  // A range slider plus an editable number. Returns the slider row; `.field` is the number input.
  slider(spec, value, axis, onInput) {
    const wrap = document.createElement('div');
    wrap.className = 'param-slider';
    const range = Object.assign(document.createElement('input'), { type: 'range', min: spec.min, max: spec.max, step: spec.step, value });
    const field = Object.assign(document.createElement('input'), { type: 'number', step: spec.step, value: fmt(value, spec) });
    const paint = () => range.style.setProperty('--p', `${((range.value - spec.min) / (spec.max - spec.min || 1)) * 100}%`);
    range.oninput = () => { field.value = fmt(range.value, spec); paint(); onInput(Number(range.value)); };
    field.onchange = () => {
      const v = Number(field.value);
      if (!Number.isFinite(v)) return;
      range.value = v;   // the slider clamps, but a typed value may go beyond the range on purpose
      paint();
      onInput(spec.int ? Math.round(v) : v);
    };
    field.onkeydown = (e) => { if (e.key === 'Enter') field.blur(); };   // apply, and hand the keys back to the shortcuts
    range.ondblclick = () => {
      const def = Array.isArray(spec.def) ? spec.def[AXES.indexOf(axis)] ?? 1 : spec.def;
      range.value = def; field.value = fmt(def, spec); paint(); onInput(def);
    };
    range.title = 'Double-click to reset';
    if (axis) wrap.append(Object.assign(document.createElement('em'), { textContent: axis }));
    wrap.append(range);
    if (axis) wrap.append(field);
    wrap.field = field;
    wrap.setValue = (v) => { range.value = v; field.value = fmt(v, spec); paint(); };
    paint();
    return wrap;
  }
}

function fmt(v, spec) {
  const n = Number(v);
  if (spec.int) return String(Math.round(n));
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(spec.step || 0.01))));
  return n.toFixed(decimals);
}

const toHex = (rgb) => '#' + rgb.slice(0, 3).map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
