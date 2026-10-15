import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventType } from '@tanstack/ai';
import type { ConnectionAdapter } from '@tanstack/ai-client';
import type { AppController } from '../app/controller';
import { StudioSession } from '../app/studio';
import { Store } from '../state/store';
import { Director } from './director';

// One director cycle against a scripted connection: the digest goes out on a fresh thread with
// mode "director", the model's set_autopilot_plan call runs here (as a client tool) and the plan
// lands in the studio, the thread is forgotten, and the next cycle starts from scratch again.

function fakeApp() {
  const scenes = [{ name: 'Alpha', cat: 'Fractal' }, { name: 'Beta', cat: 'Space' }];
  const app = {
    state: { scenes, clock: { clock: 0, scene: 0, huePhase: 0, bpm: 124, mood: 0.7 }, look: { hue: 0, cycle: 0.6, trails: 0.86, speed: 1, reactivity: 1, aberration: 0.012 }, activeSource: 'demo' },
    audio: { kind: 'demo' as string | null, features: { level: 0.5, bass: 0.4, bright: 0.6 } },
    media: { el: null },
    sceneParams: [[], []],
    sceneIndex: 0,
    tempo: { bpm: 124 },
    ui: new Store({ assistantBusy: false }),
    paramStore: { setAll: vi.fn() },
    setScene: vi.fn(), setLook: vi.fn(), pushParams: vi.fn(), paramValues: vi.fn(() => ({})), showParams: vi.fn(), toast: vi.fn(),
    setHooks: vi.fn(() => () => {}),
    sceneByName: (name: string) => scenes.findIndex((s) => s.name === name),
    studio: () => null as StudioSession | null,
  };
  return app;
}

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } });
});

interface Seen { messages: unknown[]; data: unknown; forwardedProps: unknown; threadId: string | undefined }

// Every odd connect answers with a plan tool call; every even one (the continuation after the tool ran) just finishes.
function scriptedConnection(seen: Seen[]): ConnectionAdapter {
  let calls = 0;
  return {
    async *connect(messages: unknown[], data: unknown, _signal: unknown, runContext?: { runId?: string; threadId?: string; forwardedProps?: unknown }) {
      seen.push({ messages: [...messages], data, forwardedProps: runContext?.forwardedProps, threadId: runContext?.threadId });
      const model = 'fake', now = Date.now(), runId = runContext?.runId ?? 'r', threadId = runContext?.threadId ?? 't';
      calls++;
      yield { type: EventType.RUN_STARTED, runId, threadId, model, timestamp: now };
      if (calls % 2 === 1) {
        const input = { plan: { steps: [{ cue: 'Beta', beats: 16, maxSeconds: 90 }, { cue: 'Alpha', beats: 32, maxSeconds: 90 }], note: `plan ${Math.ceil(calls / 2)}`, loop: true } };
        const args = JSON.stringify(input);
        yield { type: EventType.TOOL_CALL_START, toolCallId: `call-${calls}`, toolCallName: 'set_autopilot_plan', toolName: 'set_autopilot_plan', model, timestamp: now };
        yield { type: EventType.TOOL_CALL_ARGS, toolCallId: `call-${calls}`, model, timestamp: now, delta: args, args };
        yield { type: EventType.TOOL_CALL_END, toolCallId: `call-${calls}`, toolCallName: 'set_autopilot_plan', toolName: 'set_autopilot_plan', model, timestamp: now, input };
        // The server's run ends here; the browser runs the tool and continues on a new request (finishReason 'stop', not 'tool_calls').
        yield { type: EventType.RUN_FINISHED, runId, threadId, model, timestamp: now, finishReason: 'stop', usage: { promptTokens: 1000, completionTokens: 50, totalTokens: 1050 } };
      } else {
        yield { type: EventType.RUN_FINISHED, runId, threadId, model, timestamp: now, finishReason: 'stop', usage: { promptTokens: 1200, completionTokens: 10, totalTokens: 1210 } };
      }
    },
  } as unknown as ConnectionAdapter;
}

const settled = async (d: Director) => { for (let i = 0; i < 200 && d.view.cycling; i++) await new Promise((r) => setTimeout(r, 25)); };

describe('a director cycle', () => {
  it('sends the digest on a fresh director thread, runs the plan tool here, forgets the thread, and stays flat', async () => {
    const app = fakeApp();
    const studio = new StudioSession(app as unknown as AppController, () => {});
    app.studio = () => studio;
    studio.attach();
    studio.add({ name: 'Alpha', scene: 'Alpha', values: {}, look: { hue: 0.1 } });
    studio.add({ name: 'Beta', scene: 'Beta', values: {}, look: { hue: 0.6 } });
    const seen: Seen[] = [];
    const forgotten: string[] = [];
    const director = new Director(app as unknown as AppController, studio, { connection: scriptedConnection(seen), forgetThread: (id) => forgotten.push(id) });

    director.setOn(true);                     // turns the autopilot on and runs the first cycle
    expect(studio.autopilot.on).toBe(true);
    await settled(director);

    expect(director.view.cycles).toBe(1);
    expect(director.view.error).toBeNull();
    expect(studio.plan?.note).toBe('plan 1');
    expect(studio.plan?.steps.map((s) => s.cue)).toEqual([studio.cueByRef('Beta')!.id, studio.cueByRef('Alpha')!.id]);   // stored by id, not name
    expect(director.view.lastNote).toBe('plan 1');
    expect(director.view.tokens).toEqual({ prompt: 2200, completion: 60 });
    expect(forgotten).toHaveLength(1);
    expect(seen[0]!.forwardedProps).toMatchObject({ mode: 'director' });
    const first = seen[0]!.messages[0] as { role: string; parts?: { type: string; content?: string }[] };
    expect(first.role).toBe('user');
    expect(JSON.stringify(first)).toContain('Director cycle');
    expect(seen).toHaveLength(2);             // the run, and the continuation after the tool ran

    await director.cycleNow();                // a second cycle starts a new thread with only the digest in it
    await settled(director);
    expect(director.view.cycles).toBe(2);
    expect(studio.plan?.note).toBe('plan 2');
    expect(forgotten).toHaveLength(2);
    expect(forgotten[0]).not.toBe(forgotten[1]);
    expect(seen[2]!.threadId).toBe(forgotten[1]);
    expect(seen[2]!.messages).toHaveLength(1);
    const size = (s: Seen) => JSON.stringify(s.messages).length;
    expect(Math.abs(size(seen[2]!) - size(seen[0]!)) / size(seen[0]!)).toBeLessThan(0.1);
    expect(director.history.decisions.map((d) => d.note)).toEqual(['plan 1', 'plan 2']);
  });

  it('waits while the chat is busy, the music is off or the show is too small', async () => {
    const app = fakeApp();
    const studio = new StudioSession(app as unknown as AppController, () => {});
    app.studio = () => studio;
    studio.attach();
    const seen: Seen[] = [];
    const director = new Director(app as unknown as AppController, studio, { connection: scriptedConnection(seen), forgetThread: () => {} });
    director.setOn(true);
    await settled(director);
    expect(seen).toHaveLength(0);             // one show scene: nothing to plan
    studio.add({ name: 'Alpha', scene: 'Alpha', values: {}, look: {} });
    studio.add({ name: 'Beta', scene: 'Beta', values: {}, look: {} });
    app.ui.set({ assistantBusy: true });
    await director.cycleNow();
    expect(seen).toHaveLength(0);             // the panel is talking: wait
    app.ui.set({ assistantBusy: false });
    app.audio.kind = null;
    await director.cycleNow();
    expect(seen).toHaveLength(0);             // no music
    app.audio.kind = 'demo';
    await director.cycleNow();
    await settled(director);
    expect(seen.length).toBeGreaterThan(0);
    director.setOn(false);
    expect(director.view.on).toBe(false);
  });
});
