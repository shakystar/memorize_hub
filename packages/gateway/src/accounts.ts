import type Database from 'better-sqlite3';

import { newId } from './ids.js';

/** Account DAL (Hub SoT H040 `accounts`). Ported verified core, renamed usr_ -> acc_. */

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Get-or-create an account from a GitHub identity; returns the account id.
 * Resolves by github_login first, then by email (attaching the login to a
 * pre-existing email-keyed row), else inserts. email is the cross-channel anchor;
 * github_login is the stable OAuth handle.
 */
export function upsertAccountByGithub(db: Database.Database, login: string, email: string): string {
  const byLogin = db.prepare('SELECT id FROM accounts WHERE github_login = ?').get(login) as
    | { id: string }
    | undefined;
  if (byLogin) return byLogin.id;

  const byEmail = db.prepare('SELECT id, github_login FROM accounts WHERE email = ?').get(email) as
    | { id: string; github_login: string | null }
    | undefined;
  if (byEmail) {
    if (!byEmail.github_login) {
      db.prepare('UPDATE accounts SET github_login = ? WHERE id = ?').run(login, byEmail.id);
    }
    return byEmail.id;
  }

  const id = newId('acc');
  db.prepare('INSERT INTO accounts (id, email, github_login, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    email,
    login,
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
  github_login: string | null;
  created_at: string;
}

export function getAccount(db: Database.Database, accountId: string): AccountRow | undefined {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow | undefined;
}
