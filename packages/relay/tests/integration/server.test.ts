/**
 * HTTP contract tests against PROTOCOL.md v1. Behavioral reference:
 * memorize/tests/harness/relay-stub.ts and the golden round-trip test.
 */
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createRelayServer, type RelayOptions } from '../../src/server.js';
import { EventStore, type RelayStats } from '../../src/store.js';
import type { OpaqueEvent, SyncPullResponse, SyncPushResponse } from '../../src/protocol.js';

interface Relay {
  baseUrl: string;
  dir: string;
  server: Server;
}

const evt = (id: string): OpaqueEvent => ({ id, type: 'observation.captured' });

let cleanups: (() => Promise<void>)[] = [];

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function closeServer(server: Server): Promise<void> {
  server.close();
  server.closeAllConnections();
  await once(server, 'close');
}

async function startRelay(
  options: Omit<RelayOptions, 'store'> & { dir?: string } = {},
): Promise<Relay> {
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), 'hub-relay-')));
  const store = await EventStore.open(dir);
  const server = createRelayServer({ ...options, store });
  const baseUrl = await listen(server);
  cleanups.push(async () => {
    await closeServer(server).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });
  return { baseUrl, dir, server };
}

afterEach(async () => {
  const pending = cleanups;
  cleanups = [];
  await Promise.all(pending.map((cleanup) => cleanup()));
});

async function push(
  baseUrl: string,
  projectId: string,
  events: OpaqueEvent[],
): Promise<SyncPushResponse> {
  const res = await fetch(`${baseUrl}/v1/projects/${projectId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, events }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as SyncPushResponse;
}

async function pull(
  baseUrl: string,
  projectId: string,
  since?: string,
): Promise<SyncPullResponse> {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  const res = await fetch(`${baseUrl}/v1/projects/${projectId}/events${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as SyncPullResponse;
}

describe('relay HTTP contract', () => {
  it('round-trips push -> pull with watermarks', async () => {
    const { baseUrl } = await startRelay();

    const pushed = await push(baseUrl, 'proj_a', [evt('evt_1'), evt('evt_2')]);
    expect(pushed).toEqual({
      accepted: ['evt_1', 'evt_2'],
      rejected: [],
      lastAcceptedEventId: 'evt_2',
    });

    const all = await pull(baseUrl, 'proj_a');
    expect(all.events.map((event) => event.id)).toEqual(['evt_1', 'evt_2']);
    expect(all.lastRemoteEventId).toBe('evt_2');

    const after1 = await pull(baseUrl, 'proj_a', 'evt_1');
    expect(after1.events.map((event) => event.id)).toEqual(['evt_2']);

    const empty = await pull(baseUrl, 'proj_a', 'evt_2');
    expect(empty).toEqual({ events: [] }); // no lastRemoteEventId when empty
  });

  it('reports per-store sizes on GET /v1/stats (internal, opaque)', async () => {
    const { baseUrl } = await startRelay();
    await push(baseUrl, 'proj_a', [evt('evt_1'), evt('evt_2')]);
    await push(baseUrl, 'proj_b', [evt('evt_3')]);

    const res = await fetch(`${baseUrl}/v1/stats`);
    expect(res.status).toBe(200);
    const stats = (await res.json()) as RelayStats;

    expect(stats.totals).toEqual({
      stores: 2,
      events: 3,
      bytes: stats.stores.reduce((sum, s) => sum + s.bytes, 0),
    });
    expect(stats.totals.bytes).toBeGreaterThan(0);

    const byId = Object.fromEntries(stats.stores.map((s) => [s.storeId, s]));
    expect(byId['proj_a']!.events).toBe(2);
    expect(byId['proj_b']!.events).toBe(1);
    // Larger store sorts first and has more bytes on disk.
    expect(byId['proj_a']!.bytes).toBeGreaterThan(byId['proj_b']!.bytes);
    expect(stats.stores[0]!.storeId).toBe('proj_a');
  });

  it('gates GET /v1/stats behind the bearer token', async () => {
    const { baseUrl } = await startRelay({ token: 'secret' });
    expect((await fetch(`${baseUrl}/v1/stats`)).status).toBe(401);
    const ok = await fetch(`${baseUrl}/v1/stats`, { headers: { authorization: 'Bearer secret' } });
    expect(ok.status).toBe(200);
  });

  it('treats an E2E ciphertext payload as fully opaque (byte-faithful round-trip)', async () => {
    const { baseUrl } = await startRelay();
    // A realistic memorize #182 envelope nested as the event payload. The relay
    // must neither parse, validate, transform, nor drop it — it routes on
    // event.id alone (PROTOCOL.md invariant 4 + "Payload encryption" section).
    const encrypted: OpaqueEvent = {
      id: 'evt_enc',
      type: 'memory.consolidated',
      scopeType: 'project',
      actor: 'user',
      payload: {
        __enc: 'A256GCM',
        kid: 'a1b2c3d4e5f60718',
        iv: 'AAAAAAAAAAAAAAAA',
        ct: 'c2VjcmV0LWNpcGhlcnRleHQ',
        tag: 'EQIDBAUGBwgJCgsMDQ4PEA',
      },
    };
    await push(baseUrl, 'proj_enc', [encrypted]);

    const pulled = await pull(baseUrl, 'proj_enc');
    expect(pulled.events).toHaveLength(1);
    // Deep-equal: the ciphertext envelope comes back exactly as sent. Anything
    // less would mean the relay touched a payload it must treat as opaque.
    expect(pulled.events[0]).toEqual(encrypted);
  });

  it('dedups overlapping re-pushes; watermark stays monotonic', async () => {
    const { baseUrl } = await startRelay();
    await push(baseUrl, 'proj_a', [evt('evt_1'), evt('evt_2')]);

    const overlap = await push(baseUrl, 'proj_a', [evt('evt_2'), evt('evt_3')]);
    expect(overlap.accepted).toEqual(['evt_3']);
    expect(overlap.lastAcceptedEventId).toBe('evt_3');

    // All-duplicate push: nothing accepted, no watermark field.
    const dupes = await push(baseUrl, 'proj_a', [evt('evt_1')]);
    expect(dupes).toEqual({ accepted: [], rejected: [] });

    const all = await pull(baseUrl, 'proj_a');
    expect(all.events.map((event) => event.id)).toEqual(['evt_1', 'evt_2', 'evt_3']);
  });

  it('unknown since id returns all events', async () => {
    const { baseUrl } = await startRelay();
    await push(baseUrl, 'proj_a', [evt('evt_1'), evt('evt_2')]);
    const all = await pull(baseUrl, 'proj_a', 'evt_never_stored');
    expect(all.events.map((event) => event.id)).toEqual(['evt_1', 'evt_2']);
  });

  it('pulling an unknown project returns an empty log, not an error', async () => {
    const { baseUrl } = await startRelay();
    expect(await pull(baseUrl, 'proj_never_seen')).toEqual({ events: [] });
  });

  it('serves healthz', async () => {
    const { baseUrl } = await startRelay();
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('survives a restart: events persist across server + store instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hub-relay-'));
    const first = await startRelay({ dir });
    await push(first.baseUrl, 'proj_a', [evt('evt_1'), evt('evt_2')]);
    await closeServer(first.server);

    const second = await startRelay({ dir });
    const all = await pull(second.baseUrl, 'proj_a');
    expect(all.events.map((event) => event.id)).toEqual(['evt_1', 'evt_2']);
    // Dedup index survived too.
    const repush = await push(second.baseUrl, 'proj_a', [evt('evt_2'), evt('evt_3')]);
    expect(repush.accepted).toEqual(['evt_3']);
  });

  describe('auth', () => {
    it('gates every route when a token is configured', async () => {
      const { baseUrl } = await startRelay({ token: 'sekret' });

      for (const path of ['/healthz', '/v1/projects/proj_a/events']) {
        const missing = await fetch(`${baseUrl}${path}`);
        expect(missing.status).toBe(401);
        const wrong = await fetch(`${baseUrl}${path}`, {
          headers: { authorization: 'Bearer nope' },
        });
        expect(wrong.status).toBe(401);
      }

      const ok = await fetch(`${baseUrl}/healthz`, {
        headers: { authorization: 'Bearer sekret' },
      });
      expect(ok.status).toBe(200);
    });

    it('stays open when no token is configured', async () => {
      const { baseUrl } = await startRelay();
      expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
    });
  });

  describe('request validation', () => {
    it('rejects invalid project ids with 400 before touching storage', async () => {
      const { baseUrl } = await startRelay();
      // Encoded traversal decodes to `../evil` and must fail the id pattern.
      // (`%2e%2e` is absent: WHATWG URL clients collapse it as a dot segment
      // before the request is even sent, so it can never reach the server.)
      for (const bad of ['..%2Fevil', 'dot.dot', 'a'.repeat(129), 'sp%20ace']) {
        const res = await fetch(`${baseUrl}/v1/projects/${bad}/events`);
        expect(res.status).toBe(400);
      }
    });

    it('rejects malformed JSON and bad shapes with 400', async () => {
      const { baseUrl } = await startRelay();
      const url = `${baseUrl}/v1/projects/proj_a/events`;
      const cases = ['{not json', '[1,2]', '{"events": "nope"}', '{"events": [{"noId": 1}]}'];
      for (const body of cases) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        });
        expect(res.status).toBe(400);
      }
      // Nothing got stored along the way.
      expect((await pull(baseUrl, 'proj_a')).events).toEqual([]);
    });

    it('rejects oversized bodies with 413', async () => {
      const { baseUrl } = await startRelay({ maxBodyBytes: 1024 });
      const res = await fetch(`${baseUrl}/v1/projects/proj_a/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: [{ id: 'evt_big', blob: 'x'.repeat(4096) }] }),
      });
      expect(res.status).toBe(413);
      expect((await pull(baseUrl, 'proj_a')).events).toEqual([]);
    });

    it('404s unknown routes and methods', async () => {
      const { baseUrl } = await startRelay();
      expect((await fetch(`${baseUrl}/v2/projects/proj_a/events`)).status).toBe(404);
      expect((await fetch(`${baseUrl}/nope`)).status).toBe(404);
      expect(
        (await fetch(`${baseUrl}/v1/projects/proj_a/events`, { method: 'DELETE' })).status,
      ).toBe(404);
      expect((await fetch(`${baseUrl}/healthz`, { method: 'POST' })).status).toBe(404);
    });
  });
});
