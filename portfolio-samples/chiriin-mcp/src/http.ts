import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import type { Services } from './services.js';
import { VERSION } from './version.js';

export interface HttpServerOptions {
  port: number;
  host: string;
  services: Services;
  /**
   * Extra hostnames (without port) accepted in the Host / Origin headers when
   * listening on loopback, e.g. a name used by a local reverse proxy.
   */
  allowedHosts?: string[];
}

export interface RunningHttpServer {
  url: string;
  port: number;
  server: Server;
  close(): Promise<void>;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]'];

function hostnameOf(value: string | undefined, withScheme: boolean): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(withScheme ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * DNS-rebinding / cross-site protection for a server bound to loopback: the Host
 * header must name a loopback host, and a browser-sent Origin (if any) as well.
 */
export function isAllowedRequest(req: IncomingMessage, allowedHostnames: ReadonlySet<string>): boolean {
  const host = hostnameOf(req.headers.host, false);
  if (!host || !allowedHostnames.has(host)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const originHost = hostnameOf(origin, true);
  return originHost !== undefined && allowedHostnames.has(originHost);
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

function jsonRpcError(
  res: ServerResponse,
  status: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  sendJson(res, status, { jsonrpc: '2.0', error: { code: -32000, message }, id: null }, headers);
}

/**
 * Stateless Streamable HTTP endpoint at POST /mcp (one MCP server instance per
 * request; caches and rate limiters are shared through `services`).
 */
export async function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  const checkHosts = LOOPBACK.has(options.host);
  const allowedHostnames = new Set(
    [...LOOPBACK_HOSTNAMES, ...(options.allowedHosts ?? [])].map((h) => h.toLowerCase()),
  );

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/healthz') {
      sendJson(res, 200, { ok: true, name: 'chiriin-mcp', version: VERSION });
      return;
    }
    if (path !== '/mcp') {
      jsonRpcError(res, 404, 'Not found. The MCP endpoint is POST /mcp');
      return;
    }
    if (req.method !== 'POST') {
      // Stateless server: no standalone SSE stream (GET) and no sessions to delete (DELETE).
      jsonRpcError(res, 405, 'Method not allowed. Use POST /mcp', { Allow: 'POST' });
      return;
    }

    if (checkHosts && !isAllowedRequest(req, allowedHostnames)) {
      jsonRpcError(res, 403, 'Forbidden: unexpected Host or Origin header');
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createServer(options.services);
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('[chiriin-mcp] HTTP request failed:', error);
      if (!res.headersSent) jsonRpcError(res, 500, 'Internal server error');
    }
  };

  const httpServer = createHttpServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const port = (httpServer.address() as AddressInfo).port;
  const hostForUrl = options.host.includes(':') ? `[${options.host}]` : options.host;
  return {
    url: `http://${hostForUrl}:${port}/mcp`,
    port,
    server: httpServer,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.closeAllConnections();
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
