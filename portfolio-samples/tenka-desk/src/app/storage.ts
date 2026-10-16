/**
 * Storage in this browser only: IndexedDB for the data (files, settings,
 * 協議記録). Nothing is sent anywhere. Every call can fail (private windows, blocked site data), so the
 * callers treat storage as best effort and the app keeps working without it.
 */

const DB_NAME = 'tenka-desk';
const STORE = 'kv';
/** prefix of any localStorage key this app may have written (removed by clearAllStorage) */
const PREF_PREFIX = 'tenka-desk:';

let dbPromise: Promise<IDBDatabase> | null = null;

/** tells this app's other tabs that the data was erased here, so they drop what they still show */
const CHANNEL = 'tenka-desk';

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opened = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB を使えません'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab is erasing (or upgrading) the database: let go of it instead of blocking that tab.
      db.onversionchange = () => {
        db.close();
        if (dbPromise === opened) dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB を開けません'));
    req.onblocked = () => reject(new Error('IndexedDB が別のタブで使用中です'));
  });
  dbPromise = opened;
  opened.catch(() => {
    if (dbPromise === opened) dbPromise = null;
  });
  return opened;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error('保存に失敗しました'));
        tx.onabort = () => reject(tx.error ?? new Error('保存を中止しました'));
      }),
  );
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  return (await run<unknown>('readonly', (s) => s.get(key))) as T | undefined;
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  await run('readwrite', (s) => s.put(value, key));
}

export async function idbDelete(key: string): Promise<void> {
  await run('readwrite', (s) => s.delete(key));
}

export interface ClearOptions {
  /**
   * Called when another tab (for example one still running an older version of the app) keeps the
   * database open. The erase is not given up: it goes on as soon as that tab is closed.
   */
  onBlocked?: () => void;
}

/**
 * Remove the whole database and every preference of this app, and tell the app's other
 * tabs. Resolves only once the database is really gone, however long another tab keeps it
 * open: the browser cannot cancel a started erase, so reporting a failure in the meantime
 * would be wrong. Rejects when the browser could not erase it.
 */
export async function clearAllStorage(opts: ClearOptions = {}): Promise<void> {
  try {
    const db = await dbPromise;
    db?.close();
  } catch {
    // the database never opened
  }
  dbPromise = null;
  if (typeof indexedDB !== 'undefined') {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(
          new Error(`データを消せませんでした${req.error?.message ? `（${req.error.message}）` : ''}。`),
        );
      // Other tabs of this app close their connection on versionchange; one that does not holds the erase.
      req.onblocked = () => opts.onBlocked?.();
    });
  }
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREF_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // localStorage is not available
  }
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage('cleared');
    ch.close();
  } catch {
    // BroadcastChannel is not available
  }
}

/** Calls `onCleared` when another tab of this app erased the data; returns the unsubscribe. */
export function onClearedElsewhere(onCleared: () => void): () => void {
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => {
      if (e.data === 'cleared') onCleared();
    };
    return () => ch.close();
  } catch {
    return () => {};
  }
}
