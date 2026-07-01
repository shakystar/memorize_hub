import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { handleAsset, isAssetPath } from './assets.js';
import type { GatewayContext } from './context.js';
import { sendError, sendJson } from './http.js';
import { handleEventsProxy, handlePersonalStore } from './proxy.js';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  joinWorkspace,
  listInvites,
  listWorkspaces,
  mintInvite,
  removeMember,
  revokeInvite,
  setMemberRole,
} from './workspace.js';
import {
  handleAccount,
  handleAdmin,
  handleDocs,
  handleJoinPage,
  handleLanding,
  handleOAuthCallback,
} from './web.js';

/**
 * The Hub's public edge — the full v1 route table (docs/protocol/). It
 * authenticates accounts and reverse-proxies the relay; it never stores or
 * interprets event payloads itself. Handlers are dispatched here; each owns its
 * own auth via the shared principal/policy layer.
 */

const EVENTS_ROUTE = /^\/v1\/projects\/([^/]+)\/events$/;
const WS_ID = /^\/v1\/workspaces\/([^/]+)$/;
const WS_INVITES = /^\/v1\/workspaces\/([^/]+)\/invites$/;
const WS_INVITE_ID = /^\/v1\/workspaces\/([^/]+)\/invites\/([^/]+)$/;
const WS_MEMBER = /^\/v1\/workspaces\/([^/]+)\/members\/([^/]+)$/;

export interface GatewayServerOptions {
  db: GatewayContext['db'];
  config: GatewayContext['config'];
}

export function createGatewayServer(options: GatewayServerOptions): Server {
  const ctx: GatewayContext = { db: options.db, config: options.config };

  return createServer((req, res) => {
    void (async () => {
      try {
        await route(req, res, ctx);
      } catch (error) {
        console.error('gateway error:', error);
        if (!res.headersSent) sendError(res, 500, 'internal error');
        else res.end();
      }
    })();
  });
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://gateway.local');
  const p = url.pathname;

  // --- public / liveness -------------------------------------------------
  if (method === 'GET' && p === '/healthz') return sendJson(res, 200, { ok: true });
  if (method === 'GET' && isAssetPath(p)) return handleAsset(res, p);
  if (method === 'GET' && p === '/') return handleLanding(req, res, ctx);
  if (method === 'GET' && (p === '/docs' || p.startsWith('/docs/'))) return handleDocs(req, res, ctx, url);

  // --- browser (session) surfaces ---------------------------------------
  if (method === 'GET' && p === '/oauth/callback') return handleOAuthCallback(req, res, ctx, url);
  if (p === '/account' || p.startsWith('/account/')) return handleAccount(req, res, ctx, url);
  if (p === '/admin' || p.startsWith('/admin/')) return handleAdmin(req, res, ctx, url);
  if (method === 'GET' && p === '/join') return handleJoinPage(req, res, ctx, url);

  // --- account discovery (API key) --------------------------------------
  if (method === 'GET' && p === '/v1/account/personal-store') return handlePersonalStore(req, res, ctx);
  if (method === 'GET' && p === '/v1/account/workspaces') return listWorkspaces(req, res, ctx);

  // --- workspace control-plane (API key / session) ----------------------
  // Order: fixed paths and longer patterns before the generic /:id.
  if (method === 'POST' && p === '/v1/workspaces') return createWorkspace(req, res, ctx);
  if (method === 'POST' && p === '/v1/workspaces/join') return joinWorkspace(req, res, ctx);

  const inviteId = WS_INVITE_ID.exec(p);
  if (inviteId && method === 'DELETE') {
    return revokeInvite(req, res, ctx, decode(inviteId[1]), decode(inviteId[2]));
  }
  const invites = WS_INVITES.exec(p);
  if (invites) {
    if (method === 'POST') return mintInvite(req, res, ctx, decode(invites[1]));
    if (method === 'GET') return listInvites(req, res, ctx, decode(invites[1]));
  }
  const member = WS_MEMBER.exec(p);
  if (member) {
    if (method === 'PATCH') return setMemberRole(req, res, ctx, decode(member[1]), decode(member[2]));
    if (method === 'DELETE') return removeMember(req, res, ctx, decode(member[1]), decode(member[2]));
  }
  const wsId = WS_ID.exec(p);
  if (wsId) {
    if (method === 'GET') return getWorkspace(req, res, ctx, decode(wsId[1]));
    if (method === 'DELETE') return deleteWorkspace(req, res, ctx, decode(wsId[1]));
  }

  // --- data-plane events proxy (API key) --------------------------------
  const events = EVENTS_ROUTE.exec(p);
  if (events && (method === 'GET' || method === 'POST')) {
    return handleEventsProxy(req, res, ctx, decode(events[1]));
  }

  sendError(res, 404, 'not found');
}

/** Regex captures are `string | undefined` under strict; the pattern guarantees one. */
function decode(raw: string | undefined): string {
  return decodeURIComponent(raw ?? '');
}
