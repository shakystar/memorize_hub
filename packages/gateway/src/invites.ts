import type Database from 'better-sqlite3';

import { todo } from './http.js';
import type { Role } from './stores.js';

/**
 * Invite DAL (Hub SoT H040 `invites`). A revocable, multi-use, optionally-
 * expiring join capability that always grants `member` in v1 (Fork 2). The token
 * plaintext is shown ONCE at mint and never re-served; only its hash is stored.
 *
 * @remarks Skeleton — signatures documented; bodies not yet ported.
 */

export interface MintInviteOptions {
  /** null/omitted = unlimited uses; must be > 0 if set. */
  maxUses?: number | null;
  /** ISO-8601; omitted = never expires; must be in the future if set. */
  expiresAt?: string | null;
}

export interface MintedInvite {
  inviteId: string;
  /** One-time join capability plaintext (a locator, not a durable secret). */
  token: string;
  role: Role;
  maxUses: number | null;
  expiresAt: string | null;
}

export interface InviteRow {
  inviteId: string;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export type RedeemResult =
  | { ok: true; storeId: string; role: Role; alreadyMember: boolean }
  | { ok: false };

/** Mint an invite for a store; first mint flips the store to invite_reachable. */
export function mintInvite(
  _db: Database.Database,
  _storeId: string,
  _createdBy: string,
  _opts: MintInviteOptions,
): MintedInvite {
  return todo('invites.mintInvite');
}

/** List a store's invites (token never echoed — shown once at mint). */
export function listInvites(_db: Database.Database, _storeId: string): InviteRow[] {
  return todo('invites.listInvites');
}

/** Revoke an invite (idempotent). Returns false if the invite is unknown. */
export function revokeInvite(
  _db: Database.Database,
  _storeId: string,
  _inviteId: string,
): boolean {
  return todo('invites.revokeInvite');
}

/**
 * Redeem an invite token for an account: validate (not revoked/expired/exhausted),
 * add membership, increment used_count. Already-a-member is idempotent and does
 * not consume a use. Unknown/dead token -> `{ ok: false }`.
 */
export function redeemInvite(
  _db: Database.Database,
  _token: string,
  _accountId: string,
): RedeemResult {
  return todo('invites.redeemInvite');
}
