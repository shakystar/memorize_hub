import type Database from 'better-sqlite3';

import { todo } from './http.js';
import type { Principal } from './principal.js';

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
  _db: Database.Database,
  _principal: Principal,
  _resource: Resource,
  _action: Action,
): Decision {
  return todo('policy.authorize');
}
