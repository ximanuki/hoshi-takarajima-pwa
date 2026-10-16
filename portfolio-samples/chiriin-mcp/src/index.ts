#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { startHttpServer } from './http.js';
import { createServer } from './server.js';
import { createServices } from './services.js';
import { VERSION } from './version.js';

const HELP = `chiriin-mcp ${VERSION} — 国土地理院の公開API・オープンデータを使う MCP サーバー

使い方 / Usage:
  chiriin-mcp                 stdio で起動（Claude Desktop / Claude Code 向け）
  chiriin-mcp --http          Streamable HTTP で起動（POST /mcp, GET /healthz）
    --port <n>                待ち受けポート（既定 3000、環境変数 PORT）
    --host <addr>             待ち受けアドレス（既定 127.0.0.1、環境変数 HOST）
    --allowed-host <name>     Host / Origin として追加で許可するホスト名（複数可）
  chiriin-mcp --version | --help

環境変数 / Environment:
  CHIRIIN_TIMEOUT_MS          API 1 回あたりのタイムアウト（既定 10000）
  CHIRIIN_RETRIES             再試行回数（既定 2）
  CHIRIIN_USER_AGENT          User-Agent を上書き
  CHIRIIN_MAX_RESPONSE_BYTES  応答サイズの上限（既定 2097152）
  MCP_TRANSPORT=http          --http と同じ
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      http: { type: 'boolean', default: false },
      port: { type: 'string' },
      host: { type: 'string' },
      'allowed-host': { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    strict: true,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const services = createServices({ config: loadConfig() });

  if (values.http || process.env.MCP_TRANSPORT === 'http') {
    const port = Number(values.port ?? process.env.PORT ?? 3000);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port: ${values.port}`);
    const host = values.host ?? process.env.HOST ?? '127.0.0.1';
    const running = await startHttpServer({
      port,
      host,
      services,
      allowedHosts: values['allowed-host'] ?? [],
    });
    console.error(`[chiriin-mcp] Streamable HTTP server listening on ${running.url}`);
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      console.error('[chiriin-mcp] Warning: listening on a non-loopback address without authentication.');
    }
    const shutdown = () => {
      void running.close().finally(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  const server = createServer(services);
  await server.connect(new StdioServerTransport());
  console.error(`[chiriin-mcp] ${VERSION} running on stdio`);
}

main().catch((error: unknown) => {
  console.error('[chiriin-mcp] fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
