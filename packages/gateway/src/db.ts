import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

/**
 * Control-plane schema for the Hub gateway. This DB holds ONLY identity and
 * access control — users, project-scoped API tokens, ACL, and beta access
 * requests. It NEVER stores event data: opaque per-project events live solely
 * in the relay's ndjson store. Keeping the two planes apart is what lets the
 * relay stay a dumb, vendor-neutral transport (see AGENTS.md "Decisions").
 *
 * Migrations are applied via `PRAGMA user_version` (mirrors memorize's
 * src/storage/db.ts). Append future migrations to this array — never reorder
 * or mutate existing entries.
 */
const MIGRATIONS: ReadonlyArray<(db: Database.Database) => void> = [
  // v1 — users + project-scoped API tokens + ACL + beta access requests.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id         TEXT PRIMARY KEY,
        email      TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_tokens (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id),
        token_hash   TEXT NOT NULL UNIQUE,
        prefix       TEXT NOT NULL,
        label        TEXT,
        created_at   TEXT NOT NULL,
        revoked_at   TEXT,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tokens_hash ON api_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_tokens_user ON api_tokens(user_id);

      CREATE TABLE IF NOT EXISTS project_acl (
        project_id TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users(id),
        role       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_acl_user ON project_acl(user_id);

      CREATE TABLE IF NOT EXISTS access_requests (
        id                   TEXT PRIMARY KEY,
        email                TEXT NOT NULL,
        requested_project_id TEXT NOT NULL,
        note                 TEXT,
        status               TEXT NOT NULL,
        created_at           TEXT NOT NULL,
        decided_at           TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_requests_status ON access_requests(status);
    `);
  },
  // v2 — link a user row to its GitHub identity (participant self-service login).
  // email stays the cross-channel anchor; github_login is the stable handle for
  // OAuth users and is unique when present (anonymous /beta users leave it null).
  (db) => {
    db.exec(`
      ALTER TABLE users ADD COLUMN github_login TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github
        ON users(github_login) WHERE github_login IS NOT NULL;
    `);
  },
];

function runMigrations(db: Database.Database): void {
  // Acquire the write lock up front (BEGIN IMMEDIATE) and re-read user_version
  // inside it, so two processes opening a fresh DB at once can't both run the
  // same CREATEs. Mirrors memorize's src/storage/db.ts rationale.
  const runAll = db.transaction(() => {
    const current = db.pragma('user_version', { simple: true }) as number;
    for (let version = current; version < MIGRATIONS.length; version++) {
      const migrate = MIGRATIONS[version]!;
      migrate(db);
      db.pragma(`user_version = ${version + 1}`);
    }
  });
  runAll.immediate();
}

/**
 * `PRAGMA journal_mode = WAL` takes a brief exclusive lock and does NOT honor
 * busy_timeout, so retry with a short backoff on a fresh-DB collision.
 */
function enableWalWithRetry(db: Database.Database): void {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      db.pragma('journal_mode = WAL');
      return;
    } catch (error) {
      const busy =
        error instanceof Error && /database is locked|SQLITE_BUSY/.test(error.message);
      if (!busy || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

/**
 * Open (creating if needed) the gateway control-plane DB at `dbFile`, applying
 * pragmas + migrations. Uncached: the gateway opens one handle at boot. ':memory:'
 * is supported for tests.
 */
export function openGatewayDb(dbFile: string): Database.Database {
  if (dbFile !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbFile)), { recursive: true });
  }
  const db = new Database(dbFile);
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  enableWalWithRetry(db);
  runMigrations(db);
  return db;
}
