import type Database from 'better-sqlite3';

import { todo } from './http.js';

/**
 * Store + membership DAL (Hub SoT H040 `stores` + `memberships`). A store is a
 * `wsp_` event-log id; a private project is the degenerate 1-member,
 * non-invite-reachable case (H020/H040). Two roles only: owner/member.
 *
 * @remarks Skeleton — signatures + invariants documented; bodies not yet ported.
 * The last-owner invariant (H040) lives in removeMember/setRole and returns a
 * conflict the handler maps to 409.
 */

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
  _db: Database.Database,
  _ownerAccountId: string,
  _name?: string,
): { storeId: string } {
  return todo('stores.createStore');
}

export function getStore(_db: Database.Database, _storeId: string): StoreRow | null {
  return todo('stores.getStore');
}

/** Stores the account belongs to (private + shared), with role + memberCount. */
export function listAccountStores(_db: Database.Database, _accountId: string): AccountStore[] {
  return todo('stores.listAccountStores');
}

/** Full membership roster of a store. */
export function roster(_db: Database.Database, _storeId: string): Member[] {
  return todo('stores.roster');
}

/** The account's role in a store, or null if not a member. */
export function memberRole(
  _db: Database.Database,
  _storeId: string,
  _accountId: string,
): Role | null {
  return todo('stores.memberRole');
}

export function memberCount(_db: Database.Database, _storeId: string): number {
  return todo('stores.memberCount');
}

export function ownerCount(_db: Database.Database, _storeId: string): number {
  return todo('stores.ownerCount');
}

/** Add (idempotent) a member at a role. Used by join and role changes. */
export function addMember(
  _db: Database.Database,
  _storeId: string,
  _accountId: string,
  _role: Role,
): void {
  return todo('stores.addMember');
}

/**
 * Remove a member. Enforces the last-owner invariant: removing the sole remaining
 * owner while other members exist is refused (handler -> 409). A sole owner who is
 * also the only member may leave (equivalent to deleting an empty store).
 */
export function removeMember(
  _db: Database.Database,
  _storeId: string,
  _accountId: string,
): { ok: true } | { ok: false; reason: 'last_owner' | 'not_a_member' } {
  return todo('stores.removeMember');
}

/**
 * Change a member's role. Enforces the last-owner invariant: demoting the sole
 * remaining owner is refused (handler -> 409). Promotion is always allowed.
 */
export function setRole(
  _db: Database.Database,
  _storeId: string,
  _accountId: string,
  _role: Role,
): { ok: true } | { ok: false; reason: 'last_owner' | 'not_a_member' } {
  return todo('stores.setRole');
}

/** Flip invite_reachable=true (private -> shared) on first invite mint (H020/H040). */
export function markInviteReachable(_db: Database.Database, _storeId: string): void {
  return todo('stores.markInviteReachable');
}

/** Delete a store's control-plane rows (memberships + invites). Owner teardown. */
export function deleteStore(_db: Database.Database, _storeId: string): void {
  return todo('stores.deleteStore');
}
