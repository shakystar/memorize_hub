import type Database from 'better-sqlite3';

import { generateApiKey, hashSecret, newId } from './ids.js';

/**
 * API key DAL (Hub SoT H040 `api_tokens` + `token_scopes`). Ported verified core.
 * A key resolves to exactly one account (SoT-020). `read_only` and scope only
 * ever narrow access (docs/protocol/README.md §3).
 */

function nowIso(): string {
  return new Date().toISOString();
}

export interface TokenIdentity {
  tokenId: string;
  accountId: string;
  /** A read-only key may pull but never push/mutate, on either plane. */
  readOnly: boolean;
}

/** Resolve an API key plaintext to its (non-revoked) owner, or null. */
export function identifyToken(db: Database.Database, plaintext: string): TokenIdentity | null {
  const row = db
    .prepare('SELECT id, account_id, revoked_at, read_only FROM api_tokens WHERE token_hash = ?')
    .get(hashSecret(plaintext)) as
    | { id: string; account_id: string; revoked_at: string | null; read_only: number }
    | undefined;
  if (!row || row.revoked_at) return null;
  return { tokenId: row.id, accountId: row.account_id, readOnly: row.read_only === 1 };
}

/** Best-effort last-used stamp (observability only). */
export function touchToken(db: Database.Database, tokenId: string): void {
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), tokenId);
}

/**
 * Is this key unscoped? Only an unscoped key (no scope rows) reaches personal
 * memory and control-plane management; a scoped key is data-plane only (README §3).
 */
export function tokenIsUnscoped(db: Database.Database, tokenId: string): boolean {
  const scoped = db.prepare('SELECT 1 FROM token_scopes WHERE token_id = ? LIMIT 1').get(tokenId);
  return scoped === undefined;
}

/**
 * Does this key cover the store? An unscoped key covers all the account's stores;
 * a scoped key covers only its listed store ids. This only narrows — membership
 * is still the ceiling, checked separately in authorize().
 */
export function tokenCoversStore(db: Database.Database, tokenId: string, storeId: string): boolean {
  if (tokenIsUnscoped(db, tokenId)) return true;
  const row = db
    .prepare('SELECT 1 FROM token_scopes WHERE token_id = ? AND store_id = ?')
    .get(tokenId, storeId);
  return row !== undefined;
}

export interface IssueKeyOptions {
  /** A read-only key may pull but never push/mutate. */
  readOnly?: boolean;
  /** Limit the key to these store ids; omitted/empty = all the account's stores. */
  storeIds?: string[];
}

/**
 * Mint and persist an API key; returns the one-time plaintext. `opts` may narrow
 * the key to a store subset and/or mark it read-only (both only restrict). Scope
 * insert + token insert run in one transaction.
 */
export function issueApiKey(
  db: Database.Database,
  accountId: string,
  label?: string,
  opts: IssueKeyOptions = {},
): { plaintext: string; tokenId: string; prefix: string } {
  const key = generateApiKey();
  const id = newId('tok');
  const scopes = [...new Set(opts.storeIds ?? [])];
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO api_tokens (id, account_id, token_hash, prefix, label, read_only, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, accountId, key.hash, key.prefix, label ?? null, opts.readOnly ? 1 : 0, nowIso());
    const insScope = db.prepare(
      'INSERT OR IGNORE INTO token_scopes (token_id, store_id) VALUES (?, ?)',
    );
    for (const storeId of scopes) insScope.run(id, storeId);
  });
  write();
  return { plaintext: key.plaintext, tokenId: id, prefix: key.prefix };
}

/** A key's store scopes; empty array means it covers all the account's stores. */
export function listTokenScopes(db: Database.Database, tokenId: string): string[] {
  return (
    db
      .prepare('SELECT store_id FROM token_scopes WHERE token_id = ? ORDER BY store_id')
      .all(tokenId) as { store_id: string }[]
  ).map((r) => r.store_id);
}

/** Revoke a token by id; returns true if a live token was revoked. */
export function revokeToken(db: Database.Database, tokenId: string): boolean {
  const result = db
    .prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(nowIso(), tokenId);
  return result.changes > 0;
}
