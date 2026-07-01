import { describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { openGatewayDb } from '../../src/db.js';
import { issueApiKey, revokeToken } from '../../src/keys.js';
import { controlPlaneCounts, trafficSince } from '../../src/overview.js';
import { getOrCreatePersonalStore } from '../../src/personal-store.js';
import { addMember, createStore } from '../../src/stores.js';
import { recordUsage } from '../../src/usage.js';

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
