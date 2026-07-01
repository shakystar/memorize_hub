import type { IncomingMessage, ServerResponse } from 'node:http';

import type { GatewayContext } from './context.js';
import { notImplemented } from './http.js';

/**
 * Browser (session) surfaces (docs/protocol/README.md §6). These use the OAuth
 * session principal, not an API key: `/account` (self-service keys + workspaces),
 * `/admin` (operator dashboard, allowlist-gated), `/join` (human invite landing),
 * `/oauth/callback`. Ported from the legacy session/oauth/account/dashboard core.
 *
 * @remarks Skeleton — landing/health-ish pages are minimal; auth'd pages 501 until
 * the session/oauth core is ported. `_ctx`/`_url` unused until then.
 */

/** GET / — public landing. Minimal so uptime checks see a 200. */
export function handleLanding(_req: IncomingMessage, res: ServerResponse, _ctx: GatewayContext): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>memorize Hub</title><h1>memorize Hub</h1><p>Control-plane gateway. See /docs.</p>');
}

/** GET /docs[/...] — public docs surface. */
export function handleDocs(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
  _url: URL,
): void {
  notImplemented(res, 'GET /docs');
}

/** GET /oauth/callback — shared OAuth return point (session + /join flows). */
export function handleOAuthCallback(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
  _url: URL,
): void {
  notImplemented(res, 'GET /oauth/callback');
}

/** /account[/...] — participant self-service (session; 503 if OAuth unconfigured). */
export function handleAccount(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
  _url: URL,
): void {
  notImplemented(res, '/account');
}

/** /admin[/...] — operator dashboard (session + allowlist; 503 if unconfigured). */
export function handleAdmin(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
  _url: URL,
): void {
  notImplemented(res, '/admin');
}

/** GET /join?token=… — human invite landing; session redeem of the join capability. */
export function handleJoinPage(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
  _url: URL,
): void {
  notImplemented(res, 'GET /join');
}
