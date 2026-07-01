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

/* --------------------------------------------------------------- accounts --- */

/**
 * One row per account for the operator Accounts list. Membership-role based:
 * `owned`/`joined` come from the memberships table (owner vs member), `keysActive`
 * from unrevoked api_tokens, `personal` = whether a psm_ store exists. Identity +
 * counts only — never key values, never event content (H010).
 */
export interface AccountSummary {
  accountId: string;
  email: string;
  createdAt: string;
  owned: number;
  joined: number;
  keysActive: number;
  personal: boolean;
}

export function listAccounts(db: Database.Database): AccountSummary[] {
  const rows = db
    .prepare(
      `SELECT a.id AS accountId, a.email AS email, a.created_at AS createdAt,
        (SELECT COUNT(*) FROM memberships m WHERE m.account_id = a.id AND m.role = 'owner')  AS owned,
        (SELECT COUNT(*) FROM memberships m WHERE m.account_id = a.id AND m.role = 'member') AS joined,
        (SELECT COUNT(*) FROM api_tokens  t WHERE t.account_id = a.id AND t.revoked_at IS NULL) AS keysActive,
        (SELECT COUNT(*) FROM personal_stores p WHERE p.account_id = a.id) AS personal
       FROM accounts a
       ORDER BY a.created_at ASC`,
    )
    .all() as Array<Omit<AccountSummary, 'personal'> & { personal: number }>;
  return rows.map((r) => ({ ...r, personal: r.personal > 0 }));
}

/* ---------------------------------------------------------------- billing --- */

/**
 * Per-account entitlement + cost attribution — the billing SEAM (H080). There is
 * no `plan` column and no enforcement yet; every account is implicitly unlimited.
 * This surfaces the quantities a future free/plus/pro tier would cap (workspace
 * count, invite headcount) alongside cost metering, attributed to the store's
 * CREATOR (`stores.created_by`) + the account's own personal store. Operator-only,
 * read-only, aggregate — never user-facing, never key/content data.
 */
export interface AccountBilling {
  accountId: string;
  email: string;
  workspaces: number; // stores this account created (the future workspace-count cap)
  members: number; // total members across those stores (the future invite-headcount cap)
  storedBytes: number; // relay bytes attributed to this account (0 if relay unreachable)
  requests: number;
  egressBytes: number;
  ingressBytes: number;
}

export interface Billing {
  days: number;
  relayReachable: boolean;
  rows: AccountBilling[];
}

/**
 * Full per-store byte sizes from the relay (GET /v1/stats), for cost attribution.
 * Unlike `fetchRelayStorage` (which caps to a display top-N), this returns the
 * complete storeId -> bytes map. `null` = relay unreachable/erroring (the page
 * still renders; storage columns just read as unattributed).
 */
export async function fetchRelayStoreSizes(
  config: GatewayConfig,
): Promise<Map<string, number> | null> {
  try {
    const headers: Record<string, string> = {};
    if (config.relayToken) headers.authorization = `Bearer ${config.relayToken}`;
    const res = await fetch(`${config.relayUrl}/v1/stats`, { headers });
    if (!res.ok) return null;
    const data = (await res.json()) as { stores?: StoreSize[] };
    const sizes = new Map<string, number>();
    for (const s of data.stores ?? []) sizes.set(s.storeId, s.bytes);
    return sizes;
  } catch {
    return null;
  }
}

export async function gatherBilling(
  db: Database.Database,
  config: GatewayConfig,
  now: Date = new Date(),
  days = 7,
): Promise<Billing> {
  const sizes = await fetchRelayStoreSizes(config);

  // storeId -> owning account: a workspace bills to its creator; a personal store
  // bills to its account. (Shared workspaces can have several owners; created_by
  // is the single, unambiguous billing anchor.)
  const owner = new Map<string, string>();
  for (const s of db.prepare('SELECT store_id, created_by FROM stores').all() as Array<{
    store_id: string;
    created_by: string;
  }>) {
    owner.set(s.store_id, s.created_by);
  }
  for (const p of db.prepare('SELECT store_id, account_id FROM personal_stores').all() as Array<{
    store_id: string;
    account_id: string;
  }>) {
    owner.set(p.store_id, p.account_id);
  }

  const rows: AccountBilling[] = (
    db.prepare('SELECT id, email FROM accounts ORDER BY created_at ASC').all() as Array<{
      id: string;
      email: string;
    }>
  ).map((a) => ({
    accountId: a.id,
    email: a.email,
    workspaces: 0,
    members: 0,
    storedBytes: 0,
    requests: 0,
    egressBytes: 0,
    ingressBytes: 0,
  }));
  const byId = new Map(rows.map((r) => [r.accountId, r]));

  for (const w of db
    .prepare('SELECT created_by AS acc, COUNT(*) AS n FROM stores GROUP BY created_by')
    .all() as Array<{ acc: string; n: number }>) {
    const r = byId.get(w.acc);
    if (r) r.workspaces = w.n;
  }
  for (const m of db
    .prepare(
      `SELECT s.created_by AS acc, COUNT(*) AS n
         FROM memberships mm JOIN stores s ON s.store_id = mm.store_id
        GROUP BY s.created_by`,
    )
    .all() as Array<{ acc: string; n: number }>) {
    const r = byId.get(m.acc);
    if (r) r.members = m.n;
  }

  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const u of usageSince(db, since)) {
    const acc = owner.get(u.storeId);
    const r = acc ? byId.get(acc) : undefined;
    if (!r) continue;
    r.requests += u.requests;
    r.egressBytes += u.bytesOut;
    r.ingressBytes += u.bytesIn;
  }
  if (sizes) {
    for (const [storeId, bytes] of sizes) {
      const acc = owner.get(storeId);
      const r = acc ? byId.get(acc) : undefined;
      if (r) r.storedBytes += bytes;
    }
  }

  return { days, relayReachable: sizes !== null, rows };
}
