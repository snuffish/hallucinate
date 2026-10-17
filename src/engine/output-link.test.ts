import { afterEach, describe, expect, it, vi } from 'vitest';
import { programState } from './look';
import { OutputLink, ProjectorView, STALE_MS, WAITING_MS, type OutputMessage, type OutputPort, type OutputStatus, type ProjectorMedia, type ProjectorRenderer } from './output-link';
import type { ProgramState, SceneSource } from './renderer';

// A BroadcastChannel in memory: a message reaches every other port on the bus, at once.
function bus() {
  const ports = new Set<OutputPort>();
  return (): OutputPort => {
    const port: OutputPort = {
      post: (m) => { for (const p of ports) if (p !== port) p.onMessage?.(structuredClone(m)); },
      onMessage: null,
      close: () => { ports.delete(port); },
    };
    ports.add(port);
    return port;
  };
}

// A projector window: its renderer and media in memory.
function projector(port: OutputPort, clock: { t: number }, id = 'p1') {
  const scenes: SceneSource[] = [];
  const drawn: { scene: number }[] = [];
  const frames: ProgramState[] = [];
  const renderer: ProjectorRenderer & { params: Record<number, unknown>; scale: number; ratio: number } = {
    size: [1920, 1080], params: {}, scale: 0, ratio: 0,
    setParams(i, u) { renderer.params[i] = u; },
    setScale(s) { renderer.scale = s; },
    setMaxPixelRatio(r) { renderer.ratio = r; },
    render(s) { drawn.push({ scene: s.scene }); frames.push(s); },
  };
  const loaded: unknown[] = [];
  const media: ProjectorMedia = {
    load: async (source) => { loaded.push(source); return media as never; },
    clear: () => { loaded.push(null); },
    follow: () => {},
  };
  const view = new ProjectorView(port, renderer, media, scenes, { id, now: () => clock.t });
  return { view, scenes, renderer, drawn, frames, loaded };
}

afterEach(() => { vi.useRealTimers(); });

describe('the projector link', () => {
  function setup() {
    vi.useFakeTimers();
    const connect = bus();
    const clock = { t: 0 };
    const scenes: SceneSource[] = [{ name: 'Alpha', frag: 'a' }, { name: 'Beta', frag: 'b' }];
    let outputs: OutputStatus[] = [];
    const link = new OutputLink(scenes, (o) => { outputs = o; }, { maxPixelRatio: 1.5 }, { port: connect(), now: () => clock.t });
    return { connect, clock, scenes, link, outputs: () => outputs };
  }

  it('gives a projector that says hello the scenes, the media and the preferences as they are now', async () => {
    const { connect, clock, link } = setup();
    link.sendMedia({ url: '/api/youtube/file/v.mp4', name: 'Clip', kind: 'video', site: 'youtube' });
    const p = projector(connect(), clock);
    p.view.start();
    expect(p.scenes).toEqual([{ name: 'Alpha', frag: 'a' }, { name: 'Beta', frag: 'b' }]);
    expect(p.loaded).toEqual([expect.objectContaining({ name: 'Clip' })]);
    expect(p.renderer.ratio).toBe(1.5);
  });

  it('counts a projector once it reports, and drops it when it stops or says bye', () => {
    const { connect, clock, link, outputs } = setup();
    const p = projector(connect(), clock);
    p.view.start();
    expect(link.connected).toBe(false);
    p.view.report(true);
    expect(link.connected).toBe(true);
    expect(outputs()).toEqual([expect.objectContaining({ id: 'p1', w: 1920, h: 1080, fullscreen: true })]);
    clock.t = STALE_MS + 1;
    vi.advanceTimersByTime(1000);
    expect(link.connected).toBe(false);
    clock.t = 0;
    p.view.report(false);
    p.view.bye();
    expect(link.connected).toBe(false);
  });

  it('sends scene edits and frames only while a projector is there, and it draws each frame once', () => {
    const { connect, clock, scenes, link } = setup();
    const p = projector(connect(), clock);
    p.view.start();
    scenes[1] = { name: 'Beta', frag: 'b2' };
    link.sendScene(1);
    link.sendFrame({ ...programState(), scene: 1 }, { 1: { uGlow: 2 } }, 0.75);
    expect(p.scenes[1]!.frag).toBe('b');   // nobody reported yet: nothing sent
    expect(p.view.draw()).toBe(false);

    p.view.report(false);
    link.sendScene(1);
    expect(p.scenes[1]!.frag).toBe('b2');
    link.sendFrame({ ...programState(), scene: 1 }, { 1: { uGlow: 2 } }, 0.75);
    link.sendFrame({ ...programState(), scene: 0 }, { 0: { uGlow: 1 } }, 0.75);
    expect(p.view.draw()).toBe(true);
    expect(p.view.draw()).toBe(false);
    expect(p.drawn).toEqual([{ scene: 0 }]);   // the newest frame, once
    expect(p.renderer.params).toEqual({ 0: { uGlow: 1 } });
    expect(p.renderer.scale).toBe(0.75);
  });

  it('carries the effects of the incoming and the outgoing picture in each frame', () => {
    const { connect, clock, link } = setup();
    const p = projector(connect(), clock);
    p.view.start();
    p.view.report(false);
    const effects = [{ id: 'mirror' as const, on: true, settings: { axis: 2 } }];
    const prevEffects = [{ id: 'mirror' as const, on: false, settings: { axis: 0 } }];
    link.sendFrame({ ...programState(), scene: 1, prevScene: 0, mix: 0.5, effects, prevEffects }, {}, 1);
    p.view.draw();
    expect(p.frames.at(-1)).toMatchObject({ scene: 1, prevScene: 0, effects, prevEffects });
  });

  it('a projector says it is waiting when no frame came for a while, and reports the frames it drew', () => {
    const { connect, clock, link } = setup();
    const p = projector(connect(), clock);
    const statuses: OutputMessage[] = [];
    const spy = connect();
    spy.onMessage = (m) => { if (m.type === 'status') statuses.push(m); };
    p.view.start();
    p.view.report(false);
    expect(p.view.waiting).toBe(true);
    link.sendFrame(programState(), {}, 1);
    expect(p.view.waiting).toBe(false);
    p.view.draw();
    clock.t = 1000;
    p.view.report(false);
    expect(statuses.at(-1)).toMatchObject({ fps: 1 });
    clock.t = 1000 + WAITING_MS;
    expect(p.view.waiting).toBe(true);
  });

  it('shows the media it is sent, and clears it', () => {
    const { connect, clock, link } = setup();
    const p = projector(connect(), clock);
    p.view.start();
    link.sendMedia(null);
    expect(p.loaded.at(-1)).toBeNull();
  });
});
