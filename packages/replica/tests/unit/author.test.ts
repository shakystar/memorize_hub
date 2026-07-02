import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeAll } from '@shakystar/memorize/dist/storage/db.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authorMemory, serverStoreId } from '../../src/author.js';

/**
 * H060 S1 core: author-as-the-calling-user. The Hub side is faked at the fetch
 * seam (whoami + events route); the memorize engine underneath is real: events
 * land in a real server-side store under a sandboxed MEMORIZE_ROOT.
 */

const WSP = 'wsp_s1_author_test';
const ACC = 'acc_alice_test';

let sandbox: string;

interface PushedRequest {
  url: string;
  events: Array<Record<string, unknown>>;
}

/** Fake gateway: whoami echoes ACC; events route accepts everything. */
function fakeHub(pushes: PushedRequest[], opts: { readOnly?: boolean } = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/v1/account')) {
      return new Response(
        JSON.stringify({ accountId: ACC, email: 'alice@s1.test', readOnly: opts.readOnly ?? false }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('/events')) {
      const body = JSON.parse(String(init?.body)) as { events: Array<Record<string, unknown>> };
      pushes.push({ url, events: body.events });
      const ids = body.events.map((e) => e.id as string);
      return new Response(
        JSON.stringify({ accepted: ids, rejected: [], lastAcceptedEventId: ids[ids.length - 1] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

function author(pushes: PushedRequest[], text: string, fetchImpl?: typeof fetch) {
  return authorMemory({
    hubUrl: 'http://hub.fake',
    apiKey: 'mzk_fake',
    workspaceId: WSP,
    item: { kind: 'decision', text, salience: 7 },
    fetchImpl: fetchImpl ?? fakeHub(pushes),
  });
}

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hub-replica-'));
  process.env.MEMORIZE_ROOT = sandbox;
});

afterEach(async () => {
  // The embedded engine caches db connections by projectId; tests share a
  // store id across sandboxes, so drop the cache with the sandbox.
  closeAll();
  delete process.env.MEMORIZE_ROOT;
  await rm(sandbox, { recursive: true, force: true }).catch(() => {});
});

describe('serverStoreId', () => {
  it('derives a stable per-workspace lane id', () => {
    expect(serverStoreId('wsp_abc123')).toBe('proj_hub_abc123');
    expect(serverStoreId('wsp_abc123')).toBe(serverStoreId('wsp_abc123'));
  });

  it('hex-encodes mixed-case workspace ids into memorize-valid lane ids', () => {
    const storeId = serverStoreId('wsp_Nbl2mFZB3q40');
    expect(storeId).toMatch(/^proj_hub_[a-f0-9]+$/);
    expect(storeId).toBe(serverStoreId('wsp_Nbl2mFZB3q40'));
    expect(storeId).not.toBe(serverStoreId('wsp_nbl2mfzb3q40'));
  });

  it('rejects non-wsp ids', () => {
    expect(() => serverStoreId('proj_local')).toThrow(/wsp_/);
  });
});

describe('authorMemory', () => {
  it('authors as the calling user and pushes to the workspace events route', async () => {
    const pushes: PushedRequest[] = [];
    const result = await author(pushes, 'ship it');

    expect(result.accountId).toBe(ACC);
    expect(result.storeId).toBe(serverStoreId(WSP));
    // First touch: genesis + memory ride one push to the wsp_ route.
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.url).toContain(`/v1/projects/${WSP}/events`);
    const types = pushes[0]!.events.map((e) => e.type);
    expect(types).toEqual(['project.created', 'memory.consolidated']);
    expect(result.accepted).toBe(2);

    // Provenance: writer = the calling account, actor = human.
    for (const event of pushes[0]!.events) {
      expect(event.writer).toBe(ACC);
      expect(event.actor).toBe('user');
    }
    const memory = pushes[0]!.events[1]!;
    expect((memory.payload as Record<string, unknown>).text).toBe('ship it');
    expect((memory.payload as Record<string, unknown>).salience).toBe(7);
  });

  it('reuses the lane on later writes: no second genesis, watermarked push', async () => {
    const pushes: PushedRequest[] = [];
    await author(pushes, 'first');
    const second = await author(pushes, 'second');

    expect(pushes).toHaveLength(2);
    // Only the new memory crosses the wire; the lane and its genesis persist.
    expect(pushes[1]!.events.map((e) => e.type)).toEqual(['memory.consolidated']);
    expect(second.accepted).toBe(1);
    expect(second.storeId).toBe(serverStoreId(WSP));
  });

  it('rejects read-only keys before touching the store', async () => {
    const pushes: PushedRequest[] = [];
    await expect(
      author(pushes, 'nope', fakeHub(pushes, { readOnly: true })),
    ).rejects.toThrow(/read-only/);
    expect(pushes).toHaveLength(0);
  });

  it('validates kind, text, and salience', async () => {
    const pushes: PushedRequest[] = [];
    await expect(
      authorMemory({
        hubUrl: 'http://hub.fake',
        apiKey: 'k',
        workspaceId: WSP,
        item: { kind: 'insight' as never, text: 'x', salience: 5 },
        fetchImpl: fakeHub(pushes),
      }),
    ).rejects.toThrow(/kind/);
    await expect(author(pushes, '   ')).rejects.toThrow(/text/);
    await expect(
      authorMemory({
        hubUrl: 'http://hub.fake',
        apiKey: 'k',
        workspaceId: WSP,
        item: { kind: 'decision', text: 'x', salience: 11 },
        fetchImpl: fakeHub(pushes),
      }),
    ).rejects.toThrow(/salience/);
  });

  it('fails loud without MEMORIZE_ROOT', async () => {
    delete process.env.MEMORIZE_ROOT;
    await expect(author([], 'x')).rejects.toThrow(/MEMORIZE_ROOT/);
  });
});
