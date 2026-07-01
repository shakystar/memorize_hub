import type { Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Relay is started in-process (same pattern as proxy.test.ts) so the gateway→relay
// hop is a real HTTP round-trip without requiring a prior relay build.
import { createRelayServer } from '../../../relay/src/server.js';
import { EventStore } from '../../../relay/src/store.js';

import type { GatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { createGatewayServer } from '../../src/server.js';
import { grantProjectAccess, issueApiKey, upsertUser } from '../../src/store.js';

const RELAY_TOKEN = 'relay-internal-secret';
const ALICE_PROJECT = 'proj_alice';

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}
function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe('personal memory store: discovery + owner-only isolation', () => {
  let dir: string;
  let relay: Server;
  let gateway: Server;
  let db: BetterSqlite3.Database;
  let base: string;
  let aliceKey: string; // unscoped → covers personal
  let aliceRoKey: string; // unscoped read-only
  let aliceScopedKey: string; // project-scoped → cannot reach personal
  let bobKey: string; // a different account

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hub-gw-personal-'));

    const store = await EventStore.open(join(dir, 'relay-store'));
    relay = createRelayServer({ store, token: RELAY_TOKEN });
    const relayPort = await listen(relay);

    db = openGatewayDb(join(dir, 'gateway.db'));
    const config: GatewayConfig = {
      port: 0,
      dbFile: join(dir, 'gateway.db'),
      relayUrl: `http://127.0.0.1:${relayPort}`,
      relayToken: RELAY_TOKEN,
      publicUrl: undefined,
      githubClientId: undefined,
      githubClientSecret: undefined,
      adminLogins: [],
      sessionSecret: undefined,
    };
    gateway = createGatewayServer({ db, config });
    base = `http://127.0.0.1:${await listen(gateway)}`;

    const aliceId = upsertUser(db, 'alice@example.com');
    grantProjectAccess(db, aliceId, ALICE_PROJECT);
    aliceKey = issueApiKey(db, aliceId, 'alice').plaintext;
    aliceRoKey = issueApiKey(db, aliceId, 'alice-ro', { readOnly: true }).plaintext;
    aliceScopedKey = issueApiKey(db, aliceId, 'alice-scoped', {
      projectIds: [ALICE_PROJECT],
    }).plaintext;

    // Bob has no projects at all — personal memory must still work for him.
    const bobId = upsertUser(db, 'bob@example.com');
    bobKey = issueApiKey(db, bobId, 'bob').plaintext;
  });

  afterAll(async () => {
    await close(gateway);
    await close(relay);
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  function discover(key: string): Promise<Response> {
    return fetch(`${base}/v1/account/personal-store`, {
      headers: { authorization: `Bearer ${key}` },
    });
  }
  function push(storeId: string, key: string, events: unknown[]): Promise<Response> {
    return fetch(`${base}/v1/projects/${storeId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ projectId: storeId, events }),
    });
  }
  function pull(storeId: string, key: string): Promise<Response> {
    return fetch(`${base}/v1/projects/${storeId}/events`, {
      headers: { authorization: `Bearer ${key}` },
    });
  }

  it('provisions a personal store on first discovery and is idempotent', async () => {
    const r1 = await discover(aliceKey);
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { storeId: string; eventsUrl: string };
    expect(b1.storeId).toMatch(/^psm_/);
    expect(b1.eventsUrl).toBe(`/v1/projects/${b1.storeId}/events`);

    const r2 = await discover(aliceKey);
    const b2 = (await r2.json()) as { storeId: string };
    expect(b2.storeId).toBe(b1.storeId); // same store every call
  });

  it('works for an account with no projects', async () => {
    const r = await discover(bobKey);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { storeId: string }).storeId).toMatch(/^psm_/);
  });

  it('round-trips personal events for the owner via the events route', async () => {
    const { storeId } = (await (await discover(aliceKey)).json()) as { storeId: string };
    const pushed = await push(storeId, aliceKey, [
      { id: 'evt_p1', type: 'personal' },
      { id: 'evt_p2', type: 'personal' },
    ]);
    expect(pushed.status).toBe(200);
    const pulled = (await (await pull(storeId, aliceKey)).json()) as { events: { id: string }[] };
    expect(pulled.events.map((e) => e.id)).toEqual(['evt_p1', 'evt_p2']);
  });

  it("denies another account access to a personal store (owner-only)", async () => {
    const { storeId } = (await (await discover(aliceKey)).json()) as { storeId: string };
    expect((await pull(storeId, bobKey)).status).toBe(403);
    const pushed = await push(storeId, bobKey, [{ id: 'evt_evil', type: 'personal' }]);
    expect(pushed.status).toBe(403);
  });

  it('a project-scoped key cannot reach personal memory', async () => {
    // Discovery refuses a scoped key up front.
    expect((await discover(aliceScopedKey)).status).toBe(403);
    // And the events route refuses it on the personal store too.
    const { storeId } = (await (await discover(aliceKey)).json()) as { storeId: string };
    expect((await pull(storeId, aliceScopedKey)).status).toBe(403);
  });

  it('a read-only key may pull personal memory but never push', async () => {
    const { storeId } = (await (await discover(aliceKey)).json()) as { storeId: string };
    expect((await pull(storeId, aliceRoKey)).status).toBe(200);
    const pushed = await push(storeId, aliceRoKey, [{ id: 'evt_ro', type: 'personal' }]);
    expect(pushed.status).toBe(403);
  });

  it('rejects discovery without a key (401)', async () => {
    const res = await fetch(`${base}/v1/account/personal-store`);
    expect(res.status).toBe(401);
  });

  it('refuses to grant a reserved personal-store id as a project', () => {
    const someId = upsertUser(db, 'carol@example.com');
    expect(() => grantProjectAccess(db, someId, 'psm_not_a_project')).toThrow(/personal-store/);
  });
});
