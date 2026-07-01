import type Database from 'better-sqlite3';

import { newId } from './ids.js';

/**
 * Store + membership DAL (Hub SoT H040 `stores` + `memberships`). A store is a
 * `wsp_` event-log id; a private project is the degenerate 1-member,
 * non-invite-reachable case (H020/H040). Two roles only: owner/member.
 *
 * The last-owner invariant (H040) lives in removeMember/setRole and returns a
 * conflict the handler maps to 409.
 */

function nowIso(): string {
  return new Date().toISOString();
}

export type Role = 'owner' | 'member';

export interface StoreRow {
  storeId: string;
  inviteReachable: boolean;
  name: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AccountStore {
  storeId: string;
  role: Role;
  name: string | null;
  inviteReachable: boolean;
  memberCount: number;
}

export interface Member {
  accountId: string;
  role: Role;
  githubLogin: string | null;
  joinedAt: string;
}

/** Mint a `wsp_` store, invite_reachable=false, caller as sole owner (H040). */
export function createStore(
  db: Database.Database,
  ownerAccountId: string,
  name?: string,
): { storeId: string } {
  const storeId = newId('wsp');
  const now = nowIso();
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO stores (store_id, invite_reachable, name, created_by, created_at)
       VALUES (?, 0, ?, ?, ?)`,
    ).run(storeId, name ?? null, ownerAccountId, now);
    db.prepare(
      'INSERT INTO memberships (store_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)',
    ).run(storeId, ownerAccountId, 'owner', now);
  });
  write();
  return { storeId };
}

export function getStore(db: Database.Database, storeId: string): StoreRow | null {
  const row = db
    .prepare('SELECT store_id, invite_reachable, name, created_by, created_at FROM stores WHERE store_id = ?')
    .get(storeId) as
    | { store_id: string; invite_reachable: number; name: string | null; created_by: string; created_at: string }
    | undefined;
  if (!row) return null;
  return {
    storeId: row.store_id,
    inviteReachable: row.invite_reachable === 1,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** Stores the account belongs to (private + shared), with role + memberCount. */
export function listAccountStores(db: Database.Database, accountId: string): AccountStore[] {
  const rows = db
    .prepare(
      `SELECT s.store_id, s.name, s.invite_reachable, m.role,
              (SELECT COUNT(*) FROM memberships mm WHERE mm.store_id = s.store_id) AS member_count
         FROM memberships m JOIN stores s ON s.store_id = m.store_id
        WHERE m.account_id = ? ORDER BY s.created_at DESC`,
    )
    .all(accountId) as Array<{
    store_id: string;
    name: string | null;
    invite_reachable: number;
    role: Role;
    member_count: number;
  }>;
  return rows.map((r) => ({
    storeId: r.store_id,
    role: r.role,
    name: r.name,
    inviteReachable: r.invite_reachable === 1,
    memberCount: r.member_count,
  }));
}

/** Full membership roster of a store (join order). */
export function roster(db: Database.Database, storeId: string): Member[] {
  const rows = db
    .prepare(
      `SELECT m.account_id, m.role, m.joined_at, a.github_login
         FROM memberships m JOIN accounts a ON a.id = m.account_id
        WHERE m.store_id = ? ORDER BY m.joined_at ASC`,
    )
    .all(storeId) as Array<{ account_id: string; role: Role; joined_at: string; github_login: string | null }>;
  return rows.map((r) => ({
    accountId: r.account_id,
    role: r.role,
    githubLogin: r.github_login,
    joinedAt: r.joined_at,
  }));
}

/** The account's role in a store, or null if not a member. */
export function memberRole(
  db: Database.Database,
  storeId: string,
  accountId: string,
): Role | null {
  const row = db
    .prepare('SELECT role FROM memberships WHERE store_id = ? AND account_id = ?')
    .get(storeId, accountId) as { role: Role } | undefined;
  return row ? row.role : null;
}

export function memberCount(db: Database.Database, storeId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE store_id = ?').get(storeId) as { n: number }
  ).n;
}

export function ownerCount(db: Database.Database, storeId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM memberships WHERE store_id = ? AND role = 'owner'")
      .get(storeId) as { n: number }
  ).n;
}

/** Add (idempotent) a member at a role. Used by join; keeps an existing role. */
export function addMember(
  db: Database.Database,
  storeId: string,
  accountId: string,
  role: Role,
): void {
  db.prepare(
    `INSERT INTO memberships (store_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(store_id, account_id) DO NOTHING`,
  ).run(storeId, accountId, role, nowIso());
}

/**
 * Remove a member. Enforces the last-owner invariant: removing the sole remaining
 * owner while other members exist is refused (handler -> 409). A sole owner who is
 * also the only member may leave (equivalent to deleting an empty store).
 */
export function removeMember(
  db: Database.Database,
  storeId: string,
  accountId: string,
): { ok: true } | { ok: false; reason: 'last_owner' | 'not_a_member' } {
  const role = memberRole(db, storeId, accountId);
  if (!role) return { ok: false, reason: 'not_a_member' };
  if (role === 'owner' && ownerCount(db, storeId) === 1 && memberCount(db, storeId) > 1) {
    return { ok: false, reason: 'last_owner' };
  }
  db.prepare('DELETE FROM memberships WHERE store_id = ? AND account_id = ?').run(storeId, accountId);
  return { ok: true };
}

/**
 * Change a member's role. Enforces the last-owner invariant: demoting the sole
 * remaining owner is refused (handler -> 409). Promotion is always allowed.
 */
export function setRole(
  db: Database.Database,
  storeId: string,
  accountId: string,
  role: Role,
): { ok: true } | { ok: false; reason: 'last_owner' | 'not_a_member' } {
  const current = memberRole(db, storeId, accountId);
  if (!current) return { ok: false, reason: 'not_a_member' };
  if (current === 'owner' && role === 'member' && ownerCount(db, storeId) === 1) {
    return { ok: false, reason: 'last_owner' };
  }
  db.prepare('UPDATE memberships SET role = ? WHERE store_id = ? AND account_id = ?').run(
    role,
    storeId,
    accountId,
  );
  return { ok: true };
}

/** Flip invite_reachable=true (private -> shared) on first invite mint (H020/H040). */
export function markInviteReachable(db: Database.Database, storeId: string): void {
  db.prepare('UPDATE stores SET invite_reachable = 1 WHERE store_id = ?').run(storeId);
}

/** Set (or clear, with null) a store's display name. Metadata only, never identity. */
export function renameStore(db: Database.Database, storeId: string, name: string | null): void {
  db.prepare('UPDATE stores SET name = ? WHERE store_id = ?').run(name, storeId);
}

/** Delete a store's control-plane rows (memberships + invites + store). Owner teardown. */
export function deleteStore(db: Database.Database, storeId: string): void {
  const write = db.transaction(() => {
    db.prepare('DELETE FROM invites WHERE store_id = ?').run(storeId);
    db.prepare('DELETE FROM memberships WHERE store_id = ?').run(storeId);
    db.prepare('DELETE FROM stores WHERE store_id = ?').run(storeId);
  });
  write();
}
