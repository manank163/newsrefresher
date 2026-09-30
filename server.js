// Local dev server: serves public/ and the same /api handlers Vercel runs.
//   npm run dev            -> live data
//   npm run demo           -> fictitious demo data (no network needed)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import feed from './api/feed.js';
import config from './api/config.js';
import agent from './api/agent.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const routes = { '/api/feed': feed, '/api/config': config, '/api/agent': agent };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (routes[pathname]) return routes[pathname](req, res);
  const file = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  try {
    const body = await readFile(file);
    res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`Deal Pulse on http://localhost:${port}${process.env.DEMO_MODE === '1' ? ' (demo data)' : ''}`);
});
