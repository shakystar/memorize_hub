import type { Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRelayServer } from '../../../relay/src/server.js';
import { EventStore } from '../../../relay/src/store.js';

import type { GatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { createGatewayServer } from '../../src/server.js';
import {
  decideAccessRequest,
  grantProjectAccess,
  issueApiKey,
  listAccessRequests,
  upsertUser,
} from '../../src/store.js';

const RELAY_TOKEN = 'relay-internal-secret';

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

/** The exact sequence hub-gateway-admin `requests approve` performs. */
function approve(db: BetterSqlite3.Database, requestId: string): string {
  const req = listAccessRequests(db).find((r) => r.id === requestId)!;
  const userId = upsertUser(db, req.email);
  grantProjectAccess(db, userId, req.requested_project_id);
  const { plaintext } = issueApiKey(db, userId, req.email);
  decideAccessRequest(db, requestId, 'approved');
  return plaintext;
}

describe('beta request → approval → scoped sync (full loop)', () => {
  let dir: string;
  let relay: Server;
  let gateway: Server;
  let db: BetterSqlite3.Database;
  let gatewayUrl: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hub-gw-beta-'));
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
    };
    gateway = createGatewayServer({ db, config });
    gatewayUrl = `http://127.0.0.1:${await listen(gateway)}`;
  });

  afterAll(async () => {
    await close(gateway);
    await close(relay);
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('serves the public request page', async () => {
    const res = await fetch(`${gatewayUrl}/beta`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('request beta access');
  });

  it('runs the loop: submit → pending → approve → key syncs only its project', async () => {
    // 1. Participant submits the public form.
    const submit = await fetch(`${gatewayUrl}/beta/requests`, {
      method: 'POST',
      body: new URLSearchParams({
        email: 'claude@example.com',
        projectId: 'proj_beta1',
        note: 'two laptops',
      }),
    });
    expect(submit.status).toBe(201);

    // 2. It lands as pending.
    const pending = listAccessRequests(db, 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.requested_project_id).toBe('proj_beta1');

    // 3. Operator approves → mints a project-scoped key.
    const apiKey = approve(db, pending[0]!.id);
    expect(apiKey.startsWith('mzk_')).toBe(true);
    expect(listAccessRequests(db, 'pending')).toHaveLength(0);
    expect(listAccessRequests(db, 'approved')).toHaveLength(1);

    // 4. The key syncs its own project through the gateway...
    const ok = await fetch(`${gatewayUrl}/v1/projects/proj_beta1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ projectId: 'proj_beta1', events: [{ id: 'evt_1', type: 'x' }] }),
    });
    expect(ok.status).toBe(200);
    const pull = await fetch(`${gatewayUrl}/v1/projects/proj_beta1/events`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(((await pull.json()) as { events: unknown[] }).events).toHaveLength(1);

    // 5. ...but NOT another project.
    const forbidden = await fetch(`${gatewayUrl}/v1/projects/proj_other/events`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(forbidden.status).toBe(403);
  });
});
