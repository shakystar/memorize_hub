import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CURRENT_SCHEMA_VERSION } from '@shakystar/memorize/dist/domain/common.js';
import type { DomainEvent } from '@shakystar/memorize/dist/domain/events.js';
import { closeAll } from '@shakystar/memorize/dist/storage/db.js';
import { readEvents } from '@shakystar/memorize/dist/storage/event-store.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readTimeline } from '../../src/timeline.js';
import { serverStoreId } from '../../src/workspace.js';

const WSP = 'wsp_s2_timeline_test';
const ACC = 'acc_alice_test';

let sandbox: string;

interface PullRequest {
  url: string;
  authorization?: string;
}

function remoteEvents(storeId: string): DomainEvent[] {
  const createdAt = '2026-07-03T00:00:00.000Z';
  const memoryAt = '2026-07-03T00:01:00.000Z';
  return [
    {
      id: 'evt_timeline_genesis',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt,
      updatedAt: createdAt,
      type: 'project.created',
      projectId: storeId,
      scopeType: 'project',
      scopeId: storeId,
      actor: 'user',
      writer: ACC,
      sourceProjectId: storeId,
      payload: {
        id: storeId,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt,
        updatedAt: createdAt,
        title: 'Hub web edits',
        summary: `Server-side timeline lane for ${WSP}`,
        goals: [],
        status: 'active',
        rootPath: `hub://${WSP}`,
        importedContextCount: 0,
        activeWorkstreamIds: [],
        activeTaskIds: [],
        acceptedDecisionIds: [],
        ruleIds: [],
      },
    },
    {
      id: 'evt_timeline_memory',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: memoryAt,
      updatedAt: memoryAt,
      type: 'memory.consolidated',
      projectId: storeId,
      scopeType: 'project',
      scopeId: storeId,
      actor: 'user',
      writer: ACC,
      sourceProjectId: storeId,
      payload: {
        id: 'mem_timeline_decision',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: memoryAt,
        updatedAt: memoryAt,
        projectId: storeId,
        kind: 'decision',
        text: 'timeline reads the pulled projection',
        salience: 8,
        sourceObservationIds: [],
        tags: ['timeline'],
        importSource: 'hub-web',
      },
    },
  ];
}

function remoteMemoryOnlyEvents(originProjectId: string): DomainEvent[] {
  const memoryAt = '2026-07-03T00:01:00.000Z';
  return [
    {
      id: 'evt_timeline_memory',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: memoryAt,
      updatedAt: memoryAt,
      type: 'memory.consolidated',
      projectId: originProjectId,
      scopeType: 'project',
      scopeId: originProjectId,
      actor: 'user',
      writer: ACC,
      sourceProjectId: originProjectId,
      payload: {
        id: 'mem_timeline_decision',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: memoryAt,
        updatedAt: memoryAt,
        projectId: originProjectId,
        kind: 'decision',
        text: 'timeline reads a genesis-less workspace log',
        salience: 8,
        sourceObservationIds: [],
        tags: ['timeline'],
        importSource: 'hub-web',
      },
    },
  ];
}

function fakeHub(events: DomainEvent[], pulls: PullRequest[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith(`/v1/projects/${WSP}/events`)) {
      throw new Error(`unexpected fetch: ${url.toString()}`);
    }
    const headers = new Headers(init?.headers);
    pulls.push({
      url: url.toString(),
      ...(headers.get('authorization')
        ? { authorization: headers.get('authorization') as string }
        : {}),
    });
    const since = url.searchParams.get('since');
    const sinceIndex = since ? events.findIndex((event) => event.id === since) : -1;
    const slice = since ? (sinceIndex === -1 ? events : events.slice(sinceIndex + 1)) : events;
    return new Response(
      JSON.stringify({
        events: slice,
        lastRemoteEventId: events[events.length - 1]?.id,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hub-replica-timeline-'));
  process.env.MEMORIZE_ROOT = sandbox;
});

afterEach(async () => {
  closeAll();
  delete process.env.MEMORIZE_ROOT;
  await rm(sandbox, { recursive: true, force: true }).catch(() => {});
});

describe('readTimeline', () => {
  it('pulls workspace events, rebuilds the projection, and emits timeline items', async () => {
    const storeId = serverStoreId(WSP);
    const pulls: PullRequest[] = [];
    const result = await readTimeline({
      hubUrl: 'http://hub.fake',
      apiKey: 'mzk_fake',
      workspaceId: WSP,
      fetchImpl: fakeHub(remoteEvents(storeId), pulls),
    });

    expect(result.storeId).toBe(storeId);
    expect(result.pulled).toMatchObject({ total: 2, inserted: 2 });
    expect(pulls).toHaveLength(1);
    expect(pulls[0]!.url).toContain(`/v1/projects/${WSP}/events`);
    expect(pulls[0]!.authorization).toBe('Bearer mzk_fake');
    expect(result.items).toEqual([
      {
        id: 'mem_timeline_decision',
        at: '2026-07-03T00:01:00.000Z',
        type: 'memory.consolidated',
        kind: 'decision',
        text: 'timeline reads the pulled projection',
        salience: 8,
        member: ACC,
        writer: ACC,
        sourceProjectId: storeId,
        sourceProjectLabel: storeId,
        tags: ['timeline'],
      },
    ]);
  });

  it('is idempotent across repeated reads and uses the pull watermark', async () => {
    const storeId = serverStoreId(WSP);
    const events = remoteEvents(storeId);
    const pulls: PullRequest[] = [];
    const fetchImpl = fakeHub(events, pulls);

    await readTimeline({
      hubUrl: 'http://hub.fake',
      apiKey: 'mzk_fake',
      workspaceId: WSP,
      fetchImpl,
    });
    const second = await readTimeline({
      hubUrl: 'http://hub.fake',
      apiKey: 'mzk_fake',
      workspaceId: WSP,
      fetchImpl,
    });

    expect(second.pulled).toMatchObject({ total: 0, inserted: 0 });
    expect(second.items).toHaveLength(1);
    expect(pulls[1]!.url).toContain('since=evt_timeline_memory');
  });

  it('creates a local read-model project when the workspace log has no genesis', async () => {
    const storeId = serverStoreId(WSP);
    const originProjectId = 'proj_alice_origin';
    const pulls: PullRequest[] = [];
    const result = await readTimeline({
      hubUrl: 'http://hub.fake',
      apiKey: 'mzk_fake',
      workspaceId: WSP,
      fetchImpl: fakeHub(remoteMemoryOnlyEvents(originProjectId), pulls),
    });

    const localEvents = await readEvents(storeId);

    expect(result.pulled).toMatchObject({ total: 1, inserted: 1 });
    expect(localEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'project.created',
          projectId: storeId,
          sourceProjectId: storeId,
          payload: expect.objectContaining({ id: storeId }),
        }),
      ]),
    );
    expect(result.items).toEqual([
      {
        id: 'mem_timeline_decision',
        at: '2026-07-03T00:01:00.000Z',
        type: 'memory.consolidated',
        kind: 'decision',
        text: 'timeline reads a genesis-less workspace log',
        salience: 8,
        member: ACC,
        writer: ACC,
        sourceProjectId: originProjectId,
        sourceProjectLabel: originProjectId,
        tags: ['timeline'],
      },
    ]);
  });

  it('validates the limit', async () => {
    await expect(
      readTimeline({
        hubUrl: 'http://hub.fake',
        apiKey: 'mzk_fake',
        workspaceId: WSP,
        limit: 0,
        fetchImpl: fakeHub([], []),
      }),
    ).rejects.toThrow(/limit/);
  });
});
