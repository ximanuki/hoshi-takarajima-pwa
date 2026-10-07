import { type Clock, systemClock } from './clock.js';
import { DEFAULT_CONFIG } from './config.js';
import { ChiriinError } from './errors.js';
import { SlidingWindowLimiter } from './rate-limiter.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HostPolicy {
  /** Max requests per window for this host. */
  limit: number;
  windowMs: number;
}

/**
 * Per-host politeness limits.
 * - vldb.gsi.go.jp (測量計算サイト): documented hard limit of 10 requests / 10 s per IP. We keep 1 in reserve.
 * - the other hosts have no published number but ask clients not to overload them.
 */
export const DEFAULT_HOST_POLICIES: Readonly<Record<string, HostPolicy>> = {
  'vldb.gsi.go.jp': { limit: 9, windowMs: 10_000 },
  'msearch.gsi.go.jp': { limit: 5, windowMs: 1_000 },
  'cyberjapandata2.gsi.go.jp': { limit: 5, windowMs: 1_000 },
  'disaportaldata.gsi.go.jp': { limit: 20, windowMs: 1_000 },
};

const FALLBACK_POLICY: HostPolicy = { limit: 5, windowMs: 1_000 };

export interface HttpClientOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
  maxResponseBytes?: number;
  clock?: Clock;
  random?: () => number;
  policies?: Readonly<Record<string, HostPolicy>>;
}

export interface HttpResponse {
  status: number;
  contentType: string | null;
  body: Uint8Array;
}

export interface GetOptions {
  /** Return `null` instead of throwing when the server answers 404 (used for map tiles). */
  allowNotFound?: boolean;
  accept?: string;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_BACKOFF_MS = 4_000;

/**
 * fetch wrapper with timeout, bounded retries (exponential backoff + jitter,
 * honouring Retry-After), per-host rate limiting and a response-size cap.
 */
export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly userAgent: string;
  private readonly maxResponseBytes: number;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly policies: Readonly<Record<string, HostPolicy>>;
  private readonly limiters = new Map<string, SlidingWindowLimiter>();

  constructor(options: HttpClientOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_CONFIG.timeoutMs;
    this.retries = options.retries ?? DEFAULT_CONFIG.retries;
    this.userAgent = options.userAgent ?? DEFAULT_CONFIG.userAgent;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_CONFIG.maxResponseBytes;
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.policies = options.policies ?? DEFAULT_HOST_POLICIES;
  }

  async get(url: string, options: GetOptions & { allowNotFound: true }): Promise<HttpResponse | null>;
  async get(url: string, options?: GetOptions): Promise<HttpResponse>;
  async get(url: string, options: GetOptions = {}): Promise<HttpResponse | null> {
    const host = new URL(url).host;
    const limiter = this.limiterFor(host);
    let lastError: ChiriinError | undefined;
    let retryAfterMs: number | undefined;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await this.clock.sleep(this.backoffMs(attempt, retryAfterMs));
      retryAfterMs = undefined;
      await limiter.acquire();

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { 'User-Agent': this.userAgent, Accept: options.accept ?? '*/*' },
          redirect: 'follow',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        lastError = this.transportError(host, error);
        continue;
      }

      if (response.status === 404 && options.allowNotFound) {
        await discardBody(response);
        return null;
      }

      if (!response.ok) {
        await discardBody(response);
        const retryable = RETRYABLE_STATUS.has(response.status);
        lastError = new ChiriinError({
          code: 'UPSTREAM_HTTP',
          ja: `${host} が HTTP ${response.status} を返しました`,
          en: `${host} responded with HTTP ${response.status}`,
          retryable,
          ...(retryable ? { hint: '時間をおいて再実行してください。' } : {}),
        });
        if (retryable) {
          retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
          continue;
        }
        throw lastError;
      }

      try {
        const body = await this.readLimited(response, host);
        return { status: response.status, contentType: response.headers.get('content-type'), body };
      } catch (error) {
        if (error instanceof ChiriinError && !error.retryable) throw error;
        lastError = this.transportError(host, error);
      }
    }

    throw (
      lastError ??
      new ChiriinError({ code: 'INTERNAL', ja: '不明な通信エラーです', en: 'Unknown transport failure' })
    );
  }

  async getJson(url: string): Promise<unknown> {
    const response = await this.get(url, { accept: 'application/json' });
    const host = new URL(url).host;
    const text = new TextDecoder('utf-8').decode(response.body);
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new ChiriinError({
        code: 'UPSTREAM_BAD_RESPONSE',
        ja: `${host} の応答が JSON として解釈できませんでした`,
        en: `Could not parse the response from ${host} as JSON`,
        cause: error,
      });
    }
  }

  /** Delay before retry number `attempt` (1-based). Retry-After wins when the server sent one. */
  private backoffMs(attempt: number, retryAfterMs: number | undefined): number {
    if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_BACKOFF_MS);
    const base = Math.min(300 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
    return Math.round(base * (0.5 + this.random() * 0.5));
  }

  private limiterFor(host: string): SlidingWindowLimiter {
    let limiter = this.limiters.get(host);
    if (!limiter) {
      const policy = this.policies[host] ?? FALLBACK_POLICY;
      limiter = new SlidingWindowLimiter(policy.limit, policy.windowMs, this.clock);
      this.limiters.set(host, limiter);
    }
    return limiter;
  }

  private transportError(host: string, error: unknown): ChiriinError {
    if (error instanceof ChiriinError) return error;
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return new ChiriinError({
        code: 'UPSTREAM_TIMEOUT',
        ja: `${host} への接続が ${this.timeoutMs}ms 以内に完了しませんでした`,
        en: `Request to ${host} timed out after ${this.timeoutMs}ms`,
        hint: 'ネットワーク状況を確認するか、CHIRIIN_TIMEOUT_MS を大きくしてください。',
        retryable: true,
        cause: error,
      });
    }
    const detail = describeNetworkError(error);
    return new ChiriinError({
      code: 'UPSTREAM_NETWORK',
      ja: `${host} に接続できませんでした（${detail}）`,
      en: `Could not reach ${host} (${detail})`,
      hint: 'ネットワーク接続やプロキシ設定を確認してください。',
      retryable: true,
      cause: error,
    });
  }

  private async readLimited(response: Response, host: string): Promise<Uint8Array> {
    const tooLarge = () =>
      new ChiriinError({
        code: 'RESPONSE_TOO_LARGE',
        ja: `${host} の応答が上限 ${this.maxResponseBytes} バイトを超えました`,
        en: `Response from ${host} exceeded the ${this.maxResponseBytes}-byte limit`,
      });
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
      await discardBody(response);
      throw tooLarge();
    }
    if (!response.body) return new Uint8Array(0);

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

/** "fetch failed" alone is useless; surface the underlying cause (e.g. ENOTFOUND, ECONNRESET). */
export function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: unknown }).code;
    return `${error.message}: ${typeof code === 'string' ? `${code} ` : ''}${cause.message}`.trim();
  }
  return error.message;
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // ignore
  }
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}
