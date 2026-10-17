// Visual maker: drag blocks onto a canvas, wire outputs to inputs, and the graph is compiled to
// GLSL live and rendered as the "Node Scene".

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useApp, useUI } from '../app/AppContext';
import type { AppController } from '../app/controller';
import { SUPERSEDED, type CompileResult } from '../app/scene-library';
import { CATEGORIES, EXAMPLES, GraphSchema, NODE_TYPES, compileGraph, defaultParams, emptyGraph, type Graph, type GraphNode, type PortType } from '../engine/nodes';
import { HOTKEYS } from '../hotkeys/registry';
import { useHotkeyActions } from '../hooks/useAppHotkeys';
import { Kbd } from '../hotkeys/Kbd';
import { KEYS, debouncedWriter, readJSON } from '../state/persistence';
import { HelpButton } from './Help';

interface View { x: number; y: number; s: number }
interface Pt { x: number; y: number }
type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; id: number; sx: number; sy: number; nx: number; ny: number }
  | { kind: 'link'; from: { id: number; port: string; type: PortType }; start: Pt; end: Pt };

const SVG_NS = 'http://www.w3.org/2000/svg';
const loadGraph = (): Graph => readJSON(KEYS.nodeGraph, GraphSchema, structuredClone(EXAMPLES[0]!.graph));

// The imperative side of the editor: saving (debounced), compiling (debounced) and ids. Kept out
// of React state so handlers can mutate it freely.
class GraphSession {
  private latest: Graph;
  private readonly writer;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly app: AppController, initial: Graph, private readonly onStatus: (status: { text: string; error: boolean }) => void) {
    this.latest = initial;
    this.writer = debouncedWriter(KEYS.nodeGraph, () => this.latest, 300);
  }

  nextId(): number { return Math.max(0, ...this.latest.nodes.map((n) => n.id)) + 1; }

  // Graph changed: persist soon, compile soon.
  changed(g: Graph): void {
    this.latest = g;
    this.writer.schedule();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.compile(g), 120);
  }

  moved(g: Graph): void { this.latest = g; this.writer.schedule(); }

  async compile(g: Graph): Promise<void> {
    let error: CompileResult;
    try {
      const code = compileGraph(g);
      this.app.editor.setNodeCode(code);
      error = await this.app.editor.compileInto(this.app.editor.target(this.app.state.nodesIndex), code);
    } catch (err) {
      error = (err as Error).message;
    }
    if (error === SUPERSEDED) return;   // a newer graph is compiling; it reports instead
    this.onStatus({ text: error ?? `✓ ${g.nodes.length} nodes · ${g.links.length} wires — live`, error: !!error });
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.writer.dispose();
  }
}

export function VisualMaker() {
  const app = useApp();
  const open = useUI((ui) => ui.overlay === 'nodes');
  const [graph, setGraph] = useState<Graph>(loadGraph);
  const [status, setStatus] = useState<{ text: string; error: boolean }>({ text: '', error: false });
  const [session] = useState(() => new GraphSession(app, graph, setStatus));
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, s: 1 });
  const [peek, setPeek] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [fitRequested, setFitRequested] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const wiresSvg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    void session.compile(graph);   // the Node Scene runs from the start
    return () => session.dispose();
  }, [session]);   // eslint-disable-line react-hooks/exhaustive-deps

  const changed = (g: Graph) => { setGraph(g); session.changed(g); };

  // ---------- Graph edits ----------
  const addNode = (type: string) => {
    if (type === 'output' && graph.nodes.some((n) => n.type === 'output')) return;
    const r = viewport.current?.getBoundingClientRect() ?? { width: 800, height: 600 };
    const jitter = () => (Math.random() - 0.5) * 60;
    const node: GraphNode = {
      id: session.nextId(), type,
      x: Math.round((r.width / 2 - view.x) / view.s - 90 + jitter()),
      y: Math.round((r.height / 2 - view.y) / view.s - 60 + jitter()),
      values: {}, params: defaultParams(type),
    };
    setSelected(node.id);
    changed({ ...graph, nodes: [...graph.nodes, node] });
  };
  const removeNode = (id: number) => {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node || node.type === 'output') return;
    setSelected(null);
    changed({ nodes: graph.nodes.filter((n) => n.id !== id), links: graph.links.filter((l) => l.from !== id && l.to !== id) });
  };
  const connect = (g: Graph, from: number, out: string, to: number, input: string): Graph => {
    if (from === to) return g;
    return { ...g, links: [...g.links.filter((l) => !(l.to === to && l.in === input)), { from, out, to, in: input }] };   // one wire per input
  };
  const setNodeParam = (id: number, name: string, value: string | number) =>
    changed({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, params: { ...n.params, [name]: value } } : n)) });
  const setNodeValue = (id: number, name: string, value: number) =>
    changed({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, values: { ...n.values, [name]: value } } : n)) });
  const load = (g: Graph) => { setSelected(null); changed(g); setFitRequested(true); };

  // ---------- Opening & shortcuts ----------
  useEffect(() => { if (open) app.setScene(app.state.nodesIndex); }, [open, app]);
  const deleteSelected = () => { if (selected != null) removeNode(selected); };
  useHotkeyActions<'nodes'>({ deleteNode: deleteSelected, deleteNodeBackspace: deleteSelected });

  // ---------- Geometry ----------
  const toWorld = (clientX: number, clientY: number): Pt => {
    const w = world.current!.getBoundingClientRect();
    return { x: (clientX - w.left) / view.s, y: (clientY - w.top) / view.s };
  };
  const portPos = (nodeId: number, port: string, dir: 'in' | 'out'): Pt | null => {
    const dot = world.current?.querySelector<HTMLElement>(`.dot.${dir}[data-node="${nodeId}"][data-port="${port}"]`);
    if (!dot) return null;
    const r = dot.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };
  function fitView() {
    const nodes = world.current ? [...world.current.querySelectorAll<HTMLElement>('.node')] : [];
    const r = viewport.current?.getBoundingClientRect();
    if (!nodes.length || !r || !r.width) return;
    const xs = graph.nodes.map((n) => n.x), ys = graph.nodes.map((n) => n.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const maxX = Math.max(...graph.nodes.map((n, i) => n.x + (nodes[i]?.offsetWidth ?? 180)));
    const maxY = Math.max(...graph.nodes.map((n, i) => n.y + (nodes[i]?.offsetHeight ?? 120)));
    const s = Math.min(1, (r.width - 60) / (maxX - minX), (r.height - 60) / (maxY - minY));
    setView({ s, x: 30 - minX * s, y: 30 - minY * s });
    setFitRequested(false);
  }
  // Wires follow the blocks' DOM positions, so they are drawn straight into the SVG after layout.
  useLayoutEffect(() => {
    if (!open || !wiresSvg.current) return;
    if (fitRequested) { fitView(); return; }
    const paths: SVGPathElement[] = [];
    const add = (a: Pt, b: Pt, type: PortType | undefined, pending = false) => {
      const path = document.createElementNS(SVG_NS, 'path');
      const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
      path.setAttribute('d', `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`);
      path.setAttribute('class', `wire ${type ?? ''}${pending ? ' pending' : ''}`);
      paths.push(path);
    };
    for (const l of graph.links) {
      const a = portPos(l.from, l.out, 'out');
      const b = portPos(l.to, l.in, 'in');
      const type = NODE_TYPES[graph.nodes.find((n) => n.id === l.from)?.type ?? '']?.outputs.find((o) => o.name === l.out)?.type;
      if (a && b) add(a, b, type);
    }
    if (drag?.kind === 'link') add(drag.start, drag.end, drag.from.type, true);
    wiresSvg.current.replaceChildren(...paths);
  });

  // ---------- Pointer ----------
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, select, button')) return;
    const nodeEl = t.closest<HTMLElement>('.node');
    if (t.classList.contains('dot')) {
      const id = Number(t.dataset.node);
      let from = { id, port: t.dataset.port!, type: t.dataset.type as PortType };
      if (t.classList.contains('in')) {
        // Grabbing a connected input picks its wire up again (drop on empty space to delete it).
        const link = graph.links.find((l) => l.to === id && l.in === t.dataset.port);
        if (!link) return;
        const srcType = NODE_TYPES[graph.nodes.find((n) => n.id === link.from)!.type]!.outputs.find((o) => o.name === link.out)!.type;
        from = { id: link.from, port: link.out, type: srcType };
        changed({ ...graph, links: graph.links.filter((l) => l !== link) });
      }
      const start = portPos(from.id, from.port, 'out') ?? toWorld(e.clientX, e.clientY);
      setDrag({ kind: 'link', from, start, end: toWorld(e.clientX, e.clientY) });
    } else if (nodeEl) {
      const node = graph.nodes.find((n) => n.id === Number(nodeEl.dataset.id))!;
      setSelected(node.id);
      if (!t.closest('header')) return;
      setDrag({ kind: 'move', id: node.id, sx: e.clientX, sy: e.clientY, nx: node.x, ny: node.y });
    } else {
      setSelected(null);
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    if (drag.kind === 'pan') setView({ ...view, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy });
    else if (drag.kind === 'move') {
      const x = Math.round(drag.nx + (e.clientX - drag.sx) / view.s), y = Math.round(drag.ny + (e.clientY - drag.sy) / view.s);
      setGraph({ ...graph, nodes: graph.nodes.map((n) => (n.id === drag.id ? { ...n, x, y } : n)) });
    } else setDrag({ ...drag, end: toWorld(e.clientX, e.clientY) });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === 'move') session.moved(graph);
    if (d.kind === 'link') {
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (target?.classList.contains('dot') && target.classList.contains('in')) {
        changed(connect(graph, d.from.id, d.from.port, Number(target.dataset.node), target.dataset.port!));
      }
    }
  };
  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView((v) => {
        const s = Math.min(1.6, Math.max(0.3, v.s * Math.exp(-e.deltaY * 0.0015)));
        return { s, x: mx - (mx - v.x) * (s / v.s), y: my - (my - v.y) * (s / v.s) };
      });
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

  // ---------- Toolbar ----------
  const loadExample = (i: string) => {
    const ex = EXAMPLES[Number(i)];
    if (ex && confirm(`Replace your graph with "${ex.name}"?`)) load(structuredClone(ex.graph));
  };
  const sendToCode = async () => {
    if (!confirm('Replace the code in "My Shader" with this graph\'s code?')) return;
    await app.editor.setCustomCode(app.editor.nodeCode);
    app.setScene(app.state.customIndex);
    app.setOverlay('editor');
    app.toast('Graph copied into the code editor (My Shader)');
  };

  return (
    <section id="nodes" className={`nodes${peek ? ' peek' : ''}`} hidden={!open}>
      <header className="ne-bar">
        <strong>Visual maker</strong>
        <select className="ne-examples" title="Load an example graph" value="" onChange={(e) => loadExample(e.target.value)}>
          <option value="">Examples…</option>
          {EXAMPLES.map((ex, i) => <option key={ex.name} value={i}>{ex.name}</option>)}
        </select>
        <button className="ne-clear" onClick={() => { if (confirm('Start with an empty graph?')) load(emptyGraph()); }}>New</button>
        <button className="ne-tocode" title="Open the generated GLSL in the code editor" onClick={() => void sendToCode()}>Send to code</button>
        <button className="ne-peek" title="Hide the graph to see the result" onClick={() => setPeek((p) => !p)}>Peek</button>
        <span className={`ne-status ${status.error ? 'error' : 'ok'}`}>{status.text}</span>
        <HelpButton topic="nodes" />
        <button className="ne-close icon" title="Close (Esc)" onClick={() => app.setOverlay(null)}>×<Kbd hotkey={HOTKEYS.closeOverlay} /></button>
      </header>
      <nav className="ne-palette">
        {CATEGORIES.map((cat) => (
          <div key={cat} className="ne-cat">
            <h4>{cat}</h4>
            {Object.entries(NODE_TYPES).filter(([, def]) => def.cat === cat).map(([type, def]) => (
              <button key={type} data-cat={cat} title={def.help} onClick={() => addNode(type)}>{def.title}</button>
            ))}
          </div>
        ))}
      </nav>
      <div className="ne-viewport" ref={viewport} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.s}px ${24 * view.s}px` }}>
        <div className="ne-world" ref={world} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
          <svg className="ne-wires" ref={wiresSvg} />
          {graph.nodes.map((node) => (
            <NodeBox key={node.id} node={node} graph={graph} selected={node.id === selected}
              onRemove={() => removeNode(node.id)} onParam={(k, v) => setNodeParam(node.id, k, v)} onValue={(k, v) => setNodeValue(node.id, k, v)} />
          ))}
        </div>
        <p className="ne-help">Click a block on the left to add it · drag from ● to ● to wire · drag an input's wire off to remove it · drag empty space to pan · scroll to zoom · <Kbd hotkey={HOTKEYS.deleteNode} /> removes the selected block</p>
      </div>
    </section>
  );
}

function NodeBox({ node, graph, selected, onRemove, onParam, onValue }: {
  node: GraphNode; graph: Graph; selected: boolean; onRemove: () => void; onParam: (name: string, v: string | number) => void; onValue: (name: string, v: number) => void;
}) {
  const def = NODE_TYPES[node.type]!;
  const linked = new Set(graph.links.filter((l) => l.to === node.id).map((l) => l.in));
  return (
    <div className={`node${selected ? ' selected' : ''}`} data-id={node.id} data-cat={def.cat} style={{ left: node.x, top: node.y }}>
      <header title={def.help}>
        {def.title}
        {node.type !== 'output' && <button className="ne-del" title="Delete node" onClick={onRemove}>×</button>}
      </header>
      {(def.params ?? []).map((p) => (
        <label key={p.name} className="ne-param">
          <span>{p.name}</span>
          {p.kind === 'select' ? (
            <select value={String(node.params[p.name] ?? p.saved ?? p.def)} onChange={(e) => onParam(p.name, e.target.value)}>
              {p.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : p.kind === 'number' ? (
            <NumberField className="ne-value" value={Number(node.params[p.name] ?? p.def)} step="any" onValue={(v) => onParam(p.name, v)} />
          ) : (
            <input type={p.kind} className={p.kind === 'color' ? undefined : 'ne-value'} value={String(node.params[p.name] ?? p.def)} onChange={(e) => onParam(p.name, e.target.value)} />
          )}
        </label>
      ))}
      {def.inputs.map((input) => (
        <div key={input.name} className={`ne-port in${linked.has(input.name) ? ' linked' : ''}`}>
          <i className="dot in" data-node={node.id} data-port={input.name} data-type={input.type} />
          <span>{input.name}</span>
          {!linked.has(input.name) && (input.type === 'float'
            ? <NumberField className="ne-value" value={node.values[input.name] ?? (input.def as number)} step="0.05" onValue={(v) => onValue(input.name, v)} />
            : <em>{input.type === 'vec2' ? 'UV' : 'colour'}</em>)}
        </div>
      ))}
      {def.outputs.map((output) => (
        <div key={output.name} className="ne-port out">
          <span>{output.name}</span>
          <i className="dot out" data-node={node.id} data-port={output.name} data-type={output.type} />
        </div>
      ))}
    </div>
  );
}

// A number input that only reports finite values, and lets you clear it while typing.
function NumberField({ value, step, className, onValue }: { value: number; step: string; className?: string; onValue: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input type="number" className={className} step={step} value={text ?? value}
      onChange={(e) => { setText(e.target.value); const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v)) onValue(v); }}
      onBlur={() => setText(null)} />
  );
}
