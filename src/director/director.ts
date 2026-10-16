// The AI director: every K beats (or 120 s) it sends Claude a digest of the music and the show on
// a fresh conversation, and Claude answers with a plan the autopilot follows. The app is the
// director's memory (history.ts), so a cycle costs the same at the end of a long set as at the
// start, and a cycle that drops is simply redone at the next tick. Tools run here in the browser,
// like the assistant panel's, and the director never takes Live by itself.

import { fetchServerSentEvents, type ConnectionAdapter } from '@tanstack/ai-client';
import type { AppPort } from '../app/app-port';
import type { StudioSession } from '../app/studio';
import { Chat, forgetThread } from '../assistant/chat';
import { createToolRunner, type ToolRunner } from '../assistant/executor';
import { createLock, serialized, type Lock } from '../assistant/lock';
import type { Usage } from '../assistant/usage';
import { soundNow } from '../state/app-state';
import { Store } from '../state/store';
import { buildDigest, type DigestInput } from './digest';
import { DirectorHistory } from './history';

export const DIRECTOR_BEATS = [64, 128, 256] as const;
export const DIRECTOR_SECONDS = [30, 60, 90, 120, 180, 300, 600] as const;
const WALL_CLOCK_MS = 120_000;   // on beats: a cycle at least this often, tempo or not
const MAX_CYCLE_MS = 180_000;    // give up on a cycle after this

export interface DirectorView {
  on: boolean;
  cycling: boolean;
  cycles: number;
  lastNote: string;
  lastAt: number | null;        // Date.now() of the last finished cycle
  beatsToCycle: number;         // on beats
  secondsToCycle: number;       // on the timer
  tokens: { prompt: number; completion: number };
  error: string | null;
  hidden: boolean;              // the window is hidden: the show stands still
}

// Is the next cycle due? On beats: after N beats, or WALL_CLOCK_MS without a tempo; on the timer: after N seconds.
export function cycleDue(unit: 'beats' | 'seconds', beatsSince: number, beats: number, elapsedMs: number, seconds: number): boolean {
  if (unit === 'seconds') return elapsedMs >= seconds * 1000;
  return beatsSince >= beats || elapsedMs >= WALL_CLOCK_MS;
}

export interface DirectorOptions {
  connection?: ConnectionAdapter;   // tests hand in a fake one
  forgetThread?: (threadId: string) => void;
  lock?: Lock;                      // the assistant panel's tool lock (sessions.ts): their tools never interleave
}

export class Director {
  readonly store = new Store<DirectorView>({ on: false, cycling: false, cycles: 0, lastNote: '', lastAt: null, beatsToCycle: 0, secondsToCycle: 0, tokens: { prompt: 0, completion: 0 }, error: null, hidden: false });
  readonly history = new DirectorHistory();
  private readonly runner: ToolRunner;
  private beatsSince = 0;
  private lastCycleAt = 0;
  private startedAt = 0;
  private chat: Chat | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly app: AppPort, private readonly studio: StudioSession, private readonly opts: DirectorOptions = {}) {
    // The director's changes aren't undone from the panel: nothing keeps their undo steps.
    this.runner = serialized(createToolRunner(app, { push: () => {} }, () => studio), opts.lock ?? createLock());
  }

  get view(): DirectorView { return this.store.get(); }

  // Listens to the studio (beats, takes) and the window; the returned function stops everything.
  attach(): () => void {
    const unsubscribe = this.studio.subscribe((ev) => {
      if (ev.type === 'beat') this.onBeat();
      else if (ev.type === 'changed') this.publishCountdown();   // the dials may have moved
    });
    this.timer = setInterval(() => this.tick(), 1000);
    const onVisibility = () => this.onVisibility();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubscribe();
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      this.setOn(false);
    };
  }

  setOn(on: boolean): void {
    if (on === this.view.on) return;
    if (on) {
      if (!this.studio.autopilot.on) this.studio.setAutopilot(true);
      this.startedAt = Date.now();
      this.lastCycleAt = 0;
      this.beatsSince = 0;
      this.history.clear();
      this.store.set({ on: true, error: null, cycles: 0, tokens: { prompt: 0, completion: 0 }, beatsToCycle: this.beatsToCycle(), secondsToCycle: this.secondsToCycle() });
      void this.cycleNow();
    } else {
      this.chat?.stop();
      this.store.set({ on: false, cycling: false, beatsToCycle: 0, secondsToCycle: 0 });
    }
  }

  private beatsToCycle(): number { return Math.max(0, this.studio.directorBeats - this.beatsSince); }
  private secondsToCycle(): number { return Math.max(0, Math.ceil(this.studio.directorSeconds - (Date.now() - this.lastCycleAt) / 1000)); }
  private publishCountdown(): void { if (this.view.on) this.store.set({ beatsToCycle: this.beatsToCycle(), secondsToCycle: this.secondsToCycle() }); }
  private due(): boolean { return cycleDue(this.studio.directorUnit, this.beatsSince, this.studio.directorBeats, Date.now() - this.lastCycleAt, this.studio.directorSeconds); }

  private onBeat(): void {
    const f = this.app.audio.features;
    this.history.sample({ level: f.level, bass: f.bass, bright: f.bright });
    if (!this.view.on) return;
    this.beatsSince++;
    this.publishCountdown();
    if (this.due()) void this.cycleNow();
  }

  private tick(): void {
    if (!this.view.on) return;
    this.publishCountdown();
    if (this.due()) void this.cycleNow();
  }

  private onVisibility(): void {
    const hidden = typeof document !== 'undefined' && document.hidden && (this.view.on || this.studio.autopilot.on);
    if (hidden && !this.view.hidden) this.app.toast('The show stands still while this window is hidden: keep it visible (the projector can be on another screen).', 6000);
    this.store.set({ hidden });
  }

  // Can a cycle run now? Music must play, the show needs two scenes, and the chat must be idle.
  private ready(): boolean {
    return !this.view.cycling && this.app.music.playing && this.studio.cues.length >= 2 && !this.app.ui.get().assistantBusy;
  }

  // One cycle: a fresh thread, the digest, the model's tool calls, then the thread is forgotten.
  async cycleNow(): Promise<void> {
    if (!this.ready()) return;
    const threadId = crypto.randomUUID();
    const digest = buildDigest(this.collect());
    this.studio.userTouched = false;
    this.history.markCycle();
    const planBefore = this.studio.plan;
    this.store.set({ cycling: true, error: null });
    const chat = new Chat({ connection: this.opts.connection ?? fetchServerSentEvents('/api/assistant'), runner: this.runner, threadId, body: { mode: 'director' } }, {
      usage: (u) => this.countUsage(u),
      error: (message) => this.store.set({ error: message }),
    });
    this.chat = chat;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<true>((resolve) => { timer = setTimeout(() => resolve(true), MAX_CYCLE_MS); });
    try {
      if (await Promise.race([chat.send(digest).then(() => false), late])) this.store.set({ error: 'The director took too long; trying again at the next cycle.' });
    } finally {
      clearTimeout(timer);
      chat.dispose();
      if (this.chat === chat) this.chat = null;
      (this.opts.forgetThread ?? forgetThread)(threadId);
      const plan = this.studio.plan;
      const at = (Date.now() - this.startedAt) / 1000;
      if (plan && plan !== planBefore) this.history.decide(plan.note || `${plan.steps.length} steps`, at);
      this.beatsSince = 0;
      this.lastCycleAt = Date.now();
      this.store.set({ cycling: false, cycles: this.view.cycles + 1, lastAt: this.lastCycleAt, lastNote: plan && plan !== planBefore ? plan.note : this.view.lastNote, beatsToCycle: this.beatsToCycle(), secondsToCycle: this.secondsToCycle() });
    }
  }

  private countUsage(u: Usage): void {
    const t = this.view.tokens;
    this.store.set({ tokens: { prompt: t.prompt + u.prompt, completion: t.completion + u.completion } });
  }

  // The digest's input, read from the app and the studio.
  collect(): DigestInput {
    const app = this.app, s = this.studio;
    const scenes = app.state.scenes;
    return {
      ...soundNow(app.state, app.music.playing, app.audio.features.bright),
      elapsedSeconds: this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0,
      media: !!app.media.el,
      trend: this.history.trend(),
      cues: s.cues.map((cue) => { const i = s.sceneIndex(cue); return { id: cue.id, name: cue.name, scene: cue.scene, category: i >= 0 ? scenes[i]!.cat || null : null, hue: cue.look.hue ?? null, missing: i < 0 }; }),
      liveId: s.liveId,
      previewId: s.previewId,
      transition: { mode: s.mode, seconds: s.seconds },
      autopilot: { on: s.autopilot.on, unit: s.autopilot.unit, beats: s.autopilot.beats, beatsElapsed: s.beatsElapsed, beatsTarget: s.beatsTarget, seconds: s.autopilot.seconds, secondsElapsed: s.secondsElapsed },
      plan: s.plan,
      planIndex: s.planIndex,
      cycle: s.directorUnit === 'seconds' ? { unit: 'seconds', every: s.directorSeconds } : { unit: 'beats', every: s.directorBeats },
      decisions: this.history.decisions,
      userTouched: s.userTouched,
    };
  }
}
