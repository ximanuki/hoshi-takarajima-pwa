import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Clock } from '../../src/clock.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { FetchLike } from '../../src/http-client.js';
import { createServer } from '../../src/server.js';
import { createServices, type Services } from '../../src/services.js';

export const RECORDED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'recorded');

interface ManifestEntry {
  status: number;
  contentType: string | null;
  file: string;
}

const manifest = JSON.parse(readFileSync(join(RECORDED_DIR, 'manifest.json'), 'utf8')) as {
  recordedAt: string;
  responses: Record<string, ManifestEntry>;
};

export function recordedBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(RECORDED_DIR, file)));
}

export function recordedUrls(): string[] {
  return Object.keys(manifest.responses);
}

/** Replays responses captured by scripts/record-fixtures.mjs; unknown URLs fail loudly. */
export function recordedFetch(requested: string[] = []): FetchLike {
  return async (url) => {
    requested.push(url);
    const entry = manifest.responses[url];
    if (!entry) {
      throw new Error(`No recorded response for ${url} — run "npm run build && npm run record-fixtures"`);
    }
    return new Response(recordedBytes(entry.file), {
      status: entry.status,
      headers: entry.contentType ? { 'content-type': entry.contentType } : {},
    });
  };
}

/** Clock whose sleep() resolves immediately while advancing virtual time. */
export function fakeClock(start = 0): Clock & { slept: number[] } {
  let now = start;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
  };
}

export const FIXED_NOW = new Date('2026-10-06T03:00:00Z');

export function recordedServices(fetchImpl: FetchLike = recordedFetch()): Services {
  return createServices({
    config: DEFAULT_CONFIG,
    fetch: fetchImpl,
    clock: fakeClock(),
    now: () => FIXED_NOW,
  });
}

/** MCP client connected in-process to a server backed by recorded responses. */
export async function connectClient(services: Services = recordedServices()): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(services).connect(serverTransport);
  const client = new Client({ name: 'chiriin-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

export async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

export function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first?.type === 'text' ? first.text : '';
}
