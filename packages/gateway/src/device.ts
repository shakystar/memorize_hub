import { randomBytes } from 'node:crypto';

import type Database from 'better-sqlite3';

import type { GatewayConfig } from './config.js';

/**
 * Device Authorization Grant (RFC 8628) state — docs/protocol/device-auth.md. A
 * short-lived control-plane record lets a CLI obtain an API key via a browser
 * approval instead of a manually-copied dashboard key. The key is minted at
 * COLLECTION (the approved poll), never stored here — the row has no token column,
 * so the "keys are stored hashed, never in plaintext" rule (README §3) still holds.
 */

const EXPIRES_IN_S = 600; // 10 minutes
const INTERVAL_S = 5; // minimum seconds between polls
// Human code alphabet without look-alikes (no O/0/I/1); 8 chars grouped XXXX-XXXX.
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const DEFAULT_DEVICE_LABEL = 'device login';

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Normalize a user-typed code: uppercase, strip separators, regroup XXXX-XXXX. */
export function normalizeUserCode(input: string): string {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

function randomUserCode(): string {
  const bytes = randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i += 1) s += USER_CODE_ALPHABET[bytes[i]! % USER_CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Delete expired rows so a stale row can't hold a user_code or be polled. */
function sweepExpired(db: Database.Database, nowMs: number): void {
  db.prepare('DELETE FROM device_auth WHERE expires_at < ?').run(iso(nowMs));
}

export interface DeviceCodeResult {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/** Start a device authorization: mint codes, store a pending row, return the grant. */
export function startDeviceAuth(
  db: Database.Database,
  config: GatewayConfig,
  nowMs: number,
  label: string = DEFAULT_DEVICE_LABEL,
): DeviceCodeResult {
  sweepExpired(db, nowMs);
  const deviceCode = randomBytes(32).toString('base64url');
  let userCode = randomUserCode();
  for (let i = 0; i < 10 && db.prepare('SELECT 1 FROM device_auth WHERE user_code = ?').get(userCode); i += 1) {
    userCode = randomUserCode();
  }
  db.prepare(
    `INSERT INTO device_auth (device_code, user_code, account_id, status, label, created_at, expires_at, last_polled_at)
     VALUES (?, ?, NULL, 'pending', ?, ?, ?, NULL)`,
  ).run(deviceCode, userCode, label, iso(nowMs), iso(nowMs + EXPIRES_IN_S * 1000));
  const verificationUri = `${config.publicUrl}/device`;
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
    expires_in: EXPIRES_IN_S,
    interval: INTERVAL_S,
  };
}

export interface PendingDevice {
  userCode: string;
  label: string;
}

/** A still-pending, unexpired request for this user_code (for the approval page). */
export function findPendingByUserCode(
  db: Database.Database,
  userCode: string,
  nowMs: number,
): PendingDevice | null {
  const row = db
    .prepare('SELECT user_code, label, status, expires_at FROM device_auth WHERE user_code = ?')
    .get(normalizeUserCode(userCode)) as
    | { user_code: string; label: string; status: string; expires_at: string }
    | undefined;
  if (!row || row.status !== 'pending' || Date.parse(row.expires_at) < nowMs) return null;
  return { userCode: row.user_code, label: row.label };
}

/** Approve a pending request for an authenticated account. Returns false if gone. */
export function approveDevice(
  db: Database.Database,
  userCode: string,
  accountId: string,
  nowMs: number,
): boolean {
  const code = normalizeUserCode(userCode);
  const row = db
    .prepare('SELECT status, expires_at FROM device_auth WHERE user_code = ?')
    .get(code) as { status: string; expires_at: string } | undefined;
  if (!row || row.status !== 'pending' || Date.parse(row.expires_at) < nowMs) return false;
  db.prepare("UPDATE device_auth SET status = 'approved', account_id = ? WHERE user_code = ?").run(
    accountId,
    code,
  );
  return true;
}

export type PollResult =
  | { kind: 'pending' }
  | { kind: 'slow_down' }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'approved'; accountId: string; label: string };

/**
 * Poll a device_code. Enforces the min interval, expiry, and single delivery: an
 * approved poll returns the account (the caller mints the key) and CONSUMES the
 * row, so a re-poll of a collected grant reads as expired.
 */
export function pollDeviceToken(db: Database.Database, deviceCode: string, nowMs: number): PollResult {
  const row = db
    .prepare(
      'SELECT account_id, status, label, expires_at, last_polled_at FROM device_auth WHERE device_code = ?',
    )
    .get(deviceCode) as
    | {
        account_id: string | null;
        status: string;
        label: string;
        expires_at: string;
        last_polled_at: string | null;
      }
    | undefined;
  if (!row || Date.parse(row.expires_at) < nowMs) return { kind: 'expired' };
  if (row.last_polled_at && nowMs - Date.parse(row.last_polled_at) < INTERVAL_S * 1000) {
    return { kind: 'slow_down' };
  }
  db.prepare('UPDATE device_auth SET last_polled_at = ? WHERE device_code = ?').run(iso(nowMs), deviceCode);
  if (row.status === 'denied') return { kind: 'denied' };
  if (row.status !== 'approved' || !row.account_id) return { kind: 'pending' };
  db.prepare('DELETE FROM device_auth WHERE device_code = ?').run(deviceCode);
  return { kind: 'approved', accountId: row.account_id, label: row.label };
}
