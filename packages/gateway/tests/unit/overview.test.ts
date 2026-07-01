import { describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { loadGatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { issueApiKey, revokeToken } from '../../src/keys.js';
import {
  controlPlaneCounts,
  gatherBilling,
  listAccounts,
  trafficSince,
} from '../../src/overview.js';
import { getOrCreatePersonalStore } from '../../src/personal-store.js';
import { addMember, createStore } from '../../src/stores.js';
import { recordUsage } from '../../src/usage.js';

// gatherBilling fetches relay sizes over HTTP; with no relay running the fetch
// fails and it degrades to relayReachable:false (storage columns unattributed).
const config = loadGatewayConfig({
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'csec',
  GATEWAY_PUBLIC_URL: 'https://hub.example',
  GATEWAY_SESSION_SECRET: 'test-secret',
  GATEWAY_ADMIN_EMAILS: 'op@e.com',
});

/**
 * Operator Overview aggregates. Pure/read-only: counts on the control-plane DB and
 * a windowed sum of usage rows. No relay is involved here (that path degrades to
 * unreachable and is covered by the /admin integration test).
 */

describe('overview aggregates', () => {
  it('returns zeros on an empty control plane', () => {
    const db = openGatewayDb(':memory:');
    expect(controlPlaneCounts(db)).toEqual({
      accounts: 0,
      workspacesPrivate: 0,
      workspacesShared: 0,
      members: 0,
      keysActive: 0,
      keysRevoked: 0,
      personalStores: 0,
    });
    db.close();
  });

  it('counts accounts, stores, members, keys (active/revoked), personal stores', () => {
    const db = openGatewayDb(':memory:');
    const alice = upsertAccountByEmail(db, 'alice@e.com');
    const bob = upsertAccountByEmail(db, 'bob@e.com');
    const { storeId } = createStore(db, alice, 'proj'); // private wsp_, owner=alice
    addMember(db, storeId, bob, 'member'); // second member
    getOrCreatePersonalStore(db, alice);
    const revoked = issueApiKey(db, alice, 'a');
    issueApiKey(db, bob, 'b');
    revokeToken(db, revoked.tokenId);

    expect(controlPlaneCounts(db)).toEqual({
      accounts: 2,
      workspacesPrivate: 1,
      workspacesShared: 0,
      members: 2,
      keysActive: 1,
      keysRevoked: 1,
      personalStores: 1,
    });
    db.close();
  });

  it('sums only usage rows inside the day window', () => {
    const db = openGatewayDb(':memory:');
    const now = new Date('2026-07-10T00:00:00.000Z');
    recordUsage(db, 'wsp_a', 10, 100, new Date('2026-07-09T12:00:00.000Z')); // within 7d
    recordUsage(db, 'wsp_a', 5, 50, new Date('2026-07-01T12:00:00.000Z')); // 9d before -> out
    expect(trafficSince(db, 7, now)).toMatchObject({
      days: 7,
      requests: 1,
      bytesIn: 10,
      bytesOut: 100,
    });
    db.close();
  });
});

describe('listAccounts', () => {
  it('lists accounts with owned/joined/keys/personal counts', () => {
    const db = openGatewayDb(':memory:');
    const alice = upsertAccountByEmail(db, 'alice@e.com');
    const bob = upsertAccountByEmail(db, 'bob@e.com');
    const { storeId } = createStore(db, alice, 'proj'); // alice owns
    addMember(db, storeId, bob, 'member'); // bob joins
    getOrCreatePersonalStore(db, alice);
    issueApiKey(db, alice, 'a');

    const rows = listAccounts(db);
    const byEmail = new Map(rows.map((r) => [r.email, r]));
    expect(byEmail.get('alice@e.com')).toMatchObject({
      owned: 1,
      joined: 0,
      keysActive: 1,
      personal: true,
    });
    expect(byEmail.get('bob@e.com')).toMatchObject({
      owned: 0,
      joined: 1,
      keysActive: 0,
      personal: false,
    });
    db.close();
  });
});

describe('gatherBilling (entitlement + cost seam)', () => {
  it('attributes workspace/member counts + windowed usage to the store creator', async () => {
    const db = openGatewayDb(':memory:');
    const now = new Date('2026-07-10T00:00:00.000Z');
    const alice = upsertAccountByEmail(db, 'alice@e.com');
    const bob = upsertAccountByEmail(db, 'bob@e.com');
    const { storeId } = createStore(db, alice, 'proj'); // created_by = alice
    addMember(db, storeId, bob, 'member'); // 2 members total on alice's store
    recordUsage(db, storeId, 10, 100, new Date('2026-07-09T12:00:00.000Z')); // in window
    recordUsage(db, storeId, 7, 70, new Date('2026-06-01T12:00:00.000Z')); // out of window

    const billing = await gatherBilling(db, config, now, 7);
    expect(billing.relayReachable).toBe(false); // no relay running in the test
    const byEmail = new Map(billing.rows.map((r) => [r.email, r]));
    expect(byEmail.get('alice@e.com')).toMatchObject({
      workspaces: 1,
      members: 2,
      requests: 1,
      egressBytes: 100,
      ingressBytes: 10,
      storedBytes: 0, // relay unreachable -> unattributed
    });
    // bob created nothing -> zero attribution even though he is a member.
    expect(byEmail.get('bob@e.com')).toMatchObject({ workspaces: 0, members: 0, requests: 0 });
    db.close();
  });
});
