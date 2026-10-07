// Vitest setup: the test suite must never reach the internet. Every upstream
// response comes from test/recorded/ via recordedFetch(). Loopback is allowed so
// that the Streamable HTTP transport can be exercised against a local server.
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]') {
    return realFetch(input, init);
  }
  throw new Error(`Network access is disabled in tests: ${url.href}`);
}) as typeof fetch;
