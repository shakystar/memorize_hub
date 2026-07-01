import type Database from 'better-sqlite3';

import type { GatewayConfig } from './config.js';
import { usageSince, type UsageRow } from './usage.js';

/**
 * Read-only aggregates for the operator Overview (SoT H080 operator surface):
 * control-plane counts, relay storage-at-rest, and recent traffic. Everything is
 * AGGREGATE and non-sensitive — counts, byte sizes, store ids — never key values
 * and never event content (relay opacity, H010). Gathering this decides nothing;
 * the /admin allowlist is the gate.
 */

export interface ControlPlaneCounts {
  accounts: number;
  workspacesPrivate: number;
  workspacesShared: number;
  members: number;
  keysActive: number;
  keysRevoked: number;
  personalStores: number;
}

export interface StoreSize {
  storeId: string;
  events: number;
  bytes: number;
}

export interface RelayStorage {
  /** false when the internal relay stats endpoint could not be reached. */
  reachable: boolean;
  totals: { stores: number; events: number; bytes: number };
  /** Largest stores first (already sorted by the relay), capped for display. */
  top: StoreSize[];
}

export interface TrafficTotals {
  days: number;
  requests: number;
  bytesIn: number;
  bytesOut: number;
  rows: UsageRow[];
}

export interface Overview {
  counts: ControlPlaneCounts;
  storage: RelayStorage;
  traffic: TrafficTotals;
}

export function controlPlaneCounts(db: Database.Database): ControlPlaneCounts {
  const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  return {
    accounts: one('SELECT COUNT(*) AS n FROM accounts'),
    workspacesPrivate: one('SELECT COUNT(*) AS n FROM stores WHERE invite_reachable = 0'),
    workspacesShared: one('SELECT COUNT(*) AS n FROM stores WHERE invite_reachable = 1'),
    members: one('SELECT COUNT(*) AS n FROM memberships'),
    keysActive: one('SELECT COUNT(*) AS n FROM api_tokens WHERE revoked_at IS NULL'),
    keysRevoked: one('SELECT COUNT(*) AS n FROM api_tokens WHERE revoked_at IS NOT NULL'),
    personalStores: one('SELECT COUNT(*) AS n FROM personal_stores'),
  };
}

const EMPTY_STORAGE: RelayStorage = {
  reachable: false,
  totals: { stores: 0, events: 0, bytes: 0 },
  top: [],
};

/**
 * Ask the internal relay for its size snapshot (GET /v1/stats, token-gated). The
 * gateway never touches the relay's files directly — it goes over HTTP like every
 * other relay call. Unreachable/erroring relay degrades to `reachable: false`
 * rather than failing the whole page.
 */
export async function fetchRelayStorage(config: GatewayConfig): Promise<RelayStorage> {
  try {
    const headers: Record<string, string> = {};
    if (config.relayToken) headers.authorization = `Bearer ${config.relayToken}`;
    const res = await fetch(`${config.relayUrl}/v1/stats`, { headers });
    if (!res.ok) return EMPTY_STORAGE;
    const data = (await res.json()) as { stores?: StoreSize[]; totals?: RelayStorage['totals'] };
    return {
      reachable: true,
      totals: data.totals ?? { stores: 0, events: 0, bytes: 0 },
      top: (data.stores ?? []).slice(0, 8),
    };
  } catch {
    return EMPTY_STORAGE;
  }
}

/** Sum usage rows on/after `days` ago (UTC), for the cost-facing traffic block. */
export function trafficSince(db: Database.Database, days: number, now: Date): TrafficTotals {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = usageSince(db, since);
  let requests = 0;
  let bytesIn = 0;
  let bytesOut = 0;
  for (const r of rows) {
    requests += r.requests;
    bytesIn += r.bytesIn;
    bytesOut += r.bytesOut;
  }
  return { days, requests, bytesIn, bytesOut, rows };
}

export async function gatherOverview(
  db: Database.Database,
  config: GatewayConfig,
  now: Date = new Date(),
): Promise<Overview> {
  return {
    counts: controlPlaneCounts(db),
    storage: await fetchRelayStorage(config),
    traffic: trafficSince(db, 7, now),
  };
}
