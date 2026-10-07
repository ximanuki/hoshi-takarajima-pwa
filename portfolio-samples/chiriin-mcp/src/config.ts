import { HOMEPAGE, PACKAGE_NAME, VERSION } from './version.js';

export interface Config {
  /** Per-request timeout including body download (ms). */
  timeoutMs: number;
  /** Extra attempts after the first one for retryable failures. */
  retries: number;
  /** Sent as User-Agent so that GSI can identify the client. */
  userAgent: string;
  /** Upper bound for a single upstream response body (bytes). */
  maxResponseBytes: number;
}

export const DEFAULT_CONFIG: Config = {
  timeoutMs: 10_000,
  retries: 2,
  userAgent: `${PACKAGE_NAME}/${VERSION} (+${HOMEPAGE})`,
  maxResponseBytes: 2 * 1024 * 1024,
};

function readInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    timeoutMs: readInt(env.CHIRIIN_TIMEOUT_MS, DEFAULT_CONFIG.timeoutMs, 1_000, 120_000),
    retries: readInt(env.CHIRIIN_RETRIES, DEFAULT_CONFIG.retries, 0, 5),
    userAgent: env.CHIRIIN_USER_AGENT?.trim() || DEFAULT_CONFIG.userAgent,
    maxResponseBytes: readInt(
      env.CHIRIIN_MAX_RESPONSE_BYTES,
      DEFAULT_CONFIG.maxResponseBytes,
      64 * 1024,
      50 * 1024 * 1024,
    ),
  };
}
