import fs from 'node:fs';
import type { ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

import { sendError } from './http.js';

/**
 * Static asset serving for the built Tailwind stylesheet. `pnpm build:css` emits
 * `dist/public/app.css`; this module resolves that path relative to the compiled
 * output and serves it, memoized in memory (the file is small and immutable per
 * build). The only asset today is the stylesheet, so the route table is a fixed
 * allowlist — no user-controlled path ever reaches the filesystem.
 */

/** Compiled location: this file is dist/assets.js, so public/ is a sibling dir. */
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

const ASSETS: Record<string, { file: string; contentType: string }> = {
  '/assets/app.css': { file: 'app.css', contentType: 'text/css; charset=utf-8' },
};

/** Read-once cache: path -> file contents (or null if the file is missing). */
const cache = new Map<string, Buffer | null>();

function load(file: string): Buffer | null {
  if (cache.has(file)) return cache.get(file)!;
  let data: Buffer | null;
  try {
    data = fs.readFileSync(PUBLIC_DIR + file);
  } catch {
    data = null;
  }
  cache.set(file, data);
  return data;
}

/** True if `path` maps to a known static asset (so the router can dispatch here). */
export function isAssetPath(path: string): boolean {
  return path in ASSETS;
}

/** Serve a known static asset. Unknown path -> 404; missing built file -> 404. */
export function handleAsset(res: ServerResponse, path: string): void {
  const asset = ASSETS[path];
  if (!asset) return sendError(res, 404, 'not found');
  const data = load(asset.file);
  if (!data) return sendError(res, 404, 'asset not built');
  res.writeHead(200, {
    'content-type': asset.contentType,
    'cache-control': 'public, max-age=3600',
  });
  res.end(data);
}
