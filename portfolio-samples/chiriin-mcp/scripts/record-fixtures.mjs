#!/usr/bin/env node
// Re-records the HTTP fixtures used by the test suite (test/recorded/).
//
//   npm run build && npm run record-fixtures
//
// Every scenario below is executed through the real MCP server (in-memory
// transport) with a fetch that performs the live request and saves the response,
// so the recorded URLs are exactly the ones the code requests. Tests then replay
// them with no network access.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_CONFIG } from '../dist/config.js';
import { createServer } from '../dist/server.js';
import { createServices } from '../dist/services.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test', 'recorded');

/** Keep in sync with the calls made in test/*.test.ts. */
export const SCENARIOS = [
  ['geocode_address', { query: '東京都千代田区永田町1-7-1' }],
  ['geocode_address', { query: '富士山', limit: 3 }],
  ['geocode_address', { query: '富士山頂' }],
  ['geocode_address', { query: 'あいうえおかきくけこ' }],
  ['get_elevation', { lat: 35.3606, lon: 138.7274 }],
  ['get_elevation', { lat: 34.0, lon: 141.5 }],
  ['get_hazard_info', { address: '東京都江東区東陽4-11-28' }],
  ['get_hazard_info', { lat: 34.4669, lon: 132.4766 }],
  ['get_hazard_info', { lat: 35.110623, lon: 139.085562 }],
  ['get_hazard_info', { lat: 35.100091, lon: 139.077752, layers: ['tsunami'], include_elevation: false }],
  [
    'calc_distance',
    { from: { lat: 36.10377477, lon: 140.08785502 }, to: { lat: 35.65502847, lon: 139.74475044 } },
  ],
  ['latlon_to_plane', { lat: 36.103774791, lon: 140.087855041, zone: 9 }],
  ['latlon_to_plane', { address: '茨城県つくば市北郷1' }],
  ['plane_to_latlon', { x: 11543.6883, y: 22916.2436, zone: 9 }],
  ['get_geoid_height', { lat: 36.103774791, lon: 140.087855041 }],
  ['get_geoid_height', { lat: 33.1, lon: 139.79, ellipsoidal_height: 100 }],
];

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

function fileNameFor(url, contentType, body) {
  const u = new URL(url);
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 10);
  const host = u.hostname.split('.')[0];
  // Some tiles are served as application/octet-stream, so sniff the bytes.
  const isPng = PNG_MAGIC.every((b, i) => body[i] === b);
  const ext = isPng ? 'png' : contentType?.includes('json') ? 'json' : 'bin';
  if (u.hostname === 'disaportaldata.gsi.go.jp') {
    const [, , layer, z, x, y] = u.pathname.split('/');
    return `tile-${layer}-${z}-${x}-${y.replace('.png', '')}.${ext}`;
  }
  return `${host}-${hash}.${ext}`;
}

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) rmSync(join(outDir, f));

const manifest = {};
const realFetch = globalThis.fetch;
async function recordingFetch(url, init) {
  const res = await realFetch(url, init);
  const body = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get('content-type');
  const file = fileNameFor(url, contentType, body);
  writeFileSync(join(outDir, file), body);
  manifest[url] = { status: res.status, contentType, file };
  return new Response(res.status === 204 ? null : body, {
    status: res.status,
    headers: contentType ? { 'content-type': contentType } : {},
  });
}

const services = createServices({ config: DEFAULT_CONFIG, fetch: recordingFetch });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createServer(services);
await server.connect(serverTransport);
const client = new Client({ name: 'fixture-recorder', version: '0.0.0' });
await client.connect(clientTransport);

for (const [name, args] of SCENARIOS) {
  const result = await client.callTool({ name, arguments: args });
  const status = result.isError ? 'isError' : 'ok';
  console.log(`${status.padEnd(7)} ${name} ${JSON.stringify(args)}`);
}
await client.close();

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(
  join(outDir, 'manifest.json'),
  `${JSON.stringify({ recordedAt: new Date().toISOString(), responses: sorted }, null, 2)}\n`,
);
console.log(`\nrecorded ${Object.keys(sorted).length} responses into ${outDir}`);
