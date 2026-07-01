import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { loadGatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { issueApiKey } from '../../src/keys.js';
import { createGatewayServer } from '../../src/server.js';
import { addMember } from '../../src/stores.js';

/**
 * S3 slice: workspace create / discovery / roster over the API-key audience, plus
 * the control-plane existence-leak + membership rules (workspace.md, README §5).
 */

const db = openGatewayDb(':memory:');
const config = loadGatewayConfig({});
const server = createGatewayServer({ db, config });
let base = '';

const alice = upsertAccountByEmail(db, 'alice@ws.example');
const bob = upsertAccountByEmail(db, 'bob@ws.example');
db.prepare('UPDATE accounts SET github_login=? WHERE id=?').run('alice', alice);
const aliceKey = issueApiKey(db, alice, 'alice').plaintext;
const aliceReadOnly = issueApiKey(db, alice, 'alice-ro', { readOnly: true }).plaintext;
const bobKey = issueApiKey(db, bob, 'bob').plaintext;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  db.close();
});

function auth(key: string) {
  return { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

describe('workspace create + discovery', () => {
  let wsId = '';

  it('401s create without a principal', async () => {
    const res = await fetch(`${base}/v1/workspaces`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('403s create with a read-only key', async () => {
    const res = await fetch(`${base}/v1/workspaces`, {
      method: 'POST',
      headers: auth(aliceReadOnly),
      body: JSON.stringify({ name: 'nope' }),
    });
    expect(res.status).toBe(403);
  });

  it('creates a private workspace (owner, invite_reachable=false)', async () => {
    const res = await fetch(`${base}/v1/workspaces`, {
      method: 'POST',
      headers: auth(aliceKey),
      body: JSON.stringify({ name: 'team-notes' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { workspaceId: string; role: string; inviteReachable: boolean; eventsUrl: string };
    expect(body.workspaceId.startsWith('wsp_')).toBe(true);
    expect(body.role).toBe('owner');
    expect(body.inviteReachable).toBe(false);
    expect(body.eventsUrl).toBe(`/v1/projects/${body.workspaceId}/events`);
    wsId = body.workspaceId;
  });

  it('400s an over-long name', async () => {
    const res = await fetch(`${base}/v1/workspaces`, {
      method: 'POST',
      headers: auth(aliceKey),
      body: JSON.stringify({ name: 'x'.repeat(201) }),
    });
    expect(res.status).toBe(400);
  });

  it('lists the workspace under the owner account', async () => {
    const res = await fetch(`${base}/v1/account/workspaces`, { headers: auth(aliceKey) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspaces: Array<{ workspaceId: string; role: string; memberCount: number }> };
    const mine = body.workspaces.find((w) => w.workspaceId === wsId);
    expect(mine).toBeTruthy();
    expect(mine?.role).toBe('owner');
    expect(mine?.memberCount).toBe(1);
  });

  it("does not list the workspace under a non-member", async () => {
    const res = await fetch(`${base}/v1/account/workspaces`, { headers: auth(bobKey) });
    const body = (await res.json()) as { workspaces: Array<{ workspaceId: string }> };
    expect(body.workspaces.find((w) => w.workspaceId === wsId)).toBeFalsy();
  });

  it('serves the roster to a member', async () => {
    const res = await fetch(`${base}/v1/workspaces/${wsId}`, { headers: auth(aliceKey) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: Array<{ accountId: string; role: string; githubLogin: string | null }> };
    expect(body.members).toHaveLength(1);
    expect(body.members[0]?.role).toBe('owner');
    expect(body.members[0]?.githubLogin).toBe('alice');
  });

  it('404s the roster for a non-member (existence-leak policy)', async () => {
    const res = await fetch(`${base}/v1/workspaces/${wsId}`, { headers: auth(bobKey) });
    expect(res.status).toBe(404);
  });

  it('404s an unknown workspace id the same as a non-member', async () => {
    const res = await fetch(`${base}/v1/workspaces/wsp_doesnotexist`, { headers: auth(aliceKey) });
    expect(res.status).toBe(404);
  });

  it('reflects a second member in memberCount + roster', async () => {
    addMember(db, wsId, bob, 'member');
    const res = await fetch(`${base}/v1/workspaces/${wsId}`, { headers: auth(bobKey) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: unknown[] };
    expect(body.members).toHaveLength(2);
  });
});
