import type { IncomingMessage } from 'node:http';

import type Database from 'better-sqlite3';

import { bearerToken } from './http.js';
import { identifyToken, tokenIsUnscoped } from './keys.js';

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

// Session-principal resolution (browser OAuth cookie) is ported with the
// session/oauth modules — see web.ts. It yields `via:'session'`, readOnly:false,
// scoped:false.
