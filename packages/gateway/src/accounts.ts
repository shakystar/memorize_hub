import type Database from 'better-sqlite3';

import { newId } from './ids.js';

/** Account DAL (Hub SoT H040 `accounts`). Ported verified core, renamed usr_ -> acc_. */

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Get-or-create an account from a Google identity; returns the account id.
 * Resolves by provider_sub (the immutable OIDC `sub`) first, then by email
 * (attaching the sub to a pre-existing email-keyed row), else inserts. email is
 * the cross-channel anchor + display handle; provider_sub is the stable OAuth key.
 */
export function upsertAccountByGoogle(db: Database.Database, sub: string, email: string): string {
  const bySub = db.prepare('SELECT id FROM accounts WHERE provider_sub = ?').get(sub) as
    | { id: string }
    | undefined;
  if (bySub) return bySub.id;

  const byEmail = db.prepare('SELECT id, provider_sub FROM accounts WHERE email = ?').get(email) as
    | { id: string; provider_sub: string | null }
    | undefined;
  if (byEmail) {
    if (!byEmail.provider_sub) {
      db.prepare('UPDATE accounts SET provider_sub = ? WHERE id = ?').run(sub, byEmail.id);
    }
    return byEmail.id;
  }

  const id = newId('acc');
  db.prepare('INSERT INTO accounts (id, email, provider_sub, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    email,
    sub,
    nowIso(),
  );
  return id;
}

/** Get-or-create an account by email; returns the account id. */
export function upsertAccountByEmail(db: Database.Database, email: string): string {
  const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;
  const id = newId('acc');
  db.prepare('INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)').run(id, email, nowIso());
  return id;
}

export interface AccountRow {
  id: string;
  email: string;
  provider_sub: string | null;
  created_at: string;
}

export function getAccount(db: Database.Database, accountId: string): AccountRow | undefined {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow | undefined;
}
