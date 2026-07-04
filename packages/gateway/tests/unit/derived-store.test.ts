import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { loadGatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { issueApiKey } from '../../src/keys.js';
import { createGatewayServer } from '../../src/server.js';
import { createStore } from '../../src/stores.js';

const db = openGatewayDb(':memory:');
const server = createGatewayServer({ db, config: loadGatewayConfig({}) });
let base = '';

const alice = upsertAccountByEmail(db, 'alice@derived.example');
const bob = upsertAccountByEmail(db, 'bob@derived.example');
const { storeId: wsp } = createStore(db, alice, 'alice-parent'); // alice = owner
const aliceKey = issueApiKey(db, alice, 'alice').plaintext;
const bobKey = issueApiKey(db, bob, 'bob').plaintext; // non-member of wsp

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  db.close();
});

function auth(key: string) {
  return { authorization: `Bearer ${key}` };
}
function discover(key: string | null, parent: string, kind: string) {
  return fetch(`${base}/v1/stores/${encodeURIComponent(parent)}/derived/${encodeURIComponent(kind)}`, {
    headers: key ? auth(key) : {},
  });
}

describe('GET /v1/stores/:parent/derived/:kind discovery', () => {
  it('401s without a key', async () => {
    expect((await discover(null, wsp, 'embedding')).status).toBe(401);
  });

  it('400s an invalid parent store id', async () => {
    expect((await discover(aliceKey, 'bad/id', 'embedding')).status).toBe(400);
  });

  it('400s an unknown artifact kind', async () => {
    expect((await discover(aliceKey, wsp, 'bogus')).status).toBe(400);
  });

  it('403s a non-member of the parent', async () => {
    expect((await discover(bobKey, wsp, 'embedding')).status).toBe(403);
  });

  it('provisions and returns a der_ id for a parent member', async () => {
    const res = await discover(aliceKey, wsp, 'embedding');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { storeId: string; eventsUrl: string };
    expect(body.storeId.startsWith('der_')).toBe(true);
    expect(body.eventsUrl).toBe(`/v1/projects/${body.storeId}/events`);
  });

  it('is idempotent — same (parent, kind) resolves the same der_', async () => {
    const a = (await (await discover(aliceKey, wsp, 'embedding')).json()) as { storeId: string };
    const b = (await (await discover(aliceKey, wsp, 'embedding')).json()) as { storeId: string };
    expect(a.storeId).toBe(b.storeId);
  });
});

describe('data-plane events proxy honours der_ (parent-delegated ACL)', () => {
  it('401s the der_ events route without a key', async () => {
    const { storeId } = (await (await discover(aliceKey, wsp, 'embedding')).json()) as { storeId: string };
    expect((await fetch(`${base}/v1/projects/${storeId}/events`)).status).toBe(401);
  });

  it('403s a non-member on the der_ events route', async () => {
    const { storeId } = (await (await discover(aliceKey, wsp, 'embedding')).json()) as { storeId: string };
    const res = await fetch(`${base}/v1/projects/${storeId}/events`, { headers: auth(bobKey) });
    expect(res.status).toBe(403);
  });
});
