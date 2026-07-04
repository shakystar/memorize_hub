import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { loadGatewayConfig, type GatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { issueApiKey } from '../../src/keys.js';
import { createGatewayServer } from '../../src/server.js';
import { registerSourceStore } from '../../src/source-stores.js';
import { createStore } from '../../src/stores.js';

const db = openGatewayDb(':memory:');
const alice = upsertAccountByEmail(db, 'alice@timeline.example');
const bob = upsertAccountByEmail(db, 'bob@timeline.example');
const { storeId } = createStore(db, alice, 'timeline');
const aliceKey = issueApiKey(db, alice, 'alice').plaintext;
const bobKey = issueApiKey(db, bob, 'bob').plaintext;
// Alice's laptop declared its local store — how client-synced events (whose raw
// member/writer is an agent actor, not an identity) resolve to her bubbles.
registerSourceStore(db, storeId, 'proj_alice_laptop', alice, 'memorize-hub');

let base = '';
let replicaUrl = '';
let gateway: Server;
let replica: Server;
const replicaRequests: string[] = [];

beforeAll(async () => {
  replica = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://replica.test');
    replicaRequests.push(url.toString());
    if (url.pathname === `/v1/workspaces/${storeId}/tasks`) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        storeId: 'proj_hub_timeline',
        pulled: { total: 1, inserted: 1 },
        items: [
          {
            id: 'task_live',
            at: '2026-07-03T02:00:00.000Z',
            member: 'codex',
            writer: 'codex',
            sourceProjectId: 'proj_alice_laptop',
            sourceProjectLabel: 'proj_alice_laptop',
            title: 'wire the tasks tab',
            status: 'handoff_ready',
            priority: 'high',
            ownerType: 'agent',
            handoff: { summary: 'replica done', nextAction: 'ship the gateway route' },
          },
        ],
      }));
      return;
    }
    if (url.pathname !== `/v1/workspaces/${storeId}/timeline`) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      storeId: 'proj_hub_timeline',
      pulled: { total: 2, inserted: 2 },
      items: [
        {
          id: 'mem_live',
          at: '2026-07-03T00:00:00.000Z',
          type: 'memory.consolidated',
          kind: 'decision',
          text: 'live timeline reaches the web',
          salience: 8,
          member: alice,
          writer: alice,
          sourceProjectId: 'proj_hub_timeline',
          sourceProjectLabel: 'proj_hub_timeline',
        },
        {
          // A client-synced event: raw member/writer is the AGENT actor, and
          // only the registered source store ties it to Alice's account.
          id: 'mem_cli',
          at: '2026-07-03T01:00:00.000Z',
          type: 'memory.consolidated',
          kind: 'progress',
          text: 'synced from the laptop CLI',
          salience: 5,
          member: 'codex',
          writer: 'codex',
          sourceProjectId: 'proj_alice_laptop',
          sourceProjectLabel: 'proj_alice_laptop',
        },
        {
          // Unregistered legacy provenance: passes through unlabeled.
          id: 'mem_legacy',
          at: '2026-07-03T02:00:00.000Z',
          type: 'memory.consolidated',
          kind: 'progress',
          text: 'pre-registration event',
          salience: 4,
          member: 'system',
          writer: 'system',
          sourceProjectId: 'proj_unregistered',
          sourceProjectLabel: 'proj_unregistered',
        },
      ],
      hasMore: true,
      nextCursor: 'CURSOR_ABC',
    }));
  });
  await new Promise<void>((resolve) => replica.listen(0, '127.0.0.1', resolve));
  replicaUrl = `http://127.0.0.1:${(replica.address() as AddressInfo).port}`;

  const config: GatewayConfig = { ...loadGatewayConfig({}), replicaUrl };
  gateway = createGatewayServer({ db, config });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
});

afterAll(() => {
  gateway.close();
  replica.close();
  db.close();
});

function auth(key: string) {
  return { authorization: `Bearer ${key}` };
}

describe('workspace timeline endpoint', () => {
  it('401s without a principal', async () => {
    const res = await fetch(`${base}/v1/workspaces/${storeId}/timeline`);
    expect(res.status).toBe(401);
  });

  it('404s a non-member before reaching the internal replica', async () => {
    const before = replicaRequests.length;
    const res = await fetch(`${base}/v1/workspaces/${storeId}/timeline`, {
      headers: auth(bobKey),
    });
    expect(res.status).toBe(404);
    expect(replicaRequests).toHaveLength(before);
  });

  it('proxies member reads to the replica and labels account ids for the UI', async () => {
    const res = await fetch(`${base}/v1/workspaces/${storeId}/timeline?limit=25`, {
      headers: auth(aliceKey),
    });
    expect(res.status).toBe(200);
    expect(replicaRequests.at(-1)).toContain('limit=25');
    const body = (await res.json()) as {
      items: Array<{
        member: string;
        writer?: string;
        text: string;
        sourceProjectLabel?: string;
      }>;
    };
    expect(body.items[0]).toMatchObject({
      member: 'alice@timeline.example',
      writer: 'alice@timeline.example',
      text: 'live timeline reaches the web',
    });
  });

  it('attributes client-synced items to the account via the source-store registry', async () => {
    const res = await fetch(`${base}/v1/workspaces/${storeId}/timeline`, {
      headers: auth(aliceKey),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ member: string; writer?: string; sourceProjectLabel?: string }>;
    };
    // member = owning account's email; writer stays the agent actor as bubble
    // meta; the registered label humanizes the raw proj_ id.
    expect(body.items[1]).toMatchObject({
      member: 'alice@timeline.example',
      writer: 'codex',
      sourceProjectLabel: 'memorize-hub',
    });
  });

  it('passes unregistered provenance through unlabeled', async () => {
    const res = await fetch(`${base}/v1/workspaces/${storeId}/timeline`, {
      headers: auth(aliceKey),
    });
    const body = (await res.json()) as {
      items: Array<{ member: string; writer?: string; sourceProjectLabel?: string }>;
    };
    expect(body.items[2]).toMatchObject({
      member: 'system',
      writer: 'system',
      sourceProjectLabel: 'proj_unregistered',
    });
  });

  it('forwards the before cursor and preserves hasMore/nextCursor through labeling', async () => {
    const res = await fetch(`${base}/v1/workspaces/${storeId}/timeline?limit=2&before=CURSOR_ABC`, {
      headers: auth(aliceKey),
    });
    expect(res.status).toBe(200);
    expect(replicaRequests.at(-1)).toContain('before=CURSOR_ABC');
    expect(replicaRequests.at(-1)).toContain('limit=2');
    const body = (await res.json()) as { hasMore: boolean; nextCursor?: string };
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe('CURSOR_ABC');
  });
});

describe('workspace tasks endpoint', () => {
  it('401s without a principal and 404s a non-member', async () => {
    expect((await fetch(`${base}/v1/workspaces/${storeId}/tasks`)).status).toBe(401);
    const before = replicaRequests.length;
    const res = await fetch(`${base}/v1/workspaces/${storeId}/tasks`, {
      headers: auth(bobKey),
    });
    expect(res.status).toBe(404);
    expect(replicaRequests).toHaveLength(before);
  });

  it('proxies member reads and applies the same member labeling as the timeline', async () => {
    const res = await fetch(`${base}/v1/workspaces/${storeId}/tasks`, {
      headers: auth(aliceKey),
    });
    expect(res.status).toBe(200);
    expect(replicaRequests.at(-1)).toContain(`/v1/workspaces/${storeId}/tasks`);
    const body = (await res.json()) as {
      items: Array<{
        member: string;
        writer?: string;
        sourceProjectLabel?: string;
        title: string;
        status: string;
        handoff?: { nextAction: string };
      }>;
    };
    expect(body.items[0]).toMatchObject({
      member: 'alice@timeline.example', // via the source-store registry
      writer: 'codex', // agent actor stays card metadata
      sourceProjectLabel: 'memorize-hub',
      title: 'wire the tasks tab',
      status: 'handoff_ready',
      handoff: { nextAction: 'ship the gateway route' },
    });
  });
});
