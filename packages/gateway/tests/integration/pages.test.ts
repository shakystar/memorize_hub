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

const PUBLIC_URL = 'https://hub.example.test';

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

describe('public pages: landing + docs + beta', () => {
  let dir: string;
  let gateway: Server;
  let db: BetterSqlite3.Database;
  let base: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hub-gw-pages-'));
    db = openGatewayDb(join(dir, 'gateway.db'));
    const config: GatewayConfig = {
      port: 0,
      dbFile: join(dir, 'gateway.db'),
      relayUrl: 'http://127.0.0.1:1', // never called by these routes
      relayToken: undefined,
      publicUrl: PUBLIC_URL,
      githubClientId: undefined,
      githubClientSecret: undefined,
      adminLogins: [],
      sessionSecret: undefined,
    };
    gateway = createGatewayServer({ db, config });
    base = `http://127.0.0.1:${await listen(gateway)}`;
  });

  afterAll(async () => {
    await close(gateway);
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('serves a landing page at / (not the form), linking to beta + docs', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('Cross-machine sync');
    expect(html).toContain('href="/beta"');
    expect(html).toContain('href="/docs"');
    // The landing page is not the request form itself.
    expect(html).not.toContain('<form');
  });

  it('keeps the beta request form at /beta', async () => {
    const res = await fetch(`${base}/beta`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Request beta access');
    expect(html).toContain('<form method="POST" action="/beta/requests"');
  });

  it('serves the connect docs with the real Hub URL injected', async () => {
    const res = await fetch(`${base}/docs`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('project clone');
    expect(html).toContain('--remote-url');
    expect(html).toContain('--token');
    // config.publicUrl is injected into the example commands.
    expect(html).toContain(PUBLIC_URL);
  });

  it('resolves a docs page by slug', async () => {
    const res = await fetch(`${base}/docs/connect`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Connect a memorize client');
  });

  it('returns 404 for an unknown docs slug', async () => {
    const res = await fetch(`${base}/docs/nope`);
    expect(res.status).toBe(404);
  });
});
