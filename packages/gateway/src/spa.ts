import fs from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sendError } from './http.js';

/**
 * Serve the built web SPA (packages/web/dist) under /app. The gateway is the
 * single public edge, so the React app and its JSON API share an origin (cookies
 * flow, no CORS). Hashed assets under /app/assets/* are immutable-cached; every
 * other /app/* path returns index.html so client-side routing works.
 *
 * The gateway stays control-plane-only: this serves static files, it does not
 * render or interpret memory (H010). WEB_DIST is resolvable via env for non-default
 * layouts; the default is packages/web/dist relative to this compiled module.
 */
const WEB_DIST = process.env.WEB_DIST
  ? path.resolve(process.env.WEB_DIST)
  : fileURLToPath(new URL('../../web/dist/', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
};

function readFile(abs: string): Buffer | null {
  try {
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}

let indexCache: Buffer | null | undefined;
function indexHtml(): Buffer | null {
  if (indexCache === undefined) indexCache = readFile(path.join(WEB_DIST, 'index.html'));
  return indexCache;
}

export function isSpaPath(p: string): boolean {
  return p === '/app' || p === '/app/' || p.startsWith('/app/');
}

/** GET /app[/...] — serve a built asset, else index.html (SPA fallback). */
export function handleSpa(res: ServerResponse, p: string): void {
  if (p.startsWith('/app/') && p !== '/app/') {
    const rel = p.slice('/app/'.length);
    // Path-traversal guard: the resolved path must stay under WEB_DIST.
    if (!rel.includes('..')) {
      const abs = path.join(WEB_DIST, rel);
      if (abs.startsWith(WEB_DIST)) {
        const data = readFile(abs);
        if (data) {
          const ext = path.extname(abs);
          const immutable = rel.startsWith('assets/');
          res.writeHead(200, {
            'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
            'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
          });
          res.end(data);
          return;
        }
      }
    }
  }
  const html = indexHtml();
  if (!html) return sendError(res, 404, 'web app not built');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(html);
}
