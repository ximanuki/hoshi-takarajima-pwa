/**
 * Storage in this browser only: IndexedDB for the data (files, settings,
 * 協議記録) and localStorage for small view preferences. Nothing is sent
 * anywhere. Every call can fail (private windows, blocked site data), so the
 * callers treat storage as best effort and the app keeps working without it.
 */

const DB_NAME = 'tenka-desk';
const STORE = 'kv';
const PREF_PREFIX = 'tenka-desk:';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB を使えません'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB を開けません'));
    req.onblocked = () => reject(new Error('IndexedDB が別のタブで使用中です'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
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

/** Remove the whole database and every preference of this app. */
export async function clearAllStorage(): Promise<void> {
  try {
    const db = await dbPromise;
    db?.close();
  } catch {
    // the database never opened
  }
  dbPromise = null;
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
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
}

export function getPref(key: string): string | null {
  try {
    return localStorage.getItem(PREF_PREFIX + key);
  } catch {
    return null;
  }
}

export function setPref(key: string, value: string): void {
  try {
    localStorage.setItem(PREF_PREFIX + key, value);
  } catch {
    // ignore: a preference is a convenience only
  }
}
