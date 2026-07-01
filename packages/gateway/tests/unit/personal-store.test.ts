import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { loadGatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { issueApiKey } from '../../src/keys.js';
import { getOrCreatePersonalStore } from '../../src/personal-store.js';
import { createGatewayServer } from '../../src/server.js';

/**
 * S2 slice: personal-store discovery + the owner-only data-plane ACL
 * (personal-store.md). The events proxy's relay forwarding needs a live relay, so
 * these cover only the gateway-side auth gate (no relay required).
 */

const db = openGatewayDb(':memory:');
const config = loadGatewayConfig({});
const server = createGatewayServer({ db, config });
let base = '';

// Two accounts: `alice` (unscoped + a scoped key) and `bob` (owns another store).
const alice = upsertAccountByEmail(db, 'alice@example.com');
const bob = upsertAccountByEmail(db, 'bob@example.com');
const aliceUnscoped = issueApiKey(db, alice, 'alice-laptop').plaintext;
const aliceScoped = issueApiKey(db, alice, 'alice-ci', { storeIds: ['wsp_something'] }).plaintext;
const bobStore = getOrCreatePersonalStore(db, bob).storeId;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
  db.close();
});

function auth(key: string): { authorization: string } {
  return { authorization: `Bearer ${key}` };
}

describe('personal-store discovery', () => {
  it('401s without a key', async () => {
    const res = await fetch(`${base}/v1/account/personal-store`);
    expect(res.status).toBe(401);
  });

  it('provisions and returns a psm_ id for an unscoped key', async () => {
    const res = await fetch(`${base}/v1/account/personal-store`, { headers: auth(aliceUnscoped) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { storeId: string; eventsUrl: string };
    expect(body.storeId.startsWith('psm_')).toBe(true);
    expect(body.eventsUrl).toBe(`/v1/projects/${body.storeId}/events`);
  });

  it('is idempotent — same account resolves the same store', async () => {
    const a = (await (await fetch(`${base}/v1/account/personal-store`, { headers: auth(aliceUnscoped) })).json()) as { storeId: string };
    const b = (await (await fetch(`${base}/v1/account/personal-store`, { headers: auth(aliceUnscoped) })).json()) as { storeId: string };
    expect(a.storeId).toBe(b.storeId);
  });

  it('403s a scoped key (personal memory needs an unscoped key)', async () => {
    const res = await fetch(`${base}/v1/account/personal-store`, { headers: auth(aliceScoped) });
    expect(res.status).toBe(403);
  });
});

describe('personal-store data-plane ACL', () => {
  it('401s the events route without a key', async () => {
    const res = await fetch(`${base}/v1/projects/${bobStore}/events`);
    expect(res.status).toBe(401);
  });

  it("403s another account's personal store (owner-only isolation)", async () => {
    const res = await fetch(`${base}/v1/projects/${bobStore}/events`, { headers: auth(aliceUnscoped) });
    expect(res.status).toBe(403);
  });

  it('403s a scoped key against personal memory', async () => {
    const own = (await (await fetch(`${base}/v1/account/personal-store`, { headers: auth(aliceUnscoped) })).json()) as { storeId: string };
    const res = await fetch(`${base}/v1/projects/${own.storeId}/events`, { headers: auth(aliceScoped) });
    expect(res.status).toBe(403);
  });

  it('400s an invalid store id', async () => {
    const res = await fetch(`${base}/v1/projects/${encodeURIComponent('bad/id')}/events`, {
      headers: auth(aliceUnscoped),
    });
    expect(res.status).toBe(400);
  });
});
