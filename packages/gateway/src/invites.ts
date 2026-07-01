import type Database from 'better-sqlite3';

import { generateInviteToken, hashSecret, newId } from './ids.js';
import { addMember, memberRole, type Role } from './stores.js';

/**
 * Invite DAL (Hub SoT H040 `invites`). A revocable, multi-use, optionally-expiring
 * join capability that always grants `member` in v1 (Fork 2). The token plaintext
 * is shown ONCE at mint and never re-served; only its hash is stored.
 */

function nowIso(): string {
  return new Date().toISOString();
}

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

/** Mint an invite for a store; the mint also flips the store to invite_reachable. */
export function mintInvite(
  db: Database.Database,
  storeId: string,
  createdBy: string,
  opts: MintInviteOptions,
): MintedInvite {
  const { plaintext, hash } = generateInviteToken();
  const inviteId = newId('inv');
  const maxUses = opts.maxUses ?? null;
  const expiresAt = opts.expiresAt ?? null;
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO invites
         (invite_id, store_id, token_hash, role, max_uses, used_count, expires_at, revoked_at, created_by, created_at)
       VALUES (?, ?, ?, 'member', ?, 0, ?, NULL, ?, ?)`,
    ).run(inviteId, storeId, hash, maxUses, expiresAt, createdBy, nowIso());
    // First successful mint makes the store shared (private -> shared, H020/H040).
    db.prepare('UPDATE stores SET invite_reachable = 1 WHERE store_id = ?').run(storeId);
  });
  write();
  return { inviteId, token: plaintext, role: 'member', maxUses, expiresAt };
}

/** List a store's invites (token never echoed — shown once at mint). */
export function listInvites(db: Database.Database, storeId: string): InviteRow[] {
  const rows = db
    .prepare(
      `SELECT invite_id, max_uses, used_count, expires_at, revoked_at, created_at
         FROM invites WHERE store_id = ? ORDER BY created_at DESC`,
    )
    .all(storeId) as Array<{
    invite_id: string;
    max_uses: number | null;
    used_count: number;
    expires_at: string | null;
    revoked_at: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    inviteId: r.invite_id,
    maxUses: r.max_uses,
    usedCount: r.used_count,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
  }));
}

/**
 * Revoke an invite (idempotent). Returns false if the invite is unknown for this
 * store (handler -> 404); true if it existed (already-revoked still returns true,
 * so the handler answers 204 either way).
 */
export function revokeInvite(db: Database.Database, storeId: string, inviteId: string): boolean {
  const exists = db
    .prepare('SELECT 1 FROM invites WHERE invite_id = ? AND store_id = ?')
    .get(inviteId, storeId);
  if (!exists) return false;
  db.prepare(
    'UPDATE invites SET revoked_at = ? WHERE invite_id = ? AND revoked_at IS NULL',
  ).run(nowIso(), inviteId);
  return true;
}

/**
 * Redeem an invite token for an account: validate (not revoked/expired/exhausted),
 * add membership, increment used_count. Already-a-member is idempotent and does not
 * consume a use. Unknown/dead token -> `{ ok: false }`.
 */
export function redeemInvite(
  db: Database.Database,
  token: string,
  accountId: string,
): RedeemResult {
  const row = db
    .prepare(
      `SELECT invite_id, store_id, max_uses, used_count, expires_at, revoked_at
         FROM invites WHERE token_hash = ?`,
    )
    .get(hashSecret(token)) as
    | {
        invite_id: string;
        store_id: string;
        max_uses: number | null;
        used_count: number;
        expires_at: string | null;
        revoked_at: string | null;
      }
    | undefined;
  if (!row || row.revoked_at) return { ok: false };
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return { ok: false };
  if (row.max_uses !== null && row.used_count >= row.max_uses) return { ok: false };

  const existing = memberRole(db, row.store_id, accountId);
  if (existing) return { ok: true, storeId: row.store_id, role: existing, alreadyMember: true };

  const write = db.transaction(() => {
    addMember(db, row.store_id, accountId, 'member');
    db.prepare('UPDATE invites SET used_count = used_count + 1 WHERE invite_id = ?').run(row.invite_id);
  });
  write();
  return { ok: true, storeId: row.store_id, role: 'member', alreadyMember: false };
}
