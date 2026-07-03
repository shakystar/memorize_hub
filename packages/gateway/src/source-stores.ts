import type Database from 'better-sqlite3';

/**
 * Source-store attribution DAL (docs/protocol/workspace.md §Source stores).
 *
 * A workspace event's `sourceProjectId` provenance names the client-minted local
 * store (`proj_…`) it was authored in — an id the control-plane cannot see inside
 * events (H010) and does not mint (H050). This table is the voluntary,
 * client-declared bridge: a member registers "source store proj_X in workspace W
 * is mine", and the Timeline uses it to resolve provenance to the owning account
 * (canvas chat grammar: bubble unit = member, agent/repo demoted to bubble meta).
 *
 * First registration wins per (workspace, source store): a source store cannot be
 * re-claimed by another account (spoof guard). The registrant may re-register to
 * update the display label.
 */

function nowIso(): string {
  return new Date().toISOString();
}

export interface SourceStore {
  sourceProjectId: string;
  accountId: string;
  /** Registrant's email — the Timeline's member display handle. */
  email: string;
  /** Human handle for the source store (repo/machine name); display only. */
  label: string | null;
  registeredAt: string;
}

/**
 * Register (idempotent) the account as owner of a source store within a
 * workspace. Same-account re-registration updates the label; a source store
 * already claimed by ANOTHER account is refused (handler -> 409).
 */
export function registerSourceStore(
  db: Database.Database,
  storeId: string,
  sourceProjectId: string,
  accountId: string,
  label?: string,
): { ok: true } | { ok: false; reason: 'owned_by_other' } {
  const existing = db
    .prepare('SELECT account_id FROM source_stores WHERE store_id = ? AND source_project_id = ?')
    .get(storeId, sourceProjectId) as { account_id: string } | undefined;
  if (existing && existing.account_id !== accountId) {
    return { ok: false, reason: 'owned_by_other' };
  }
  const now = nowIso();
  db.prepare(
    `INSERT INTO source_stores
       (store_id, source_project_id, account_id, label, registered_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(store_id, source_project_id)
       DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at`,
  ).run(storeId, sourceProjectId, accountId, label ?? null, now, now);
  return { ok: true };
}

/** All registered source stores of a workspace, with the owning account's email. */
export function listSourceStores(db: Database.Database, storeId: string): SourceStore[] {
  const rows = db
    .prepare(
      `SELECT ss.source_project_id, ss.account_id, ss.label, ss.registered_at, a.email
         FROM source_stores ss JOIN accounts a ON a.id = ss.account_id
        WHERE ss.store_id = ? ORDER BY ss.registered_at ASC`,
    )
    .all(storeId) as Array<{
    source_project_id: string;
    account_id: string;
    label: string | null;
    registered_at: string;
    email: string;
  }>;
  return rows.map((r) => ({
    sourceProjectId: r.source_project_id,
    accountId: r.account_id,
    email: r.email,
    label: r.label,
    registeredAt: r.registered_at,
  }));
}
