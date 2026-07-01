import type { IncomingMessage } from 'node:http';

import type Database from 'better-sqlite3';

import type { GatewayContext } from './context.js';
import { bearerToken } from './http.js';
import { identifyToken, tokenIsUnscoped } from './keys.js';
import { readAccount } from './session.js';

/**
 * Principal — the single "who is acting" concept (Hub SoT H030,
 * docs/protocol/README.md §2). Resolved from an API key (`via:'key'`) or, later,
 * a browser OAuth session (`via:'session'`). `authorize()` consumes it; no
 * endpoint re-derives auth by hand.
 */
export interface Principal {
  accountId: string;
  via: 'key' | 'session';
  /** read-only keys may read on both planes but never push/mutate (README §3). */
  readOnly: boolean;
  /** scoped keys are data-plane only; management + personal require unscoped. */
  scoped: boolean;
  /** Present for `via:'key'`; used for scope checks and last-used stamping. */
  tokenId?: string;
}

/** Resolve an `Authorization: Bearer <api-key>` into a key principal, or null. */
export function resolveKeyPrincipal(db: Database.Database, req: IncomingMessage): Principal | null {
  const key = bearerToken(req);
  if (!key) return null;
  const identity = identifyToken(db, key);
  if (!identity) return null;
  return {
    accountId: identity.accountId,
    via: 'key',
    readOnly: identity.readOnly,
    scoped: !tokenIsUnscoped(db, identity.tokenId),
    tokenId: identity.tokenId,
  };
}

/**
 * Resolve a browser OAuth session cookie into a session principal, or null. A
 * session is always full-power (readOnly:false, scoped:false) — narrowing is a
 * key-only concept; the human owns the account.
 */
export function resolveSessionPrincipal(ctx: GatewayContext, req: IncomingMessage): Principal | null {
  if (!ctx.config.sessionSecret) return null;
  const session = readAccount(req.headers.cookie, ctx.config.sessionSecret);
  if (!session) return null;
  return { accountId: session.accountId, via: 'session', readOnly: false, scoped: false };
}

/**
 * Resolve the caller to a principal from either audience (README §6): an API key
 * (CLI/agent) takes precedence, else the browser OAuth session. Null if neither.
 */
export function resolvePrincipal(ctx: GatewayContext, req: IncomingMessage): Principal | null {
  return resolveKeyPrincipal(ctx.db, req) ?? resolveSessionPrincipal(ctx, req);
}
