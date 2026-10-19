// Where this computer keeps what happened to the picture: scene versions and the changes the
// assistant and the director made. IndexedDB, in a database of its own (the assistant's transcripts'
// database is TanStack's to open and upgrade), never exported (a backup carries setup, not history).
// Without IndexedDB (tests, a locked-down browser) records live in memory for the session.

export interface Keyed { id: string }

export interface RecordStore<T extends Keyed> {
  all(): Promise<T[]>;
  put(record: T): Promise<void>;
  delete(ids: readonly string[]): Promise<void>;
}

const DB_NAME = 'hallucinate-history';
const DB_VERSION = 1;
export type StoreName = 'scene-versions' | 'changes';
const STORES: readonly StoreName[] = ['scene-versions', 'changes'];

let opening: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
  return opening;
}

function run<R>(store: StoreName, mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest<R> | void): Promise<R | undefined> {
  return open().then((db) => new Promise<R | undefined>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = act(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
  }));
}

export function indexedDBStore<T extends Keyed>(name: StoreName): RecordStore<T> {
  return {
    all: () => run<T[]>(name, 'readonly', (s) => s.getAll() as IDBRequest<T[]>).then((r) => r ?? []),
    put: (record) => run(name, 'readwrite', (s) => { s.put(record); }).then(() => {}),
    delete: (ids) => (ids.length ? run(name, 'readwrite', (s) => { for (const id of ids) s.delete(id); }).then(() => {}) : Promise.resolve()),
  };
}

export function memoryStore<T extends Keyed>(initial: readonly T[] = []): RecordStore<T> & { records: Map<string, T> } {
  const records = new Map(initial.map((r) => [r.id, structuredClone(r)]));
  return {
    records,
    all: async () => [...records.values()].map((r) => structuredClone(r)),
    put: async (r) => { records.set(r.id, structuredClone(r)); },
    delete: async (ids) => { for (const id of ids) records.delete(id); },
  };
}

// IndexedDB where there is one, else memory.
export function defaultStore<T extends Keyed>(name: StoreName): RecordStore<T> {
  return typeof indexedDB === 'undefined' ? memoryStore<T>() : indexedDBStore<T>(name);
}

let counter = 0;
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
