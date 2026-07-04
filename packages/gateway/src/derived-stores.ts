import type Database from 'better-sqlite3';

import { newId } from './ids.js';

/**
 * Derived-artifact sidecar store DAL (spec 2026-07-04-derived-sidecar-store).
 * A der_ store is bound to exactly one PARENT source store + artifact_kind, holds
 * regenerable artifacts (embeddings first) that live opaque in the relay, and has
 * NO memberships of its own — authorize() inherits the parent's ACL (H030). One
 * store per (parent, kind); get-or-create is idempotent, mirroring
 * personal-store.ts.
 */

function nowIso(): string {
  return new Date().toISOString();
}

/** Artifact kinds a sidecar may hold. Extend the set as new tenants land. */
export const ARTIFACT_KINDS = new Set<string>(['embedding']);

export function isArtifactKind(kind: string): boolean {
  return ARTIFACT_KINDS.has(kind);
}

export interface DerivedStore {
  /** The relay path id (`der_…`) this artifact kind syncs under. */
  storeId: string;
  createdAt: string;
}

/** Get-or-create the sidecar store for (parentStoreId, artifactKind). Idempotent. */
export function getOrCreateDerivedStore(
  db: Database.Database,
  parentStoreId: string,
  artifactKind: string,
): DerivedStore {
  const existing = db
    .prepare(
      'SELECT store_id, created_at FROM derived_stores WHERE parent_store_id = ? AND artifact_kind = ?',
    )
    .get(parentStoreId, artifactKind) as { store_id: string; created_at: string } | undefined;
  if (existing) return { storeId: existing.store_id, createdAt: existing.created_at };
  const storeId = newId('der');
  const createdAt = nowIso();
  db.prepare(
    'INSERT INTO derived_stores (parent_store_id, artifact_kind, store_id, created_at) VALUES (?, ?, ?, ?)',
  ).run(parentStoreId, artifactKind, storeId, createdAt);
  return { storeId, createdAt };
}

/** Resolve a der_ store id to its parent binding, or null if unknown. */
export function getDerivedStoreParent(
  db: Database.Database,
  storeId: string,
): { parentStoreId: string; artifactKind: string } | null {
  const row = db
    .prepare('SELECT parent_store_id, artifact_kind FROM derived_stores WHERE store_id = ?')
    .get(storeId) as { parent_store_id: string; artifact_kind: string } | undefined;
  return row ? { parentStoreId: row.parent_store_id, artifactKind: row.artifact_kind } : null;
}

/** Delete every sidecar binding of a parent store (owner teardown cascade). */
export function deleteDerivedStores(db: Database.Database, parentStoreId: string): void {
  db.prepare('DELETE FROM derived_stores WHERE parent_store_id = ?').run(parentStoreId);
}
