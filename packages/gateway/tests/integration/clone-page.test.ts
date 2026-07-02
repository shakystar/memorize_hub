import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { loadGatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { createGatewayServer } from '../../src/server.js';
import { accountCookie } from '../../src/session.js';
import { createStore } from '../../src/stores.js';

/**
 * /clone/:storeId share landing: a pure guidance page for a share URL pasted
 * into a browser (the CLI parses the same URL itself). Signed-out -> account
 * login, returning here via `hub_return`; member -> the onboarding command
 * block with the real store id; non-member/unknown -> 404 (no existence leak).
 */

const config = loadGatewayConfig({
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'csec',
  GATEWAY_PUBLIC_URL: 'https://hub.example',
  GATEWAY_SESSION_SECRET: 'test-secret',
});
const db = openGatewayDb(':memory:');
const server = createGatewayServer({ db, config });
let base = '';

const owner = upsertAccountByEmail(db, 'owner@e.com');
const stranger = upsertAccountByEmail(db, 'stranger@e.com');
const { storeId } = createStore(db, owner, 'demo');

const secret = config.sessionSecret!;
const cookieFor = (accountId: string, email: string): string =>
  accountCookie({ accountId, email }, secret).split(';')[0]!;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  db.close();
});

describe('share landing (/clone/:storeId)', () => {
  it('sends a signed-out visitor through account login, returning here', async () => {
    const res = await fetch(`${base}/clone/${storeId}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/account/login');
    expect(res.headers.get('set-cookie')).toContain(
      `hub_return=${encodeURIComponent(`/clone/${storeId}`)}`,
    );
  });

  it('renders the onboarding commands for a member', async () => {
    const res = await fetch(`${base}/clone/${storeId}`, {
      headers: { cookie: cookieFor(owner, 'owner@e.com') },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('npm i -g @shakystar/memorize');
    expect(html).toContain('memorize login https://hub.example');
    expect(html).toContain(`memorize clone https://hub.example/clone/${storeId}`);
    expect(html).toContain(`memorize remote https://hub.example/clone/${storeId}`);
    expect(html).toContain('demo'); // the workspace name headlines the page
  });

  it('404s a signed-in non-member (no existence leak)', async () => {
    const res = await fetch(`${base}/clone/${storeId}`, {
      headers: { cookie: cookieFor(stranger, 'stranger@e.com') },
    });
    expect(res.status).toBe(404);
  });

  it('404s an unknown store id', async () => {
    const res = await fetch(`${base}/clone/wsp_does-not-exist`, {
      headers: { cookie: cookieFor(owner, 'owner@e.com') },
    });
    expect(res.status).toBe(404);
  });
});
