import type { Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { GatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { createGatewayServer } from '../../src/server.js';
import { participantCookie } from '../../src/session.js';
import {
  grantProjectAccess,
  issueApiKey,
  listAccessRequests,
  listApiTokens,
  upsertUserByGithub,
} from '../../src/store.js';

const SECRET = 'test-session-secret';

function baseConfig(dir: string, overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 0,
    dbFile: join(dir, 'gateway.db'),
    relayUrl: 'http://127.0.0.1:1',
    relayToken: undefined,
    publicUrl: 'https://hub.example.test',
    githubClientId: 'client-id',
    githubClientSecret: 'client-secret',
    adminLogins: [],
    sessionSecret: SECRET,
    ...overrides,
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}
function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

/** The Cookie-header form of a forged participant session (skips live OAuth). */
function sessionCookie(userId: string, login: string, email: string): string {
  return participantCookie({ userId, login, email }, SECRET).split(';')[0]!;
}

describe('participant self-service: /account', () => {
  let dir: string;
  let gateway: Server;
  let db: BetterSqlite3.Database;
  let base: string;
  let aliceId: string;
  let aliceTokenId: string;
  let bobTokenId: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hub-gw-account-'));
    db = openGatewayDb(join(dir, 'gateway.db'));
    aliceId = upsertUserByGithub(db, 'alice', 'alice@example.com');
    grantProjectAccess(db, aliceId, 'proj_alice');
    aliceTokenId = issueApiKey(db, aliceId, 'alice').tokenId;
    const bobId = upsertUserByGithub(db, 'bob', 'bob@example.com');
    grantProjectAccess(db, bobId, 'proj_bob');
    bobTokenId = issueApiKey(db, bobId, 'bob').tokenId;

    gateway = createGatewayServer({ db, config: baseConfig(dir) });
    base = `http://127.0.0.1:${await listen(gateway)}`;
  });

  afterAll(async () => {
    await close(gateway);
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  const alice = (): string => sessionCookie(aliceId, 'alice', 'alice@example.com');

  it('shows a sign-in view to anonymous visitors (no forms)', async () => {
    const res = await fetch(`${base}/account`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Sign in with GitHub');
    expect(html).toContain('href="/account/login"');
    expect(html).not.toContain('action="/account/requests"');
    expect(html).not.toContain('Generate a new key');
  });

  it('renders the dashboard for a signed-in user with their projects + keys', async () => {
    const res = await fetch(`${base}/account`, { headers: { cookie: alice() } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Signed in as');
    expect(html).toContain('alice@example.com');
    expect(html).toContain('proj_alice');
    expect(html).toContain('Request project access');
    // Has an approved project, so key generation is offered.
    expect(html).toContain('Generate a new key');
    // Never leaks another user's project.
    expect(html).not.toContain('proj_bob');
    // Copy-ready clone command (token placeholder until a key is minted), with
    // the Hub origin injected and a clone-not-init nudge.
    expect(html).toContain('Connect a machine');
    expect(html).toContain(
      'memorize project clone proj_alice --remote-url https://hub.example.test --token YOUR_KEY',
    );
    expect(html).toContain('never <code>init</code>');
  });

  it('redirects unauthenticated POSTs back to /account', async () => {
    const res = await fetch(`${base}/account/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'projectId=proj_x',
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
  });

  it('creates an access request from the session email (no email field)', async () => {
    const res = await fetch(`${base}/account/requests`, {
      method: 'POST',
      headers: { cookie: alice(), 'content-type': 'application/x-www-form-urlencoded' },
      body: 'projectId=proj_new&note=two+laptops',
      redirect: 'manual',
    });
    expect(res.status).toBe(201);
    expect(await res.text()).toContain('pending operator approval');
    const pending = listAccessRequests(db, 'pending');
    const mine = pending.find((r) => r.requested_project_id === 'proj_new');
    expect(mine?.email).toBe('alice@example.com');
  });

  it('rejects an invalid project id', async () => {
    const res = await fetch(`${base}/account/requests`, {
      method: 'POST',
      headers: { cookie: alice(), 'content-type': 'application/x-www-form-urlencoded' },
      body: 'projectId=bad%20id',
      redirect: 'manual',
    });
    expect(res.status).toBe(400);
  });

  it('mints a key for the signed-in user, shown once', async () => {
    const before = listApiTokens(db, aliceId).length;
    const res = await fetch(`${base}/account/keys`, {
      method: 'POST',
      headers: { cookie: alice() },
      redirect: 'manual',
    });
    expect(res.status).toBe(201);
    const html = await res.text();
    expect(html).toContain('shown only once');
    expect(html).toContain('mzk_');
    // The shown-once box embeds a ready-to-paste clone command with the real key.
    expect(html).toMatch(
      /memorize project clone proj_alice --remote-url https:\/\/hub\.example\.test --token mzk_/,
    );
    expect(listApiTokens(db, aliceId).length).toBe(before + 1);
  });

  it("refuses to revoke another user's key, but revokes the owner's own", async () => {
    // Alice cannot revoke Bob's token.
    const denied = await fetch(`${base}/account/keys/${bobTokenId}/revoke`, {
      method: 'POST',
      headers: { cookie: alice() },
      redirect: 'manual',
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain('not yours');
    expect(listApiTokens(db, aliceId).find((t) => t.id === aliceTokenId)?.revoked_at).toBeNull();

    // Alice can revoke her own.
    const ok = await fetch(`${base}/account/keys/${aliceTokenId}/revoke`, {
      method: 'POST',
      headers: { cookie: alice() },
      redirect: 'manual',
    });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('Key revoked');
    expect(
      listApiTokens(db, aliceId).find((t) => t.id === aliceTokenId)?.revoked_at,
    ).not.toBeNull();
  });
});

describe('/account when OAuth is not configured', () => {
  let dir: string;
  let gateway: Server;
  let db: BetterSqlite3.Database;
  let base: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hub-gw-account-off-'));
    db = openGatewayDb(join(dir, 'gateway.db'));
    gateway = createGatewayServer({
      db,
      config: baseConfig(dir, { githubClientId: undefined }),
    });
    base = `http://127.0.0.1:${await listen(gateway)}`;
  });

  afterAll(async () => {
    await close(gateway);
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('returns 503', async () => {
    const res = await fetch(`${base}/account`);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('Accounts not configured');
  });
});
