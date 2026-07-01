import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { loadGatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { issueApiKey } from '../../src/keys.js';
import { createGatewayServer } from '../../src/server.js';
import { createStore } from '../../src/stores.js';

/**
 * S4 slice: invite mint/list/revoke, join redemption, member lifecycle, and
 * workspace delete over the API-key audience (workspace.md).
 */

const db = openGatewayDb(':memory:');
const config = loadGatewayConfig({ GATEWAY_PUBLIC_URL: 'https://hub.test' });
const server = createGatewayServer({ db, config });
let base = '';

const alice = upsertAccountByEmail(db, 'alice@inv.example');
const bob = upsertAccountByEmail(db, 'bob@inv.example');
const carol = upsertAccountByEmail(db, 'carol@inv.example');
const dave = upsertAccountByEmail(db, 'dave@inv.example');
const aliceKey = issueApiKey(db, alice, 'a').plaintext;
const bobKey = issueApiKey(db, bob, 'b').plaintext;
const carolKey = issueApiKey(db, carol, 'c').plaintext;
const daveKey = issueApiKey(db, dave, 'd').plaintext;
const ws = createStore(db, alice, 'team').storeId;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  db.close();
});

function h(key: string) {
  return { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}
const post = (path: string, key: string, body?: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: h(key), body: body ? JSON.stringify(body) : undefined });
const del = (path: string, key: string) => fetch(`${base}${path}`, { method: 'DELETE', headers: h(key) });
const patch = (path: string, key: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'PATCH', headers: h(key), body: JSON.stringify(body) });

describe('invite + join + lifecycle', () => {
  it('owner mints an invite; the store flips to shared and joinUrl is absolute', async () => {
    const res = await post(`/v1/workspaces/${ws}/invites`, aliceKey, {});
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; joinUrl: string; role: string };
    expect(body.role).toBe('member');
    expect(body.joinUrl).toBe(`https://hub.test/join?token=${encodeURIComponent(body.token)}`);

    const list = (await (await fetch(`${base}/v1/account/workspaces`, { headers: h(aliceKey) })).json()) as {
      workspaces: Array<{ workspaceId: string; inviteReachable: boolean }>;
    };
    expect(list.workspaces.find((w) => w.workspaceId === ws)?.inviteReachable).toBe(true);
  });

  it('non-member mint -> 404, and a bad token join -> 403', async () => {
    expect((await post(`/v1/workspaces/${ws}/invites`, carolKey, {})).status).toBe(404);
    expect((await post(`/v1/workspaces/join`, bobKey, { token: 'nope' })).status).toBe(403);
  });

  it('bob joins via a fresh invite (idempotent on repeat)', async () => {
    const minted = (await (await post(`/v1/workspaces/${ws}/invites`, aliceKey, {})).json()) as { token: string };
    const first = await post(`/v1/workspaces/join`, bobKey, { token: minted.token });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { workspaceId: string }).workspaceId).toBe(ws);
    // repeat does not error and does not consume a use
    expect((await post(`/v1/workspaces/join`, bobKey, { token: minted.token })).status).toBe(200);
  });

  it('member (non-owner) cannot mint or list; roster shows 2 members', async () => {
    expect((await post(`/v1/workspaces/${ws}/invites`, bobKey, {})).status).toBe(403);
    expect((await fetch(`${base}/v1/workspaces/${ws}/invites`, { headers: h(bobKey) })).status).toBe(403);
    const roster = (await (await fetch(`${base}/v1/workspaces/${ws}`, { headers: h(aliceKey) })).json()) as {
      members: unknown[];
    };
    expect(roster.members).toHaveLength(2);
  });

  it('enforces maxUses', async () => {
    const minted = (await (await post(`/v1/workspaces/${ws}/invites`, aliceKey, { maxUses: 1 })).json()) as { token: string };
    expect((await post(`/v1/workspaces/join`, carolKey, { token: minted.token })).status).toBe(200);
    expect((await post(`/v1/workspaces/join`, daveKey, { token: minted.token })).status).toBe(403);
  });

  it('rejects a non-positive maxUses and a past expiresAt', async () => {
    expect((await post(`/v1/workspaces/${ws}/invites`, aliceKey, { maxUses: 0 })).status).toBe(400);
    expect((await post(`/v1/workspaces/${ws}/invites`, aliceKey, { expiresAt: '2000-01-01T00:00:00Z' })).status).toBe(400);
  });

  it('lists + revokes invites (idempotent), and a revoked token cannot join', async () => {
    const minted = (await (await post(`/v1/workspaces/${ws}/invites`, aliceKey, {})).json()) as {
      inviteId: string;
      token: string;
    };
    const list = (await (await fetch(`${base}/v1/workspaces/${ws}/invites`, { headers: h(aliceKey) })).json()) as {
      invites: Array<{ inviteId: string }>;
    };
    expect(list.invites.some((i) => i.inviteId === minted.inviteId)).toBe(true);

    expect((await del(`/v1/workspaces/${ws}/invites/${minted.inviteId}`, aliceKey)).status).toBe(204);
    expect((await del(`/v1/workspaces/${ws}/invites/${minted.inviteId}`, aliceKey)).status).toBe(204); // idempotent
    expect((await del(`/v1/workspaces/${ws}/invites/inv_unknown`, aliceKey)).status).toBe(404);
    expect((await post(`/v1/workspaces/join`, daveKey, { token: minted.token })).status).toBe(403);
  });

  it('self-leave works; a non-owner cannot remove another member', async () => {
    // carol is a member (joined above); she leaves.
    expect((await del(`/v1/workspaces/${ws}/members/${carol}`, carolKey)).status).toBe(204);
    // bob (member, not owner) cannot remove alice.
    expect((await del(`/v1/workspaces/${ws}/members/${alice}`, bobKey)).status).toBe(403);
  });

  it('blocks the last owner from leaving while members remain (409)', async () => {
    expect((await del(`/v1/workspaces/${ws}/members/${alice}`, aliceKey)).status).toBe(409);
  });

  it('transfers ownership via role change, then the old owner can leave', async () => {
    expect((await patch(`/v1/workspaces/${ws}/members/${bob}`, aliceKey, { role: 'owner' })).status).toBe(200);
    // alice is no longer the sole owner, so she may now leave.
    expect((await del(`/v1/workspaces/${ws}/members/${alice}`, aliceKey)).status).toBe(204);
  });

  it('owner deletes the workspace', async () => {
    expect((await del(`/v1/workspaces/${ws}`, bobKey)).status).toBe(204);
    const list = (await (await fetch(`${base}/v1/account/workspaces`, { headers: h(bobKey) })).json()) as {
      workspaces: unknown[];
    };
    expect(list.workspaces).toHaveLength(0);
  });
});
