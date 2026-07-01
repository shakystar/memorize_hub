import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadGatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { createGatewayServer } from '../../src/server.js';

/**
 * Skeleton smoke test: the rebuilt gateway boots, the schema migrates, and the
 * route table dispatches — public routes answer, unknown routes 404, and wired-
 * but-unported routes return 501. Real per-endpoint behaviour lands with each
 * handler port.
 */

const db = openGatewayDb(':memory:');
const config = loadGatewayConfig({});
const server = createGatewayServer({ db, config });
let base = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
  db.close();
});

describe('gateway skeleton', () => {
  it('migrates the H040 schema on open', () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of ['accounts', 'api_tokens', 'stores', 'memberships', 'invites', 'personal_stores']) {
      expect(tables).toContain(t);
    }
    // Retired by H080 — must NOT exist in the rebuilt schema.
    expect(tables).not.toContain('project_acl');
    expect(tables).not.toContain('access_requests');
  });

  it('answers /healthz with 200', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('404s an unknown route', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });

  it('501s a wired-but-unported control-plane route', async () => {
    // Invite/join + member lifecycle land in S4; still a skeleton placeholder.
    const res = await fetch(`${base}/v1/workspaces/join`, { method: 'POST' });
    expect(res.status).toBe(501);
  });

  it('routes the events data-plane path to the proxy (401 without a key)', async () => {
    const res = await fetch(`${base}/v1/projects/wsp_abc/events`);
    expect(res.status).toBe(401);
  });
});
