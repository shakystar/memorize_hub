import type Database from 'better-sqlite3';

import { generateApiKey, hashToken, newId } from './auth.js';

/**
 * Control-plane data access over the gateway DB (see db.ts). All identity / ACL
 * / access-request queries live here. No event data ever passes through.
 */

export interface TokenIdentity {
  tokenId: string;
  userId: string;
}

export interface AccessRequest {
  id: string;
  email: string;
  requested_project_id: string;
  note: string | null;
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
  decided_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Resolve an API key plaintext to its (non-revoked) owner, or null. */
export function identifyToken(db: Database.Database, plaintext: string): TokenIdentity | null {
  const row = db
    .prepare('SELECT id, user_id, revoked_at FROM api_tokens WHERE token_hash = ?')
    .get(hashToken(plaintext)) as
    | { id: string; user_id: string; revoked_at: string | null }
    | undefined;
  if (!row || row.revoked_at) return null;
  return { tokenId: row.id, userId: row.user_id };
}

/** Best-effort last-used stamp (observability only). */
export function touchToken(db: Database.Database, tokenId: string): void {
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), tokenId);
}

/** True iff the user holds any ACL row for the project. */
export function hasProjectAccess(
  db: Database.Database,
  userId: string,
  projectId: string,
): boolean {
  const row = db
    .prepare('SELECT 1 FROM project_acl WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId);
  return row !== undefined;
}

/** Get-or-create a user by email; returns the user id. */
export function upsertUser(db: Database.Database, email: string): string {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;
  const id = newId('usr');
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(
    id,
    email,
    nowIso(),
  );
  return id;
}

/** Grant a user access to a project (idempotent). */
export function grantProjectAccess(
  db: Database.Database,
  userId: string,
  projectId: string,
  role = 'member',
): void {
  db.prepare(
    `INSERT INTO project_acl (project_id, user_id, role, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, user_id) DO NOTHING`,
  ).run(projectId, userId, role, nowIso());
}

/** Mint and persist a project-scoped API key; returns the one-time plaintext. */
export function issueApiKey(
  db: Database.Database,
  userId: string,
  label?: string,
): { plaintext: string; tokenId: string; prefix: string } {
  const key = generateApiKey();
  const id = newId('tok');
  db.prepare(
    `INSERT INTO api_tokens (id, user_id, token_hash, prefix, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, key.hash, key.prefix, label ?? null, nowIso());
  return { plaintext: key.plaintext, tokenId: id, prefix: key.prefix };
}

/** Revoke a token by id; returns true if a live token was revoked. */
export function revokeToken(db: Database.Database, tokenId: string): boolean {
  const result = db
    .prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(nowIso(), tokenId);
  return result.changes > 0;
}

/** Record a beta access request (status=pending). */
export function createAccessRequest(
  db: Database.Database,
  email: string,
  projectId: string,
  note?: string,
): string {
  const id = newId('req');
  db.prepare(
    `INSERT INTO access_requests
       (id, email, requested_project_id, note, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  ).run(id, email, projectId, note ?? null, nowIso());
  return id;
}

export function getAccessRequest(db: Database.Database, id: string): AccessRequest | undefined {
  return db.prepare('SELECT * FROM access_requests WHERE id = ?').get(id) as
    | AccessRequest
    | undefined;
}

export function listAccessRequests(
  db: Database.Database,
  status?: AccessRequest['status'],
): AccessRequest[] {
  const sql = status
    ? `SELECT * FROM access_requests WHERE status = ? ORDER BY created_at`
    : `SELECT * FROM access_requests ORDER BY created_at`;
  const stmt = db.prepare(sql);
  return (status ? stmt.all(status) : stmt.all()) as AccessRequest[];
}

/** Mark a request approved/denied. */
export function decideAccessRequest(
  db: Database.Database,
  id: string,
  status: 'approved' | 'denied',
): void {
  db.prepare('UPDATE access_requests SET status = ?, decided_at = ? WHERE id = ?').run(
    status,
    nowIso(),
    id,
  );
}

/**
 * Approve a request: upsert the user, grant project access, mint a one-time
 * project-scoped key, and mark the request approved. Shared by the admin CLI
 * and the operator dashboard so both behave identically. Returns null if the
 * request id is unknown.
 */
export function approveAccessRequest(
  db: Database.Database,
  requestId: string,
  label?: string,
): { plaintext: string; prefix: string; request: AccessRequest } | null {
  const request = getAccessRequest(db, requestId);
  if (!request) return null;
  const userId = upsertUser(db, request.email);
  grantProjectAccess(db, userId, request.requested_project_id);
  const { plaintext, prefix } = issueApiKey(db, userId, label ?? request.email);
  decideAccessRequest(db, requestId, 'approved');
  return { plaintext, prefix, request };
}
