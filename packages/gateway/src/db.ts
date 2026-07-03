import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

/**
 * Control-plane schema for the Hub gateway (Hub SoT H040). This DB holds ONLY
 * identity and access control — accounts, API keys, stores, memberships, invites,
 * personal stores. It NEVER stores event data: opaque per-store events live
 * solely in the relay's ndjson store. Keeping the two planes apart is what lets
 * the relay stay a dumb, vendor-neutral transport (Hub SoT H010).
 *
 * Data model is workspace-centric and unified (H040): a private project is the
 * degenerate 1-member, non-invite-reachable `wsp_` store; a shared workspace is
 * the same store grown to N members. There is NO `project_acl` and NO
 * `access_requests` — the beta gate is retired and membership is the sole access
 * model (H080). `personal_stores` stays physically separate to structurally
 * forbid cross-account access (H040 / memorize SoT-010).
 *
 * Migrations are applied via `PRAGMA user_version` (mirrors memorize's
 * src/storage/db.ts). Append future migrations — never reorder or mutate existing
 * entries. There is no production data to migrate, so v1 is a single fresh schema.
 */
const MIGRATIONS: ReadonlyArray<(db: Database.Database) => void> = [
  // v1 — accounts + API keys (+ scopes) + stores + memberships + invites +
  // personal stores. Server-minted ids throughout (H050).
  (db) => {
    db.exec(`
      -- OAuth-rooted account. github_login is the stable handle; email is the
      -- cross-channel anchor. A future 'plan' column (free/team/pro) is the
      -- entitlements seam (H080) — NOT added now; plan is implicitly unlimited.
      -- (v3 renames github_login -> provider_sub for the Google-OIDC migration;
      -- this v1 shape is immutable — it already ran on the live volume.)
      CREATE TABLE IF NOT EXISTS accounts (
        id           TEXT PRIMARY KEY,          -- acc_…
        email        TEXT NOT NULL UNIQUE,
        github_login TEXT,
        created_at   TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_github
        ON accounts(github_login) WHERE github_login IS NOT NULL;

      -- Account API key. read_only is the read/write axis; token_scopes is the
      -- which-stores axis. Both only ever narrow access (docs/protocol README §3).
      CREATE TABLE IF NOT EXISTS api_tokens (
        id           TEXT PRIMARY KEY,          -- tok_…
        account_id   TEXT NOT NULL REFERENCES accounts(id),
        token_hash   TEXT NOT NULL UNIQUE,
        prefix       TEXT NOT NULL,
        label        TEXT,
        read_only    INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        revoked_at   TEXT,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tokens_hash ON api_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_tokens_account ON api_tokens(account_id);

      -- A key narrowed to a set of store ids (empty rows = unscoped = all the
      -- account's stores). Scoped keys are data-plane only (README §3).
      CREATE TABLE IF NOT EXISTS token_scopes (
        token_id TEXT NOT NULL REFERENCES api_tokens(id),
        store_id TEXT NOT NULL,
        PRIMARY KEY (token_id, store_id)
      );
      CREATE INDEX IF NOT EXISTS idx_scopes_token ON token_scopes(token_id);

      -- A project/workspace store. invite_reachable=false => private project
      -- (degenerate 1-member workspace); flips true on first invite (H040/H020).
      CREATE TABLE IF NOT EXISTS stores (
        store_id         TEXT PRIMARY KEY,       -- wsp_…
        invite_reachable INTEGER NOT NULL DEFAULT 0,
        name             TEXT,
        created_by       TEXT NOT NULL REFERENCES accounts(id),
        created_at       TEXT NOT NULL
      );

      -- Replaces project_acl. Two roles only (owner/member, SoT-040). read_only
      -- is a KEY attribute, not a role.
      CREATE TABLE IF NOT EXISTS memberships (
        store_id   TEXT NOT NULL REFERENCES stores(store_id),
        account_id TEXT NOT NULL REFERENCES accounts(id),
        role       TEXT NOT NULL,                -- 'owner' | 'member'
        joined_at  TEXT NOT NULL,
        PRIMARY KEY (store_id, account_id)
      );
      CREATE INDEX IF NOT EXISTS idx_memberships_account ON memberships(account_id);

      -- Revocable, multi-use, optionally-expiring join capability. Always grants
      -- 'member' in v1 (Fork 2); role column reserved for future promotion links.
      CREATE TABLE IF NOT EXISTS invites (
        invite_id   TEXT PRIMARY KEY,            -- inv_…
        store_id    TEXT NOT NULL REFERENCES stores(store_id),
        token_hash  TEXT NOT NULL UNIQUE,
        role        TEXT NOT NULL DEFAULT 'member',
        max_uses    INTEGER,                     -- NULL = unlimited
        used_count  INTEGER NOT NULL DEFAULT 0,
        expires_at  TEXT,                        -- NULL = never
        revoked_at  TEXT,
        created_by  TEXT NOT NULL REFERENCES accounts(id),
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_invites_store ON invites(store_id);

      -- Per-account personal memory store (psm_). Owner-only, never grantable,
      -- kept physically separate from stores/memberships (H040 / SoT-010).
      CREATE TABLE IF NOT EXISTS personal_stores (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id),
        store_id   TEXT NOT NULL UNIQUE,         -- psm_…
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_personal_store_id ON personal_stores(store_id);
    `);
  },
  // v2 — usage metering for cost visibility (Fly storage + egress). The data-plane
  // proxy accumulates one row per store per UTC day: request count + bytes in/out.
  // Aggregate SIZES ONLY — never event content — so relay opacity (H010) holds.
  // This is metering, not access control; it gates nothing.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_daily (
        day        TEXT NOT NULL,             -- UTC 'YYYY-MM-DD'
        store_id   TEXT NOT NULL,
        requests   INTEGER NOT NULL DEFAULT 0,
        bytes_in   INTEGER NOT NULL DEFAULT 0, -- request bodies (pushes)
        bytes_out  INTEGER NOT NULL DEFAULT 0, -- response bodies (egress)
        PRIMARY KEY (day, store_id)
      );
      CREATE INDEX IF NOT EXISTS idx_usage_day ON usage_daily(day);
    `);
  },
  // v3 — Google-OIDC migration: the account handle is no longer a GitHub login but
  // the provider's stable subject id. Rename the column (data preserved) and swap
  // the partial unique index. On a fresh DB v1 created github_login; on the live
  // volume (user_version=2) only this step runs. Existing rows keep their old value
  // under the new name — harmless, since Google logins resolve by email anyway.
  (db) => {
    db.exec(`
      ALTER TABLE accounts RENAME COLUMN github_login TO provider_sub;
      DROP INDEX IF EXISTS idx_accounts_github;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_provider
        ON accounts(provider_sub) WHERE provider_sub IS NOT NULL;
    `);
  },
  // v4 — device authorization grant (RFC 8628, docs/protocol/device-auth.md). A
  // short-lived record per `memorize login` attempt: pending -> approved (browser)
  // -> consumed (poll). NO token column — the key is minted at collection and only
  // its hash is stored (api_tokens), so plaintext keys are never persisted.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS device_auth (
        device_code    TEXT PRIMARY KEY,          -- opaque client-held secret
        user_code      TEXT NOT NULL UNIQUE,      -- short human code (XXXX-XXXX)
        account_id     TEXT REFERENCES accounts(id), -- NULL until approved
        status         TEXT NOT NULL,             -- 'pending' | 'approved' | 'denied'
        label          TEXT NOT NULL,             -- label for the key minted on collect
        created_at     TEXT NOT NULL,
        expires_at     TEXT NOT NULL,
        last_polled_at TEXT                        -- drives slow_down pacing
      );
      CREATE INDEX IF NOT EXISTS idx_device_expires ON device_auth(expires_at);
    `);
  },
  // v5 — source-store attribution (docs/protocol/workspace.md §Source stores). A
  // member self-declares "my local store proj_X writes into this workspace" so the
  // Timeline can resolve per-event `sourceProjectId` provenance to the owning
  // ACCOUNT (canvas chat grammar: bubble unit = member). Voluntary control-plane
  // metadata, declared by the client — the gateway still never reads event
  // content (H010).
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS source_stores (
        store_id          TEXT NOT NULL REFERENCES stores(store_id),
        source_project_id TEXT NOT NULL,           -- client-minted proj_…
        account_id        TEXT NOT NULL REFERENCES accounts(id),
        label             TEXT,                    -- human handle (repo/machine), display only
        registered_at     TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        PRIMARY KEY (store_id, source_project_id)
      );
      CREATE INDEX IF NOT EXISTS idx_source_stores_account ON source_stores(account_id);
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
 * pragmas + migrations. Uncached: the gateway opens one handle at boot.
 * ':memory:' is supported for tests.
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
