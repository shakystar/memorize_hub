import type { IncomingMessage, ServerResponse } from 'node:http';

import type Database from 'better-sqlite3';

import type { GatewayConfig } from './config.js';
import { hasProjectAccess, identifyToken, touchToken } from './store.js';

/** Mirrors the relay's path-id contract (PROTOCOL.md). */
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024;

export interface ProxyContext {
  db: Database.Database;
  config: GatewayConfig;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Authenticate the participant API key, enforce project scope, then transparently
 * forward the request to the internal relay (presenting the relay's own token).
 * Relay responses pass straight back — the wire shape (SyncPush/PullResponse) is
 * never reinterpreted, so the relay stays the sole authority on the protocol.
 */
export async function handleEventsProxy(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string,
  ctx: ProxyContext,
): Promise<void> {
  const key = bearerToken(req);
  if (!key) {
    sendJson(res, 401, { error: 'missing or malformed Authorization bearer token' });
    return;
  }
  const identity = identifyToken(ctx.db, key);
  if (!identity) {
    sendJson(res, 401, { error: 'invalid or revoked API key' });
    return;
  }
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    sendJson(res, 400, { error: 'invalid project id' });
    return;
  }
  if (!hasProjectAccess(ctx.db, identity.userId, projectId)) {
    sendJson(res, 403, { error: 'API key is not scoped to this project' });
    return;
  }

  let body: Buffer | undefined;
  if (req.method === 'POST') {
    try {
      body = await readBody(req, MAX_PROXY_BODY_BYTES);
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode ?? 400;
      sendJson(res, status, { error: status === 413 ? 'payload too large' : 'bad request' });
      return;
    }
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ctx.config.relayToken) headers.authorization = `Bearer ${ctx.config.relayToken}`;

  let relayRes: Response;
  try {
    relayRes = await fetch(`${ctx.config.relayUrl}${req.url ?? ''}`, {
      method: req.method ?? 'GET',
      headers,
      ...(body && body.length > 0 ? { body } : {}),
    });
  } catch {
    sendJson(res, 502, { error: 'relay unreachable' });
    return;
  }

  touchToken(ctx.db, identity.tokenId);
  const text = await relayRes.text();
  res.writeHead(relayRes.status, {
    'content-type': relayRes.headers.get('content-type') ?? 'application/json',
  });
  res.end(text);
}
