#!/usr/bin/env node
// Opt-in live smoke test: spawns the built server over stdio, calls every tool
// against the real GSI APIs and prints a short excerpt of each result.
//
//   npm run build && npm run smoke            # all tools, stdio
//   npm run smoke -- --http                   # same, through the Streamable HTTP transport
//
// Not part of `npm test` (which never touches the network).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'dist', 'index.js');
const useHttp = process.argv.includes('--http');
const maxLines = Number(process.env.SMOKE_LINES ?? 8);

const CALLS = [
  ['geocode_address', { query: '東京都千代田区永田町1-7-1', limit: 3 }],
  ['get_elevation', { address: '富士山頂' }],
  ['get_elevation', { lat: 35.3606, lon: 138.7274 }],
  ['get_hazard_info', { address: '東京都江東区東陽4-11-28' }],
  [
    'get_hazard_info',
    { lat: 35.110623, lon: 139.085562, layers: ['debris_flow', 'steep_slope', 'landslide', 'tsunami'] },
  ],
  [
    'calc_distance',
    { from: { address: '茨城県つくば市北郷1' }, to: { address: '東京都千代田区丸の内1-9-1' } },
  ],
  ['latlon_to_plane', { address: '茨城県つくば市北郷1' }],
  ['plane_to_latlon', { x: 11543.6883, y: 22916.2436, zone: 9 }],
  ['get_geoid_height', { lat: 33.1, lon: 139.79, ellipsoidal_height: 100 }],
];

async function connect() {
  const client = new Client({ name: 'chiriin-smoke', version: '0.0.0' });
  if (!useHttp) {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [entry],
        stderr: 'inherit',
        env: { ...process.env },
      }),
    );
    return { client, stop: async () => client.close() };
  }
  const child = spawn(process.execPath, [entry, '--http', '--port', '0'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: process.env,
  });
  const url = await new Promise((resolve, reject) => {
    let buf = '';
    child.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/listening on (http:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    child.on('exit', (code) => reject(new Error(`server exited (${code}): ${buf}`)));
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return {
    client,
    stop: async () => {
      await client.close();
      child.kill();
    },
  };
}

const { client, stop } = await connect();
let failures = 0;
try {
  const { tools } = await client.listTools();
  console.log(
    `transport=${useHttp ? 'streamable-http' : 'stdio'} tools=${tools.map((t) => t.name).join(', ')}\n`,
  );
  for (const [name, args] of CALLS) {
    const started = Date.now();
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
    const ok = !result.isError;
    if (!ok) failures++;
    console.log(`=== ${name} ${JSON.stringify(args)} — ${ok ? 'OK' : 'ERROR'} (${Date.now() - started} ms)`);
    console.log(text.split('\n').slice(0, maxLines).join('\n'));
    console.log('');
  }
} finally {
  await stop();
}
if (failures > 0) {
  console.error(`${failures} call(s) failed`);
  process.exit(1);
}
