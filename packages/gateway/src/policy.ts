import type Database from 'better-sqlite3';

import { isDerivedStoreId, isPersonalStoreId, isWorkspaceStoreId } from './ids.js';
import { getDerivedStoreParent } from './derived-stores.js';
import { tokenCoversStore } from './keys.js';
import { getPersonalStoreOwner } from './personal-store.js';
import type { Principal } from './principal.js';
import { memberRole } from './stores.js';

/**
 * The single authorization gate (Hub SoT H030, docs/protocol/README.md §2-5).
 *
 * `authorize(principal, resource, action)` is the ONLY place that decides
 * "can this account do this?" — the inline `min(role, scope, readOnly)` that used
 * to live in the legacy proxy is replaced by this. It is deliberately COARSE: it
 * reads membership role, key scope, key read_only, and store-kind rules, and
 * NEVER parses event payloads (relay opacity, SoT-060 / H010). Fine rules
 * (e.g. owner-only global retract) are honored client-side at projection time.
 *
 * This is also the entitlements seam (H080): a future `plan = planOf(accountId)`
 * quota check slots in here as an additive narrowing, changing no endpoint shape.
 *
 * @remarks Skeleton — the decision matrix is documented but not yet ported.
 */

export type Action = 'read' | 'write' | 'admin';

export type Resource =
  /** An opaque relay store on the events route (data-plane). */
  | { kind: 'store'; storeId: string }
  /** A control-plane workspace object (membership/invite/lifecycle). */
  | { kind: 'workspace'; storeId: string };

export interface Decision {
  ok: boolean;
  /** HTTP status to send on denial (403/404/409 per README §4-5); 200 when ok. */
  status: number;
  error?: string;
}

/**
 * Decide access. Denials follow the existence-leak policy (README §5):
 * control-plane non-member/unknown -> 404; member-but-wrong-role -> 403;
 * data-plane store denial -> 403; invariant conflicts -> 409.
 */
export function authorize(
  db: Database.Database,
  principal: Principal,
  resource: Resource,
  action: Action,
): Decision {
  // read_only keys may read on both planes but never push or mutate (README §3).
  if ((action === 'write' || action === 'admin') && principal.readOnly) {
    return { ok: false, status: 403, error: 'this key is read-only' };
  }

  if (resource.kind === 'store') {
    const { storeId } = resource;

    // Derived sidecar store: no memberships of its own — resolve the parent and
    // inherit its ACL wholesale (personal owner-only OR workspace membership∩scope).
    // Recursion depth is 1: a parent is never itself a der_ store.
    if (isDerivedStoreId(storeId)) {
      const parent = getDerivedStoreParent(db, storeId);
      if (!parent) return { ok: false, status: 403, error: 'unknown store' };
      return authorize(db, principal, { kind: 'store', storeId: parent.parentStoreId }, action);
    }

    // Personal store: owner-only, unscoped — no workspace membership involved
    // (personal-store.md §authorization). This is the privacy hard boundary.
    if (isPersonalStoreId(storeId)) {
      const owner = getPersonalStoreOwner(db, storeId);
      if (owner === null || owner !== principal.accountId) {
        return { ok: false, status: 403, error: 'not your personal store' };
      }
      if (principal.scoped) {
        return { ok: false, status: 403, error: 'this key is not scoped for personal memory' };
      }
      return { ok: true, status: 200 };
    }

    // Workspace store (data-plane): membership ∩ key scope (workspace.md §data-plane).
    // A scoped key must additionally list this store; an unscoped key covers all
    // the account's stores. write vs read_only is already handled above.
    if (isWorkspaceStoreId(storeId)) {
      const role = memberRole(db, storeId, principal.accountId);
      if (!role) return { ok: false, status: 403, error: 'not a member of this store' };
      if (principal.scoped && principal.tokenId && !tokenCoversStore(db, principal.tokenId, storeId)) {
        return { ok: false, status: 403, error: 'this key is not scoped to this store' };
      }
      return { ok: true, status: 200 };
    }

    return { ok: false, status: 403, error: 'unknown store' };
  }

  // Control-plane workspace resource (membership / invite / lifecycle). Management
  // requires an unscoped key (scoped keys are data-plane only, README §3). Members
  // may read; only owners may `admin`. Existence-leak: non-member/unknown -> 404.
  if (principal.scoped) {
    return { ok: false, status: 403, error: 'management requires an unscoped key' };
  }
  const role = memberRole(db, resource.storeId, principal.accountId);
  if (!role) return { ok: false, status: 404, error: 'not found' };
  if (action === 'admin' && role !== 'owner') {
    return { ok: false, status: 403, error: 'owner only' };
  }
  return { ok: true, status: 200 };
}
