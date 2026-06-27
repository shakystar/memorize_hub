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

  it('serves overview as the default /docs page', async () => {
    const res = await fetch(`${base}/docs`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('What is memorize');
    expect(html).toContain('How it works');
    expect(html).toContain('href="/docs/getting-started"');
  });

  it('serves getting-started by slug with the install steps', async () => {
    const res = await fetch(`${base}/docs/getting-started`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('project setup');
    expect(html).toContain('install claude');
  });

  it('serves the connect page by slug with the real Hub URL injected', async () => {
    const res = await fetch(`${base}/docs/connect`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Connect a memorize client');
    expect(html).toContain('project clone');
    expect(html).toContain('--remote-url');
    expect(html).toContain('--token');
    // config.publicUrl is injected into the example commands.
    expect(html).toContain(PUBLIC_URL);
  });

  it('serves the consolidation page by slug', async () => {
    const res = await fetch(`${base}/docs/consolidation`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('MEMORIZE_LLM_BACKEND');
  });

  it('serves the troubleshooting page by slug', async () => {
    const res = await fetch(`${base}/docs/troubleshooting`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('doctor');
  });

  it('renders docs in a sidebar layout', async () => {
    const res = await fetch(`${base}/docs`);
    const html = await res.text();
    expect(html).toContain('class="docs-side"');
    expect(html).toContain('class="docs-wrap"');
  });

  it('serves the event-sourcing internals page', async () => {
    const res = await fetch(`${base}/docs/event-sourcing`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Event sourcing core');
    expect(html).toContain('INSERT OR IGNORE');
    expect(html).toContain('src/storage/event-store.ts');
  });

  it('serves the sync-convergence internals page', async () => {
    const res = await fetch(`${base}/docs/sync-convergence`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Sync and convergence');
    expect(html).toContain('lastPulledEventId');
    expect(html).toContain('sync.state.updated');
  });

  it('serves the projection-rebuild internals page', async () => {
    const res = await fetch(`${base}/docs/projection-rebuild`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Projection and rebuild');
    expect(html).toContain('rebuildProjectProjection');
  });

  it('serves the memory-retrieval internals page', async () => {
    const res = await fetch(`${base}/docs/memory-retrieval`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Memory model and retrieval');
    expect(html).toContain('retrieveMemoryContext');
  });

  it('groups the sidebar into sections', async () => {
    const html = await (await fetch(`${base}/docs`)).text();
    expect(html).toContain('>Guides<');
    expect(html).toContain('>Internals<');
  });

  it('returns 404 for an unknown docs slug', async () => {
    const res = await fetch(`${base}/docs/nope`);
    expect(res.status).toBe(404);
  });
});
