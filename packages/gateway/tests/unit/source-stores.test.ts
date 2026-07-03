import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { loadGatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { issueApiKey } from '../../src/keys.js';
import { createGatewayServer } from '../../src/server.js';
import { listSourceStores } from '../../src/source-stores.js';
import { addMember, createStore } from '../../src/stores.js';

const db = openGatewayDb(':memory:');
const alice = upsertAccountByEmail(db, 'alice@sources.example');
const bob = upsertAccountByEmail(db, 'bob@sources.example');
const mallory = upsertAccountByEmail(db, 'mallory@sources.example');
const { storeId } = createStore(db, alice, 'sources');
addMember(db, storeId, bob, 'member');

const aliceKey = issueApiKey(db, alice, 'alice').plaintext;
const bobScopedKey = issueApiKey(db, bob, 'bob-machine', { storeIds: [storeId] }).plaintext;
const bobReadOnlyKey = issueApiKey(db, bob, 'bob-ro', { readOnly: true }).plaintext;
const malloryKey = issueApiKey(db, mallory, 'mallory').plaintext;

let base = '';
let gateway: Server;

beforeAll(async () => {
  gateway = createGatewayServer({ db, config: loadGatewayConfig({}) });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
});

afterAll(() => {
  gateway.close();
  db.close();
});

function register(key: string, body: unknown) {
  return fetch(`${base}/v1/workspaces/${storeId}/source-stores`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/workspaces/:id/source-stores', () => {
  it('401s without a principal', async () => {
    const res = await fetch(`${base}/v1/workspaces/${storeId}/source-stores`, {
      method: 'POST',
      body: JSON.stringify({ sourceProjectId: 'proj_anon' }),
    });
    expect(res.status).toBe(401);
  });

  it('403s a non-member (data-plane denial, like the events route)', async () => {
    const res = await register(malloryKey, { sourceProjectId: 'proj_mallory' });
    expect(res.status).toBe(403);
  });

  it('403s a read-only key', async () => {
    const res = await register(bobReadOnlyKey, { sourceProjectId: 'proj_bob_ro' });
    expect(res.status).toBe(403);
  });

  it('400s a non-proj_ source id', async () => {
    for (const sourceProjectId of ['wsp_nope', 'proj_', 'proj_has space', 42, undefined]) {
      const res = await register(aliceKey, { sourceProjectId });
      expect(res.status).toBe(400);
    }
  });

  it('registers with a SCOPED writable key — registration travels with push', async () => {
    const res = await register(bobScopedKey, {
      sourceProjectId: 'proj_bob_laptop',
      label: 'bob-laptop',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      workspaceId: storeId,
      sourceProjectId: 'proj_bob_laptop',
      accountId: bob,
      label: 'bob-laptop',
    });
  });

  it('re-registration by the same account is idempotent and updates the label', async () => {
    const res = await register(bobScopedKey, {
      sourceProjectId: 'proj_bob_laptop',
      label: 'bob laptop (renamed)',
    });
    expect(res.status).toBe(200);
    const rows = listSourceStores(db, storeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceProjectId: 'proj_bob_laptop',
      accountId: bob,
      email: 'bob@sources.example',
      label: 'bob laptop (renamed)',
    });
  });

  it("409s another member's claim on a registered source store (spoof guard)", async () => {
    const res = await register(aliceKey, { sourceProjectId: 'proj_bob_laptop' });
    expect(res.status).toBe(409);
    expect(listSourceStores(db, storeId)[0]?.accountId).toBe(bob);
  });

  it('label is optional and normalizes empty to null', async () => {
    const res = await register(aliceKey, { sourceProjectId: 'proj_alice_desktop', label: '  ' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { label: string | null }).label).toBeNull();
  });
});
