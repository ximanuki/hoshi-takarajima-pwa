import { describe, expect, it } from 'vitest';
import { TtlLruCache } from '../src/cache.js';
import { loadConfig } from '../src/config.js';
import { ChiriinError } from '../src/errors.js';
import { DEFAULT_HOST_POLICIES, type FetchLike, HttpClient, parseRetryAfter } from '../src/http-client.js';
import { SlidingWindowLimiter } from '../src/rate-limiter.js';
import { fakeClock } from './helpers/recorded.js';

type Step = Response | Error | (() => Response | Promise<Response>);

function scriptedFetch(steps: Step[], seen: { url: string; init?: RequestInit }[] = []): FetchLike {
  return async (url, init) => {
    seen.push(init === undefined ? { url } : { url, init });
    const step = steps.shift();
    if (!step) throw new Error('unexpected extra request');
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step() : step;
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const timeoutError = () =>
  Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

async function caught(promise: Promise<unknown>): Promise<ChiriinError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ChiriinError) return e;
    throw e;
  }
  throw new Error('expected a ChiriinError');
}

describe('HttpClient', () => {
  it('sends a descriptive User-Agent and parses JSON', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const http = new HttpClient({ fetch: scriptedFetch([json({ ok: 1 })], seen), clock: fakeClock() });
    await expect(http.getJson('https://msearch.gsi.go.jp/x')).resolves.toEqual({ ok: 1 });
    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^chiriin-mcp\/\d+\.\d+\.\d+ \(\+https:\/\//);
    expect(seen[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('retries timeouts and 5xx with backoff, then succeeds', async () => {
    const clock = fakeClock();
    const http = new HttpClient({
      fetch: scriptedFetch([timeoutError(), json({}, 503), json({ ok: true })]),
      clock,
      random: () => 1,
    });
    await expect(http.getJson('https://cyberjapandata2.gsi.go.jp/e')).resolves.toEqual({ ok: true });
    expect(clock.slept).toEqual([300, 600]);
  });

  it('honours Retry-After on 429 (capped at 4 s)', async () => {
    const clock = fakeClock();
    const http = new HttpClient({
      fetch: scriptedFetch([
        json({}, 429, { 'retry-after': '2' }),
        json({}, 429, { 'retry-after': '120' }),
        json(1),
      ]),
      clock,
    });
    await http.getJson('https://vldb.gsi.go.jp/a');
    expect(clock.slept.filter((ms) => ms >= 1000)).toEqual([2000, 4000]);
  });

  it('gives up after the configured retries with a bilingual timeout error', async () => {
    const http = new HttpClient({
      fetch: scriptedFetch([timeoutError(), timeoutError(), timeoutError()]),
      clock: fakeClock(),
      retries: 2,
      timeoutMs: 1234,
    });
    const error = await caught(http.getJson('https://msearch.gsi.go.jp/x'));
    expect(error.code).toBe('UPSTREAM_TIMEOUT');
    expect(error.messageJa).toContain('1234ms 以内に完了しませんでした');
    expect(error.messageEn).toContain('timed out after 1234ms');
    expect(error.hint).toContain('CHIRIIN_TIMEOUT_MS');
  });

  it('does not retry client errors', async () => {
    const steps: Step[] = [json({}, 400), json({ never: true })];
    const http = new HttpClient({ fetch: scriptedFetch(steps), clock: fakeClock() });
    const error = await caught(http.getJson('https://vldb.gsi.go.jp/a'));
    expect(error.code).toBe('UPSTREAM_HTTP');
    expect(error.messageEn).toBe('vldb.gsi.go.jp responded with HTTP 400');
    expect(steps).toHaveLength(1);
  });

  it('maps 404 to null only when allowed', async () => {
    const http = new HttpClient({ fetch: scriptedFetch([json({}, 404), json({}, 404)]), clock: fakeClock() });
    await expect(
      http.get('https://disaportaldata.gsi.go.jp/t.png', { allowNotFound: true }),
    ).resolves.toBeNull();
    expect((await caught(http.get('https://disaportaldata.gsi.go.jp/t.png'))).code).toBe('UPSTREAM_HTTP');
  });

  it('surfaces the underlying network error code', async () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND example.invalid'), { code: 'ENOTFOUND' });
    const failure = new TypeError('fetch failed', { cause });
    const http = new HttpClient({ fetch: scriptedFetch([failure]), clock: fakeClock(), retries: 0 });
    const error = await caught(http.get('https://msearch.gsi.go.jp/x'));
    expect(error.code).toBe('UPSTREAM_NETWORK');
    expect(error.messageEn).toContain('fetch failed: ENOTFOUND getaddrinfo ENOTFOUND');
  });

  it('enforces the response size cap via Content-Length and while streaming', async () => {
    const big = new Uint8Array(2048);
    const http = new HttpClient({
      fetch: scriptedFetch([
        new Response(big, { headers: { 'content-length': '2048' } }),
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(big);
              controller.close();
            },
          }),
        ),
      ]),
      clock: fakeClock(),
      maxResponseBytes: 1024,
    });
    expect((await caught(http.get('https://a.example/x'))).code).toBe('RESPONSE_TOO_LARGE');
    expect((await caught(http.get('https://a.example/x'))).code).toBe('RESPONSE_TOO_LARGE');
  });

  it('reports invalid JSON as a bad upstream response', async () => {
    const http = new HttpClient({ fetch: scriptedFetch([new Response('<html>')]), clock: fakeClock() });
    expect((await caught(http.getJson('https://msearch.gsi.go.jp/x'))).code).toBe('UPSTREAM_BAD_RESPONSE');
  });

  it('rate-limits per host (survey API: 9 requests per 10 s)', async () => {
    const clock = fakeClock();
    const steps = Array.from({ length: 10 }, () => json({}));
    const http = new HttpClient({ fetch: scriptedFetch(steps), clock });
    for (let i = 0; i < 10; i++) await http.get('https://vldb.gsi.go.jp/a');
    expect(DEFAULT_HOST_POLICIES['vldb.gsi.go.jp']).toEqual({ limit: 9, windowMs: 10_000 });
    expect(clock.slept).toEqual([10_000]);
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds and ignores garbage', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('SlidingWindowLimiter', () => {
  it('serves waiters in order and never exceeds the window', async () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowLimiter(2, 1000, clock);
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4, 5].map((n) => limiter.acquire().then(() => order.push(n))));
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(clock.now()).toBe(2000);
  });

  it('validates its arguments', () => {
    expect(() => new SlidingWindowLimiter(0, 1000)).toThrow(RangeError);
    expect(() => new SlidingWindowLimiter(1, 0)).toThrow(RangeError);
  });
});

describe('TtlLruCache', () => {
  it('expires entries, evicts the least recently used and de-duplicates loads', async () => {
    let now = 0;
    const cache = new TtlLruCache<number>(2, 100, () => now);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3); // evicts b
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    now = 150;
    expect(cache.get('a')).toBeUndefined();

    let loads = 0;
    const load = async () => {
      loads++;
      return 42;
    };
    const [x, y] = await Promise.all([cache.getOrLoad('k', load), cache.getOrLoad('k', load)]);
    expect([x, y, loads]).toEqual([42, 42, 1]);
  });

  it('does not cache failures', async () => {
    const cache = new TtlLruCache<number>(2, 100);
    await expect(cache.getOrLoad('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(cache.getOrLoad('k', async () => 7)).resolves.toBe(7);
  });
});

describe('loadConfig', () => {
  it('reads valid overrides and ignores invalid ones', () => {
    const config = loadConfig({
      CHIRIIN_TIMEOUT_MS: '5000',
      CHIRIIN_RETRIES: '9',
      CHIRIIN_USER_AGENT: ' my-agent ',
    });
    expect(config.timeoutMs).toBe(5000);
    expect(config.retries).toBe(2);
    expect(config.userAgent).toBe('my-agent');
  });
});
