// Every scene's versions: what its code was, when, and who made it (you, the assistant, a template,
// Revert, a restore). The scene library notes each code change here (scene-library.ts); the editor's
// History lists a scene's versions, compares them with the code now and restores one (a restore is a
// new version, so it can be gone back on too).
//
// Your typing is saved on every compile; versions follow it more coarsely: typing that goes on with
// less than a minute between changes stays one version. Any other change (the assistant's edit, a
// template, Revert) is a version of its own, after the code it replaced: when that code isn't the
// newest version (history started after it, or was trimmed), it is kept first as an earlier one.
//
// A scene is known by the key its parameter values are stored under (paramKey: "user:Name",
// "scene:Name", "custom"), so a rename follows the same path. Kept on this computer only.

import { codeHash } from './code-hash';
import { defaultStore, newId, type RecordStore } from './history-db';
import { Store } from './store';

// Who made a version. `library`: saved to the library; `copy`: the visual maker's code copied in;
// `earlier`: code from before history knew the scene, kept as the "before" of a change.
export type VersionBy = 'you' | 'assistant' | 'template' | 'revert' | 'restore' | 'library' | 'copy' | 'undo' | 'earlier';

export interface Origin {
  by: VersionBy;
  label?: string;        // what it was: the template's name, the assistant's change ("Edited Vortex")
  chatId?: string;       // the assistant's conversation that made it
  toolCallId?: string;
}

export interface Version extends Origin {
  id: string;
  key: string;
  at: number;            // when it was last changed (typing folded into it moves this on)
  body: string;
  hash: string;
}

export const COALESCE_MS = 60_000;
export const MAX_VERSIONS = 50;

export class SceneHistory {
  // `revision` moves on every change, for views to re-read.
  readonly store = new Store<{ revision: number }>({ revision: 0 });
  // Resolves once the stored versions are loaded; notes taken before then are applied after them.
  readonly ready: Promise<void>;
  private byKey = new Map<string, Version[]>();   // oldest first
  private loaded = false;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly backend: RecordStore<Version> = defaultStore<Version>('scene-versions'),
    private readonly now: () => number = Date.now,
  ) {
    this.ready = backend.all()
      .catch(() => [] as Version[])
      .then((all) => {
        for (const v of all.sort((a, b) => a.at - b.at)) this.versions(v.key).push(v);
        this.loaded = true;
        this.publish();
      });
  }

  // Newest first.
  list(key: string): Version[] { return [...(this.byKey.get(key) ?? [])].reverse(); }

  get(id: string): Version | undefined {
    for (const list of this.byKey.values()) { const v = list.find((x) => x.id === id); if (v) return v; }
    return undefined;
  }

  // Scene `key`'s code became `body` (it was `before`).
  note(key: string, body: string, origin: Origin = { by: 'you' }, before?: string): void {
    const at = this.now();
    if (!this.loaded) { void this.ready.then(() => this.apply(key, body, origin, before, at)); return; }
    this.apply(key, body, origin, before, at);
  }

  // What was kept under `from` is now `to`'s (a scene renamed).
  rename(from: string, to: string): void {
    if (!this.loaded) { void this.ready.then(() => this.rename(from, to)); return; }
    const moved = this.byKey.get(from);
    if (!moved?.length) return;
    this.byKey.delete(from);
    const list = this.versions(to);
    for (const v of moved) { v.key = to; list.push(v); this.save(v); }
    list.sort((a, b) => a.at - b.at);
    this.publish();
  }

  // Scene `key` is deleted for good (a parked scene discarded): its versions go too.
  drop(key: string): void {
    if (!this.loaded) { void this.ready.then(() => this.drop(key)); return; }
    const list = this.byKey.get(key);
    if (!list) return;
    this.byKey.delete(key);
    this.forget(list.map((v) => v.id));
    this.publish();
  }

  // Waits for every write so far (tests, and before a reload).
  flush(): Promise<void> { return this.ready.then(() => this.writes); }

  private apply(key: string, body: string, origin: Origin, before: string | undefined, at: number): void {
    const list = this.versions(key);
    const hash = codeHash(body);
    if (before !== undefined && before !== body && list.at(-1)?.hash !== codeHash(before)) {
      this.add(list, { id: newId('v'), key, at: at - 1, body: before, hash: codeHash(before), by: 'earlier' });
    }
    const newest = list.at(-1);
    if (newest?.hash === hash) return;
    if (newest && newest.by === 'you' && origin.by === 'you' && at - newest.at < COALESCE_MS) {
      Object.assign(newest, { body, hash, at });
      this.save(newest);
    } else {
      this.add(list, { id: newId('v'), key, at, body, hash, ...origin });
    }
    this.prune(list);
    this.publish();
  }

  private add(list: Version[], v: Version): void {
    for (const k of Object.keys(v) as (keyof Version)[]) if (v[k] === undefined) delete v[k];
    list.push(v);
    this.save(v);
  }

  // Over the cap, the oldest versions go, your typing and earlier code first; the first one stays.
  private prune(list: Version[]): void {
    const over = list.length - MAX_VERSIONS;
    if (over <= 0) return;
    const plain = list.slice(1).filter((v) => v.by === 'you' || v.by === 'earlier').slice(0, over);
    const rest = list.slice(1).filter((v) => !plain.includes(v)).slice(0, over - plain.length);
    const gone = new Set([...plain, ...rest]);
    const kept = list.filter((v) => !gone.has(v));
    list.splice(0, list.length, ...kept);
    this.forget([...gone].map((v) => v.id));
  }

  private versions(key: string): Version[] {
    let list = this.byKey.get(key);
    if (!list) { list = []; this.byKey.set(key, list); }
    return list;
  }

  private save(v: Version): void {
    const copy = { ...v };
    this.writes = this.writes.then(() => this.backend.put(copy)).catch(() => { /* storage unavailable: kept for this session */ });
  }

  private forget(ids: string[]): void {
    this.writes = this.writes.then(() => this.backend.delete(ids)).catch(() => {});
  }

  private publish(): void { this.store.set({ revision: this.store.get().revision + 1 }); }
}
