import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RunningHttpServer, startHttpServer } from '../src/http.js';
import { recordedServices } from './helpers/recorded.js';

let running: RunningHttpServer;
beforeAll(async () => {
  running = await startHttpServer({ port: 0, host: '127.0.0.1', services: recordedServices() });
});
afterAll(async () => {
  await running.close();
});

describe('Streamable HTTP transport (stateless)', () => {
  it('serves tools over POST /mcp', async () => {
    const client = new Client({ name: 'http-test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(running.url)));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(7);
    const result = await client.callTool({
      name: 'get_elevation',
      arguments: { lat: 35.3606, lon: 138.7274 },
    });
    expect(result.structuredContent).toMatchObject({ elevationM: 3770.6 });
    await client.close();
  });

  it('has a health endpoint and rejects other methods and paths', async () => {
    const base = running.url.replace(/\/mcp$/, '');
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ ok: true, name: 'chiriin-mcp' });

    const get = await fetch(running.url);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');

    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  async function rawPost(headers: Record<string, string>, url = running.url): Promise<number> {
    const { request } = await import('node:http');
    return new Promise<number>((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...headers,
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }));
    });
  }

  it('blocks a foreign Host header (DNS rebinding) and cross-site Origins', async () => {
    expect(await rawPost({ host: 'evil.example' })).toBe(403);
    expect(await rawPost({ origin: 'https://evil.example' })).toBe(403);
    expect(await rawPost({ origin: 'not a url' })).toBe(403);
  });

  it('accepts loopback Host/Origin headers', async () => {
    expect(await rawPost({ host: `localhost:${running.port}` })).toBe(200);
    expect(await rawPost({ origin: `http://127.0.0.1:${running.port}` })).toBe(200);
  });

  it('accepts extra hostnames configured with allowedHosts', async () => {
    const extra = await startHttpServer({
      port: 0,
      host: '127.0.0.1',
      services: recordedServices(),
      allowedHosts: ['mcp.internal'],
    });
    const status = await rawPost({ host: 'mcp.internal:8080' }, extra.url);
    await extra.close();
    expect(status).toBe(200);
  });
});
