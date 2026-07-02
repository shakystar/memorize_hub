import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { loadGatewayConfig, type GatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { issueApiKey } from '../../src/keys.js';
import { createGatewayServer } from '../../src/server.js';
import { createStore } from '../../src/stores.js';

const db = openGatewayDb(':memory:');
const alice = upsertAccountByEmail(db, 'alice@timeline.example');
const bob = upsertAccountByEmail(db, 'bob@timeline.example');
const { storeId } = createStore(db, alice, 'timeline');
const aliceKey = issueApiKey(db, alice, 'alice').plaintext;
const bobKey = issueApiKey(db, bob, 'bob').plaintext;

let base = '';
let replicaUrl = '';
let gateway: Server;
let replica: Server;
const replicaRequests: string[] = [];

beforeAll(async () => {
  replica = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://replica.test');
    replicaRequests.push(url.toString());
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
      ],
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
      items: Array<{ member: string; writer?: string; text: string }>;
    };
    expect(body.items[0]).toMatchObject({
      member: 'alice@timeline.example',
      writer: 'alice@timeline.example',
      text: 'live timeline reaches the web',
    });
  });
});
