import type { Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Relay is started in-process (cross-package source import) so the gateway→relay
// hop is a real HTTP round-trip without requiring a prior relay build.
import { createRelayServer } from '../../../relay/src/server.js';
import { EventStore } from '../../../relay/src/store.js';

import type { GatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { createGatewayServer } from '../../src/server.js';
import { grantProjectAccess, issueApiKey, upsertUser } from '../../src/store.js';

const RELAY_TOKEN = 'relay-internal-secret';
const ALLOWED = 'proj_allowed';
const OTHER = 'proj_other';

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

describe('gateway proxy + auth + ACL', () => {
  let dir: string;
  let relay: Server;
  let gateway: Server;
  let db: BetterSqlite3.Database;
  let gatewayUrl: string;
  let apiKey: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hub-gw-proxy-'));

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
    const gwPort = await listen(gateway);
    gatewayUrl = `http://127.0.0.1:${gwPort}`;

    // Beta participant scoped to ALLOWED only.
    const userId = upsertUser(db, 'beta@example.com');
    grantProjectAccess(db, userId, ALLOWED);
    apiKey = issueApiKey(db, userId, 'beta').plaintext;
  });

  afterAll(async () => {
    await close(gateway);
    await close(relay);
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  function push(project: string, key: string | undefined, events: unknown[]): Promise<Response> {
    return fetch(`${gatewayUrl}/v1/projects/${project}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ projectId: project, events }),
    });
  }

  it('round-trips push → pull through the gateway with a scoped key', async () => {
    const pushRes = await push(ALLOWED, apiKey, [
      { id: 'evt_a', type: 'demo' },
      { id: 'evt_b', type: 'demo' },
    ]);
    expect(pushRes.status).toBe(200);
    const pushBody = (await pushRes.json()) as { accepted: string[] };
    expect(pushBody.accepted).toEqual(['evt_a', 'evt_b']);

    const pullRes = await fetch(`${gatewayUrl}/v1/projects/${ALLOWED}/events`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(pullRes.status).toBe(200);
    const pullBody = (await pullRes.json()) as { events: { id: string }[] };
    expect(pullBody.events.map((e) => e.id)).toEqual(['evt_a', 'evt_b']);
  });

  it('rejects a missing key with 401', async () => {
    const res = await push(ALLOWED, undefined, [{ id: 'evt_x', type: 'demo' }]);
    expect(res.status).toBe(401);
  });

  it('rejects an invalid key with 401', async () => {
    const res = await push(ALLOWED, 'mzk_not-a-real-key', [{ id: 'evt_y', type: 'demo' }]);
    expect(res.status).toBe(401);
  });

  it('rejects a project the key is not scoped to with 403', async () => {
    const res = await push(OTHER, apiKey, [{ id: 'evt_z', type: 'demo' }]);
    expect(res.status).toBe(403);
  });

  it('rejects an invalid project id with 400 (before reaching the relay)', async () => {
    const res = await fetch(`${gatewayUrl}/v1/projects/bad%20id/events`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(400);
  });

  it('serves its own public healthz without auth', async () => {
    const res = await fetch(`${gatewayUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
