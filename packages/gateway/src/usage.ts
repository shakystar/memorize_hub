import type Database from 'better-sqlite3';

/**
 * Data-plane usage metering (cost visibility, NOT access control). The events
 * proxy records one increment per forwarded request — bytes in (pushes) + bytes
 * out (egress) per store per UTC day. Aggregate sizes only, never event content,
 * so relay opacity (H010) is preserved. The operator Overview reads this back to
 * estimate Fly storage + egress cost; nothing here decides authorization.
 */

/** UTC calendar day key, e.g. '2026-07-01'. */
function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Add one request's byte counts to today's per-store row (upsert). Cheap enough
 * for the hot path under WAL; callers wrap it so a metering failure never breaks
 * the proxied response.
 */
export function recordUsage(
  db: Database.Database,
  storeId: string,
  bytesIn: number,
  bytesOut: number,
  now: Date = new Date(),
): void {
  db.prepare(
    `INSERT INTO usage_daily (day, store_id, requests, bytes_in, bytes_out)
       VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(day, store_id) DO UPDATE SET
       requests  = requests  + 1,
       bytes_in  = bytes_in  + excluded.bytes_in,
       bytes_out = bytes_out + excluded.bytes_out`,
  ).run(utcDay(now), storeId, bytesIn, bytesOut);
}

export interface UsageRow {
  day: string;
  storeId: string;
  requests: number;
  bytesIn: number;
  bytesOut: number;
}

/** Per-day, per-store rows on/after `sinceDay` (UTC 'YYYY-MM-DD'), newest first. */
export function usageSince(db: Database.Database, sinceDay: string): UsageRow[] {
  return db
    .prepare(
      `SELECT day, store_id AS storeId, requests, bytes_in AS bytesIn, bytes_out AS bytesOut
         FROM usage_daily
        WHERE day >= ?
        ORDER BY day DESC, bytes_out DESC`,
    )
    .all(sinceDay) as UsageRow[];
}
