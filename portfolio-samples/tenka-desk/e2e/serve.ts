/**
 * Serves dist/ under a subpath (/tenka-desk/) for the Playwright tests, to check
 * that the build works from any folder (vite base './' and hash routes).
 */

import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'dist');
const BASE = '/tenka-desk/';
const PORT = Number(process.env['PORT'] ?? 4180);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/tenka-desk') {
    res.writeHead(302, { location: BASE });
    res.end();
    return;
  }
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const rel = decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html';
  const file = normalize(join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const st = await stat(file);
    const path = st.isDirectory() ? join(file, 'index.html') : file;
    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serving dist/ at http://127.0.0.1:${PORT}${BASE}`);
});
