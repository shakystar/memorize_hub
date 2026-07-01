import type Database from 'better-sqlite3';

import { newId } from './ids.js';

/**
 * Personal-store DAL (Hub SoT H040 `personal_stores`). Ported verified core.
 * One opaque event log per account, owned by exactly one account and never
 * grantable to another (owner-only isolation — the privacy guarantee). The DB
 * holds only the account->store mapping; events live in the relay, opaque.
 */

function nowIso(): string {
  return new Date().toISOString();
}

export interface PersonalStore {
  /** The relay path id this account's personal memory syncs under (`psm_…`). */
  storeId: string;
  createdAt: string;
}

/** Get-or-create the account's single personal-memory store (idempotent). */
export function getOrCreatePersonalStore(db: Database.Database, accountId: string): PersonalStore {
  const existing = db
    .prepare('SELECT store_id, created_at FROM personal_stores WHERE account_id = ?')
    .get(accountId) as { store_id: string; created_at: string } | undefined;
  if (existing) return { storeId: existing.store_id, createdAt: existing.created_at };
  const storeId = newId('psm');
  const createdAt = nowIso();
  db.prepare(
    'INSERT INTO personal_stores (account_id, store_id, created_at) VALUES (?, ?, ?)',
  ).run(accountId, storeId, createdAt);
  return { storeId, createdAt };
}

/** Resolve a personal-store path id to its owning account id, or null if not one. */
export function getPersonalStoreOwner(db: Database.Database, storeId: string): string | null {
  const row = db
    .prepare('SELECT account_id FROM personal_stores WHERE store_id = ?')
    .get(storeId) as { account_id: string } | undefined;
  return row ? row.account_id : null;
}
