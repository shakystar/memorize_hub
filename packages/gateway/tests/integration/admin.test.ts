import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { loadGatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { createGatewayServer } from '../../src/server.js';
import { accountCookie } from '../../src/session.js';
import { createStore } from '../../src/stores.js';

/**
 * /admin gate: the operator dashboard reuses the ACCOUNT session and gates on the
 * admin allowlist — no separate operator login. Signed-out -> account login;
 * signed-in non-operator -> 404 (no existence leak); operator -> read-only
 * Overview. (The relay isn't running here, so the storage block degrades to
 * "unreachable" — the page still renders.)
 */

const config = loadGatewayConfig({
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'csec',
  GATEWAY_PUBLIC_URL: 'https://hub.example',
  GATEWAY_SESSION_SECRET: 'test-secret',
  GATEWAY_ADMIN_EMAILS: 'operator@e.com',
});
const db = openGatewayDb(':memory:');
const server = createGatewayServer({ db, config });
let base = '';

// A little control-plane data so the Overview has real rows to render.
const acc = upsertAccountByEmail(db, 'operator@e.com');
createStore(db, acc, 'demo');

const secret = config.sessionSecret!;
const cookieFor = (email: string): string =>
  accountCookie({ accountId: acc, email }, secret).split(';')[0]!;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  db.close();
});

describe('operator dashboard gate (/admin)', () => {
  it('redirects a signed-out visitor to account login', async () => {
    const res = await fetch(`${base}/admin`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/account/login');
  });

  it('404s a signed-in non-operator (no existence leak)', async () => {
    const res = await fetch(`${base}/admin`, { headers: { cookie: cookieFor('stranger@e.com') } });
    expect(res.status).toBe(404);
  });

  it('renders the read-only Overview for an allowlisted operator', async () => {
    const res = await fetch(`${base}/admin`, { headers: { cookie: cookieFor('operator@e.com') } });
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const section of ['Operator', 'Control plane', 'Traffic', 'Storage at rest']) {
      expect(html).toContain(section);
    }
  });
});
