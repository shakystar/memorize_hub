import type { IncomingMessage, ServerResponse } from 'node:http';

import type { GatewayContext } from './context.js';
import { readBody, sendError, sendJson } from './http.js';
import { isValidStoreId } from './ids.js';
import { touchToken } from './keys.js';
import { getOrCreatePersonalStore } from './personal-store.js';
import { authorize } from './policy.js';
import { resolveKeyPrincipal } from './principal.js';
import { recordUsage } from './usage.js';
import { getOrCreateDerivedStore, isArtifactKind } from './derived-stores.js';

/**
 * Data-plane reverse proxy to the dumb relay (docs/protocol/transport.md +
 * personal-store.md; workspace.md §data-plane arrives in S5).
 *
 * The gateway authenticates the account key, resolves the store kind, runs the
 * COARSE ACL via policy.authorize(), then forwards the request to the relay with
 * the internal token. Relay responses pass straight back — the wire shape is never
 * reinterpreted, so the relay stays the sole authority on the protocol (H010).
 */

const MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024;

/** GET/POST /v1/projects/:storeId/events — authenticate + authorize + forward. */
export async function handleEventsProxy(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  storeId: string,
): Promise<void> {
  const principal = resolveKeyPrincipal(ctx.db, req);
  if (!principal) {
    sendError(res, 401, 'missing or invalid API key');
    return;
  }
  // The id becomes a relay filesystem path component — validate before storage
  // (README §1; also closes path traversal). Server-minted ids always conform.
  if (!isValidStoreId(storeId)) {
    sendError(res, 400, 'invalid store id');
    return;
  }

  const action = req.method === 'POST' ? 'write' : 'read';
  const decision = authorize(ctx.db, principal, { kind: 'store', storeId }, action);
  if (!decision.ok) {
    sendError(res, decision.status, decision.error ?? 'forbidden');
    return;
  }

  let body: Buffer | undefined;
  if (req.method === 'POST') {
    try {
      body = await readBody(req, MAX_PROXY_BODY_BYTES);
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode ?? 400;
      sendError(res, status, status === 413 ? 'payload too large' : 'bad request');
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
    sendError(res, 502, 'relay unreachable');
    return;
  }

  if (principal.tokenId) touchToken(ctx.db, principal.tokenId);
  const text = await relayRes.text();
  // Meter bytes for cost visibility (usage.ts). Best-effort — a metering failure
  // must never break the proxied response, so it's isolated from the reply.
  try {
    recordUsage(ctx.db, storeId, body?.length ?? 0, Buffer.byteLength(text));
  } catch (error) {
    console.error('[gateway] usage metering failed:', error);
  }
  res.writeHead(relayRes.status, {
    'content-type': relayRes.headers.get('content-type') ?? 'application/json',
  });
  res.end(text);
}

/**
 * GET /v1/account/personal-store — resolve the caller's account (by API key) to
 * its `psm_` id, provisioning one on first call (personal-store.md). Only an
 * unscoped key qualifies; a scoped key cannot reach personal memory (README §3).
 */
export function handlePersonalStore(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
): void {
  const principal = resolveKeyPrincipal(ctx.db, req);
  if (!principal) {
    sendError(res, 401, 'missing or invalid API key');
    return;
  }
  if (principal.scoped) {
    sendError(res, 403, 'this key is not scoped for personal memory');
    return;
  }
  const { storeId } = getOrCreatePersonalStore(ctx.db, principal.accountId);
  if (principal.tokenId) touchToken(ctx.db, principal.tokenId);
  sendJson(res, 200, { storeId, eventsUrl: `/v1/projects/${storeId}/events` });
}

/**
 * GET /v1/stores/:parentStoreId/derived/:artifactKind — resolve (or provision on
 * first call) the sidecar store that carries a regenerable artifact for a parent
 * source store (spec 2026-07-04-derived-sidecar-store; docs/protocol/derived-store.md).
 * Discovery only needs READ on the parent; pushing derived events to the returned
 * der_ store is separately gated at the events proxy, where authorize() delegates
 * to the parent (write => non-read-only member ∩ key scope).
 */
export function handleDerivedStore(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  parentStoreId: string,
  artifactKind: string,
): void {
  const principal = resolveKeyPrincipal(ctx.db, req);
  if (!principal) {
    sendError(res, 401, 'missing or invalid API key');
    return;
  }
  if (!isValidStoreId(parentStoreId)) {
    sendError(res, 400, 'invalid store id');
    return;
  }
  if (!isArtifactKind(artifactKind)) {
    sendError(res, 400, 'unknown artifact kind');
    return;
  }
  const decision = authorize(ctx.db, principal, { kind: 'store', storeId: parentStoreId }, 'read');
  if (!decision.ok) {
    sendError(res, decision.status, decision.error ?? 'forbidden');
    return;
  }
  const { storeId } = getOrCreateDerivedStore(ctx.db, parentStoreId, artifactKind);
  if (principal.tokenId) touchToken(ctx.db, principal.tokenId);
  sendJson(res, 200, { storeId, eventsUrl: `/v1/projects/${storeId}/events` });
}
