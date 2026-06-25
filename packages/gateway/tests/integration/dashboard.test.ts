import { request as httpRequest, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { GatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { createGatewayServer } from '../../src/server.js';
import { operatorCookie } from '../../src/session.js';
import { createAccessRequest, listAccessRequests } from '../../src/store.js';

const SECRET = 'dashboard-secret';
const OPERATOR = 'operator-login';

function adminConfig(dbFile: string, overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 0,
    dbFile,
    relayUrl: 'http://127.0.0.1:1', // unused by /admin routes
    relayToken: undefined,
    publicUrl: 'https://hub.example.com',
    githubClientId: 'cid',
    githubClientSecret: 'csec',
    adminLogins: [OPERATOR],
    sessionSecret: SECRET,
    ...overrides,
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  );
}
function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Raw request that does NOT follow redirects (so we can assert 302 + Location). */
function req(
  base: string,
  path: string,
  opts: { method?: string; cookie?: string; form?: Record<string, string> } = {},
): Promise<Res> {
  const url = new URL(path, base);
  const body = opts.form ? new URLSearchParams(opts.form).toString() : undefined;
  return new Promise((resolve, reject) => {
    const r = httpRequest(
      url,
      {
        method: opts.method ?? 'GET',
        headers: {
          ...(opts.cookie ? { cookie: opts.cookie } : {}),
          ...(body
            ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) }
            : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
      },
    );
    r.once('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

describe('operator dashboard', () => {
  let dir: string;
  let db: BetterSqlite3.Database;
  let server: Server;
  let base: string;
  let cookie: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hub-gw-dash-'));
    db = openGatewayDb(join(dir, 'gateway.db'));
    server = createGatewayServer({ db, config: adminConfig(join(dir, 'gateway.db')) });
    base = `http://127.0.0.1:${await listen(server)}`;
    cookie = operatorCookie(OPERATOR, SECRET).split(';')[0]!;
  });

  afterAll(async () => {
    await close(server);
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('returns 503 when the dashboard is not configured', async () => {
    const disabled = createGatewayServer({
      db,
      config: adminConfig(join(dir, 'gateway.db'), { githubClientId: undefined }),
    });
    const port = await listen(disabled);
    try {
      const res = await req(`http://127.0.0.1:${port}`, '/admin');
      expect(res.status).toBe(503);
    } finally {
      await close(disabled);
    }
  });

  it('shows the GitHub sign-in page when unauthenticated', async () => {
    const res = await req(base, '/admin');
    expect(res.status).toBe(200);
    expect(res.body).toContain('Sign in with GitHub');
  });

  it('/admin/login redirects to GitHub with a state cookie', async () => {
    const res = await req(base, '/admin/login');
    expect(res.status).toBe(302);
    expect(String(res.headers.location)).toContain('github.com/login/oauth/authorize');
    expect(String(res.headers['set-cookie'])).toContain('hub_oauth_state=');
  });

  it('rejects a callback with a bad state (CSRF guard)', async () => {
    const res = await req(base, '/admin/callback?code=x&state=forged');
    expect(res.status).toBe(403);
  });

  it('lists pending requests for an authenticated operator', async () => {
    createAccessRequest(db, 'beta@example.com', 'proj_dash1', 'two laptops');
    const res = await req(base, '/admin', { cookie });
    expect(res.status).toBe(200);
    expect(res.body).toContain('proj_dash1');
    expect(res.body).toContain('beta@example.com');
  });

  it('approves via the dashboard and shows the one-time key', async () => {
    const id = createAccessRequest(db, 'two@example.com', 'proj_dash2');
    const res = await req(base, '/admin/approve', { method: 'POST', cookie, form: { requestId: id } });
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/mzk_[\w-]+/);
    expect(listAccessRequests(db, 'pending').some((r) => r.id === id)).toBe(false);
    expect(listAccessRequests(db, 'approved').some((r) => r.id === id)).toBe(true);
  });

  it('ignores approve without an operator session', async () => {
    const id = createAccessRequest(db, 'evil@example.com', 'proj_dash3');
    const res = await req(base, '/admin/approve', { method: 'POST', form: { requestId: id } });
    expect(res.status).toBe(302);
    expect(listAccessRequests(db, 'pending').some((r) => r.id === id)).toBe(true);
  });
});
