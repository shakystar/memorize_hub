import type { IncomingMessage, ServerResponse } from 'node:http';

import { getAccount } from './accounts.js';
import type { GatewayContext } from './context.js';
import { readBody, sendError, sendJson } from './http.js';
import { issueApiKey, listAccountTokens, revokeToken, tokenBelongsToAccount } from './keys.js';
import type { Principal } from './principal.js';
import { resolvePrincipal } from './principal.js';
import { listAccountStores } from './stores.js';

/**
 * Session-JSON account management for the SPA (personal settings). The browser
 * app drives these with its session cookie; a CLI could use an unscoped key too.
 * Account management always requires an UNSCOPED key (scoped keys are data-plane
 * only, README §3); mutations additionally require non-read_only.
 */

const MAX_JSON = 16 * 1024;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const buf = await readBody(req, MAX_JSON);
  if (buf.length === 0) return {};
  const value = JSON.parse(buf.toString('utf8')) as unknown;
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function accountPrincipal(
  ctx: GatewayContext,
  req: IncomingMessage,
  res: ServerResponse,
  mutate: boolean,
): Principal | null {
  const p = resolvePrincipal(ctx, req);
  if (!p) {
    sendError(res, 401, 'authentication required');
    return null;
  }
  if (p.scoped) {
    sendError(res, 403, 'account management requires an unscoped key');
    return null;
  }
  if (mutate && p.readOnly) {
    sendError(res, 403, 'this key is read-only');
    return null;
  }
  return p;
}

/**
 * GET /v1/account identity echo (whoami). Unlike the management routes below
 * this admits EVERY principal, scoped and read-only included: it discloses only
 * the identity the caller already authenticates as, and data-plane callers need
 * it. The H060 replica authors events with the calling USER's account as the
 * provenance `writer`, and the user may only hold a scoped key.
 */
export function handleAccountWhoami(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
): void {
  const p = resolvePrincipal(ctx, req);
  if (!p) return sendError(res, 401, 'authentication required');
  const account = getAccount(ctx.db, p.accountId);
  // A key whose account row vanished is a dead credential, not a caller.
  if (!account) return sendError(res, 401, 'authentication required');
  sendJson(res, 200, {
    accountId: p.accountId,
    email: account.email,
    via: p.via,
    readOnly: p.readOnly,
    scoped: p.scoped,
  });
}

/** GET /v1/account/keys — the account's keys (active + revoked; UI hides revoked). */
export function handleAccountKeysList(req: IncomingMessage, res: ServerResponse, ctx: GatewayContext): void {
  const p = accountPrincipal(ctx, req, res, false);
  if (!p) return;
  sendJson(res, 200, { keys: listAccountTokens(ctx.db, p.accountId) });
}

/** POST /v1/account/keys — mint a key. Body: { label?, readOnly?, storeIds? }. */
export async function handleAccountKeyIssue(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
): Promise<void> {
  const p = accountPrincipal(ctx, req, res, true);
  if (!p) return;
  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch {
    return sendError(res, 400, 'invalid JSON');
  }
  const readOnly = body.readOnly === true;
  const label = typeof body.label === 'string' && body.label.length > 0 ? body.label : undefined;
  const owned = new Set(listAccountStores(ctx.db, p.accountId).map((s) => s.storeId));
  const storeIds = Array.isArray(body.storeIds)
    ? body.storeIds.filter((s): s is string => typeof s === 'string' && owned.has(s))
    : [];
  const opts = storeIds.length > 0 ? { readOnly, storeIds } : { readOnly };
  const { plaintext } = issueApiKey(ctx.db, p.accountId, label, opts);
  sendJson(res, 201, { key: plaintext });
}

/** DELETE /v1/account/keys/:id — revoke one of the account's keys (idempotent). */
export function handleAccountKeyRevoke(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  tokenId: string,
): void {
  const p = accountPrincipal(ctx, req, res, true);
  if (!p) return;
  if (!tokenBelongsToAccount(ctx.db, tokenId, p.accountId)) return sendError(res, 404, 'not found');
  revokeToken(ctx.db, tokenId);
  res.writeHead(204);
  res.end();
}
