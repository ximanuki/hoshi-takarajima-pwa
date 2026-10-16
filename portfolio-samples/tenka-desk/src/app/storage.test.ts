/**
 * 「データを消す」 while another tab keeps the database open: the browser cannot cancel the erase,
 * so it must be reported as done whenever it really happens, never as a failure in the meantime.
 * IndexedDB, localStorage and BroadcastChannel are stand-ins (the tests run in node).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllStorage } from './storage.ts';

interface FakeDeleteRequest {
  error: DOMException | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
}

let requests: FakeDeleteRequest[];
let store: Map<string, string>;
let posted: unknown[];

class FakeChannel {
  postMessage(m: unknown) {
    posted.push(m);
  }
  close() {}
}

beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  posted = [];
  store = new Map([
    ['tenka-desk:pref', '1'],
    ['other-app', 'keep'],
  ]);
  vi.stubGlobal('indexedDB', {
    deleteDatabase: () => {
      const r: FakeDeleteRequest = { error: null, onsuccess: null, onerror: null, onblocked: null };
      requests.push(r);
      return r;
    },
  });
  vi.stubGlobal('localStorage', {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => store.delete(k),
  });
  vi.stubGlobal('BroadcastChannel', FakeChannel);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Start clearing and wait until the delete request was made. */
async function startClear(onBlocked?: () => void) {
  const outcome: { value: 'pending' | 'done' | Error } = { value: 'pending' };
  clearAllStorage(onBlocked ? { onBlocked } : {}).then(
    () => {
      outcome.value = 'done';
    },
    (e: unknown) => {
      outcome.value = e instanceof Error ? e : new Error(String(e));
    },
  );
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  const req = requests[0] as FakeDeleteRequest;
  return { req, outcome };
}

describe('clearAllStorage', () => {
  it('erases, removes the preferences and tells the other tabs', async () => {
    const { req, outcome } = await startClear();
    req.onsuccess?.();
    await vi.waitFor(() => expect(outcome.value).toBe('done'));
    expect([...store.keys()]).toEqual(['other-app']);
    expect(posted).toEqual(['cleared']);
  });

  it('waits for a tab that keeps the database open, and finishes when that tab lets go', async () => {
    const onBlocked = vi.fn();
    const { req, outcome } = await startClear(onBlocked);
    req.onblocked?.();

    // the other tab stays open well past any grace period: still waiting, not a failure
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outcome.value).toBe('pending');
    expect(store.has('tenka-desk:pref')).toBe(true);
    expect(posted).toEqual([]);
    // so the screen can say what it waits for
    expect(onBlocked).toHaveBeenCalledTimes(1);

    // the browser erases the database as soon as the other tab closes
    req.onsuccess?.();
    await vi.waitFor(() => expect(outcome.value).toBe('done'));
    expect([...store.keys()]).toEqual(['other-app']);
    expect(posted).toEqual(['cleared']);
  });

  it('reports a real error, and leaves the preferences and the other tabs alone', async () => {
    const { req, outcome } = await startClear();
    req.error = new DOMException('Internal error', 'UnknownError');
    req.onerror?.();
    await vi.waitFor(() => expect(outcome.value).toBeInstanceOf(Error));
    expect((outcome.value as Error).message).toContain('データを消せませんでした');
    expect(store.has('tenka-desk:pref')).toBe(true);
    expect(posted).toEqual([]);
  });
});
