// Visual maker: drag nodes onto a canvas, wire outputs to inputs, and the graph is
// compiled to GLSL live and rendered as the "Node Scene".

import { NODE_TYPES, CATEGORIES, EXAMPLES, compileGraph, defaultParams } from './nodes.js';
import { parseParams } from './params.js';
import { COMMON } from './scenes.js';

const STORAGE_KEY = 'hallucinate.nodeGraph';
const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
};

export class NodeEditor {
  constructor({ renderer, sceneIndex, onOpen, onSendToCode, onParams }) {
    this.onParams = onParams;
    this.renderer = renderer;
    this.sceneIndex = sceneIndex;
    this.onOpen = onOpen;
    this.onSendToCode = onSendToCode;

    this.root = document.getElementById('nodes');
    this.viewport = this.root.querySelector('.ne-viewport');
    this.world = this.root.querySelector('.ne-world');
    this.wires = this.root.querySelector('.ne-wires');
    this.status = this.root.querySelector('.ne-status');
    this.view = { x: 40, y: 40, s: 1 };
    this.selected = null;
    this.drag = null;
    this.code = '';
    this.compileTimer = null;

    this.buildPalette();
    this.buildToolbar();
    this.bindPointer();
    this.loadGraph(load() ?? structuredClone(EXAMPLES[0].graph));
  }

  get isOpen() { return !this.root.hidden; }

  toggle(open = !this.isOpen) {
    this.root.hidden = !open;
    if (!open) return;
    this.onOpen();
    requestAnimationFrame(() => {
      if (this.fitted) return this.drawWires();
      this.fitted = true;
      this.fitView();
    });
  }

  // ---------- Setup ----------

  buildPalette() {
    const palette = this.root.querySelector('.ne-palette');
    for (const cat of CATEGORIES) {
      palette.append(el('h4', null, cat));
      for (const [type, def] of Object.entries(NODE_TYPES)) {
        if (def.cat !== cat) continue;
        const b = el('button', null, def.title);
        b.dataset.cat = cat;
        if (def.help) b.title = def.help;
        b.onclick = () => this.addNode(type);
        palette.append(b);
      }
    }
  }

  buildToolbar() {
    const picker = this.root.querySelector('.ne-examples');
    EXAMPLES.forEach((ex, i) => picker.add(new Option(ex.name, i)));
    picker.onchange = () => {
      const ex = EXAMPLES[picker.value];
      picker.value = '';
      if (ex && confirm(`Replace your graph with "${ex.name}"?`)) this.loadGraph(structuredClone(ex.graph), true);
    };
    this.root.querySelector('.ne-clear').onclick = () => {
      if (!confirm('Start with an empty graph?')) return;
      this.loadGraph({
        nodes: [
          { id: 1, type: 'uv', x: 0, y: 0, values: {}, params: {} },
          { id: 2, type: 'output', x: 500, y: 0, values: {}, params: {} },
        ],
        links: [],
      }, true);
    };
    this.root.querySelector('.ne-tocode').onclick = () => this.onSendToCode(this.code);
    this.root.querySelector('.ne-peek').onclick = () => this.root.classList.toggle('peek');
    this.root.querySelector('.ne-close').onclick = () => this.toggle(false);
    window.addEventListener('keydown', (e) => this.handleKeys(e));
  }

  loadGraph(graph, fit = false) {
    this.graph = graph;
    this.nextId = Math.max(0, ...graph.nodes.map((n) => n.id)) + 1;
    this.selected = null;
    this.render();
    this.changed();
    if (fit) requestAnimationFrame(() => this.fitView());
  }

  // ---------- Graph edits ----------

  addNode(type) {
    if (type === 'output' && this.graph.nodes.some((n) => n.type === 'output')) return;
    const r = this.viewport.getBoundingClientRect();
    const jitter = () => (Math.random() - 0.5) * 60;
    const node = {
      id: this.nextId++, type,
      x: Math.round((r.width / 2 - this.view.x) / this.view.s - 90 + jitter()),
      y: Math.round((r.height / 2 - this.view.y) / this.view.s - 60 + jitter()),
      values: {}, params: defaultParams(type),
    };
    this.graph.nodes.push(node);
    this.selected = node.id;
    this.render();
    this.changed();
  }

  removeNode(id) {
    const node = this.graph.nodes.find((n) => n.id === id);
    if (!node || node.type === 'output') return;
    this.graph.nodes = this.graph.nodes.filter((n) => n.id !== id);
    this.graph.links = this.graph.links.filter((l) => l.from !== id && l.to !== id);
    this.selected = null;
    this.render();
    this.changed();
  }

  connect(from, out, to, input) {
    if (from === to) return;
    this.graph.links = this.graph.links.filter((l) => !(l.to === to && l.in === input)); // one wire per input
    this.graph.links.push({ from, out, to, in: input });
    this.render();
    this.changed();
  }

  changed() {
    save(this.graph);
    clearTimeout(this.compileTimer);
    this.compileTimer = setTimeout(() => this.compile(), 120);
  }

  compile() {
    let error;
    try {
      this.code = compileGraph(this.graph);
      const { code, params } = parseParams(this.code);
      error = this.renderer.replaceScene(this.sceneIndex, COMMON + code);
      if (!error) this.onParams(params);
    } catch (err) {
      error = err.message;
    }
    this.status.className = `ne-status ${error ? 'error' : 'ok'}`;
    this.status.textContent = error ?? `✓ ${this.graph.nodes.length} nodes · ${this.graph.links.length} wires — live`;
  }

  // ---------- Rendering ----------

  render() {
    this.world.querySelectorAll('.node').forEach((n) => n.remove());
    for (const node of this.graph.nodes) this.world.append(this.renderNode(node));
    this.applyView();
  }

  renderNode(node) {
    const def = NODE_TYPES[node.type];
    const linked = new Set(this.graph.links.filter((l) => l.to === node.id).map((l) => l.in));
    const box = el('div', 'node');
    box.dataset.id = node.id;
    box.dataset.cat = def.cat;
    box.classList.toggle('selected', node.id === this.selected);
    box.style.left = `${node.x}px`;
    box.style.top = `${node.y}px`;

    const header = el('header', null, def.title);
    if (def.help) header.title = def.help;
    if (node.type !== 'output') {
      const x = el('button', 'ne-del', '×');
      x.title = 'Delete node';
      x.onclick = () => this.removeNode(node.id);
      header.append(x);
    }
    box.append(header);

    for (const p of def.params ?? []) {
      const row = el('label', 'ne-param');
      row.append(el('span', null, p.name));
      let input;
      if (p.kind === 'select') {
        input = el('select');
        p.options.forEach((o) => input.add(new Option(o, o)));
      } else {
        input = el('input', p.kind === 'color' ? null : 'ne-value');
        input.type = p.kind;   // color | text | number
        if (p.kind === 'number') input.step = 'any';
      }
      input.value = node.params?.[p.name] ?? p.def;
      input.oninput = () => {
        const value = p.kind === 'number' ? Number(input.value) : input.value;
        if (p.kind === 'number' && (input.value === '' || Number.isNaN(value))) return;
        node.params = { ...node.params, [p.name]: value };
        this.changed();
      };
      row.append(input);
      box.append(row);
    }

    for (const input of def.inputs) {
      const row = el('div', 'ne-port in');
      const dot = el('i', 'dot in');
      Object.assign(dot.dataset, { node: node.id, port: input.name, type: input.type });
      row.append(dot, el('span', null, input.name));
      if (linked.has(input.name)) row.classList.add('linked');
      else if (input.type === 'float') {
        const field = el('input', 'ne-value');
        field.type = 'number';
        field.step = '0.05';
        field.value = node.values?.[input.name] ?? input.def;
        field.oninput = () => {
          if (field.value === '' || Number.isNaN(Number(field.value))) return;
          node.values = { ...node.values, [input.name]: Number(field.value) };
          this.changed();
        };
        row.append(field);
      } else {
        row.append(el('em', null, input.type === 'vec2' ? 'UV' : 'colour'));
      }
      box.append(row);
    }

    for (const output of def.outputs) {
      const row = el('div', 'ne-port out');
      const dot = el('i', 'dot out');
      Object.assign(dot.dataset, { node: node.id, port: output.name, type: output.type });
      row.append(el('span', null, output.name), dot);
      box.append(row);
    }
    return box;
  }

  applyView() {
    const { x, y, s } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    this.viewport.style.backgroundPosition = `${x}px ${y}px`;
    this.viewport.style.backgroundSize = `${24 * s}px ${24 * s}px`;
    this.drawWires();
  }

  fitView() {
    const nodes = [...this.world.querySelectorAll('.node')];
    if (!nodes.length) return;
    const r = this.viewport.getBoundingClientRect();
    const xs = this.graph.nodes.map((n) => n.x), ys = this.graph.nodes.map((n) => n.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const maxX = Math.max(...this.graph.nodes.map((n, i) => n.x + nodes[i].offsetWidth));
    const maxY = Math.max(...this.graph.nodes.map((n, i) => n.y + nodes[i].offsetHeight));
    const s = Math.min(1, (r.width - 60) / (maxX - minX), (r.height - 60) / (maxY - minY));
    this.view = { s, x: 30 - minX * s, y: 30 - minY * s };
    this.applyView();
  }

  // Port position in world coordinates.
  portPos(nodeId, port, dir) {
    const dot = this.world.querySelector(`.dot.${dir}[data-node="${nodeId}"][data-port="${port}"]`);
    if (!dot) return null;
    const r = dot.getBoundingClientRect();
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  toWorld(clientX, clientY) {
    const w = this.world.getBoundingClientRect();
    return { x: (clientX - w.left) / this.view.s, y: (clientY - w.top) / this.view.s };
  }

  drawWires() {
    if (!this.isOpen) return;
    this.wires.replaceChildren();
    for (const l of this.graph.links) {
      const a = this.portPos(l.from, l.out, 'out');
      const b = this.portPos(l.to, l.in, 'in');
      const type = NODE_TYPES[this.graph.nodes.find((n) => n.id === l.from)?.type]?.outputs.find((o) => o.name === l.out)?.type;
      if (a && b) this.wires.append(wirePath(a, b, type));
    }
    if (this.drag?.kind === 'link') this.wires.append(wirePath(this.drag.start, this.drag.end, this.drag.type, true));
  }

  // ---------- Pointer & keys ----------

  bindPointer() {
    const vp = this.viewport;
    vp.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (t.closest('input, select, button')) return;
      const nodeEl = t.closest('.node');

      if (t.classList.contains('dot')) {
        const id = Number(t.dataset.node);
        let from = { id, port: t.dataset.port, type: t.dataset.type };
        if (t.classList.contains('in')) {
          // Grabbing a connected input picks its wire up again (drop on empty space to delete it).
          const link = this.graph.links.find((l) => l.to === id && l.in === t.dataset.port);
          if (!link) return;
          this.graph.links = this.graph.links.filter((l) => l !== link);
          const srcType = NODE_TYPES[this.graph.nodes.find((n) => n.id === link.from).type].outputs.find((o) => o.name === link.out).type;
          from = { id: link.from, port: link.out, type: srcType };
          this.render();
          this.changed();
        }
        const start = this.portPos(from.id, from.port, 'out');
        this.drag = { kind: 'link', from, type: from.type, start, end: this.toWorld(e.clientX, e.clientY) };
      } else if (nodeEl) {
        const node = this.graph.nodes.find((n) => n.id === Number(nodeEl.dataset.id));
        this.select(node.id);
        if (!t.closest('header')) return;
        this.drag = { kind: 'move', node, el: nodeEl, sx: e.clientX, sy: e.clientY, nx: node.x, ny: node.y };
      } else {
        this.select(null);
        this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
      }
      vp.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    vp.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      if (d.kind === 'pan') {
        this.view.x = d.vx + e.clientX - d.sx;
        this.view.y = d.vy + e.clientY - d.sy;
        this.applyView();
      } else if (d.kind === 'move') {
        d.node.x = Math.round(d.nx + (e.clientX - d.sx) / this.view.s);
        d.node.y = Math.round(d.ny + (e.clientY - d.sy) / this.view.s);
        d.el.style.left = `${d.node.x}px`;
        d.el.style.top = `${d.node.y}px`;
        this.drawWires();
      } else if (d.kind === 'link') {
        d.end = this.toWorld(e.clientX, e.clientY);
        this.drawWires();
      }
    });

    const end = (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.kind === 'move') save(this.graph);
      if (d.kind === 'link') {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (target?.classList.contains('dot') && target.classList.contains('in')) {
          this.connect(d.from.id, d.from.port, Number(target.dataset.node), target.dataset.port);
        }
        this.drawWires();
      }
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);

    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const s = Math.min(1.6, Math.max(0.3, this.view.s * Math.exp(-e.deltaY * 0.0015)));
      this.view.x = mx - (mx - this.view.x) * (s / this.view.s);
      this.view.y = my - (my - this.view.y) * (s / this.view.s);
      this.view.s = s;
      this.applyView();
    }, { passive: false });
  }

  select(id) {
    this.selected = id;
    this.world.querySelectorAll('.node').forEach((n) => n.classList.toggle('selected', Number(n.dataset.id) === id));
  }

  handleKeys(e) {
    if (!this.isOpen || e.target.closest?.('input, select, textarea')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected != null) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.removeNode(this.selected);
    } else if (e.key === 'Escape') {
      this.toggle(false);
    }
  }
}

function wirePath(a, b, type, pending = false) {
  const path = document.createElementNS(SVG_NS, 'path');
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  path.setAttribute('d', `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`);
  path.setAttribute('class', `wire ${type ?? ''}${pending ? ' pending' : ''}`);
  return path;
}

function load() {
  try {
    const g = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return g?.nodes?.every((n) => NODE_TYPES[n.type]) ? g : null;
  } catch {
    return null;
  }
}
function save(graph) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(graph)); } catch { /* storage unavailable */ } }
