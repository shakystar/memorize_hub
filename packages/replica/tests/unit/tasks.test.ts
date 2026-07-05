import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CURRENT_SCHEMA_VERSION } from '@shakystar/memorize/dist/domain/common.js';
import type { DomainEvent } from '@shakystar/memorize/dist/domain/events.js';
import { closeAll } from '@shakystar/memorize/dist/storage/db.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readTasks } from '../../src/tasks.js';
import { serverStoreId } from '../../src/workspace.js';

const WSP = 'wsp_tasks_test';
const ACC = 'acc_alice_test';

let sandbox: string;

function baseTask(storeId: string, id: string, title: string, createdAt: string) {
  return {
    id,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt,
    updatedAt: createdAt,
    projectId: storeId,
    title,
    description: '',
    status: 'todo',
    priority: 'medium',
    ownerType: 'unassigned',
    goal: '',
    acceptanceCriteria: [],
    dependsOn: [],
    contextRefIds: [],
    decisionRefIds: [],
    ruleRefIds: [],
    openQuestions: [],
    riskNotes: [],
  };
}

function remoteEvents(storeId: string): DomainEvent[] {
  const t0 = '2026-07-03T00:00:00.000Z';
  const t1 = '2026-07-03T00:01:00.000Z';
  const t2 = '2026-07-03T00:02:00.000Z';
  const t3 = '2026-07-03T00:03:00.000Z';
  const event = (
    id: string,
    type: DomainEvent['type'],
    at: string,
    payload: unknown,
    provenance?: { writer: string; sourceProjectId: string },
    scope?: { scopeType: DomainEvent['scopeType']; scopeId: string },
  ): DomainEvent => ({
    id,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at,
    type,
    projectId: storeId,
    scopeType: scope?.scopeType ?? 'project',
    scopeId: scope?.scopeId ?? storeId,
    actor: 'user',
    ...(provenance ?? {}),
    payload: payload as DomainEvent['payload'],
  });

  return [
    event('evt_genesis', 'project.created', t0, {
      id: storeId,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: t0,
      updatedAt: t0,
      title: 'Hub Timeline',
      summary: `lane for ${WSP}`,
      goals: [],
      status: 'active',
      rootPath: `hub://${WSP}`,
      importedContextCount: 0,
      activeWorkstreamIds: [],
      activeTaskIds: [],
      acceptedDecisionIds: [],
      ruleIds: [],
    }, { writer: ACC, sourceProjectId: storeId }),

    // task_handed: created by a user session, then moved to handoff_ready by a
    // codex session on a replica of the SAME store (same lane, different
    // writer) - the LAST event owns the card.
    event('evt_task_created', 'task.created', t1, {
      ...baseTask(storeId, 'task_handed', 'Wire the tasks tab', t1),
      goal: 'live board',
      acceptanceCriteria: ['board renders'],
    }, { writer: ACC, sourceProjectId: 'proj_alice_laptop' },
      { scopeType: 'task', scopeId: 'task_handed' }),
    event('evt_handoff_created', 'handoff.created', t2, {
      id: 'hnd_1',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: t2,
      updatedAt: t2,
      projectId: storeId,
      taskId: 'task_handed',
      fromActor: 'codex',
      toActor: 'next-agent',
      summary: 'replica endpoint done',
      nextAction: 'wire the gateway route',
      doneItems: ['replica readTasks'],
      remainingItems: [],
      requiredContextRefs: [],
      warnings: [],
      unresolvedQuestions: [],
      confidence: 'high',
    }, { writer: 'codex', sourceProjectId: 'proj_alice_laptop' },
      { scopeType: 'task', scopeId: 'task_handed' }),
    event('evt_task_updated', 'task.updated', t3, {
      id: 'task_handed',
      status: 'handoff_ready',
      latestHandoffId: 'hnd_1',
      updatedAt: t3,
    }, { writer: 'codex', sourceProjectId: 'proj_alice_laptop' },
      { scopeType: 'task', scopeId: 'task_handed' }),

    // task_legacy: NO provenance (pre-Phase-0) - member stays unresolved (the
    // lane id); the identity-divergence backfill is a separate decision.
    event('evt_task_legacy', 'task.created', t2,
      baseTask(storeId, 'task_legacy', 'Old provenance-less task', t2),
      undefined,
      { scopeType: 'task', scopeId: 'task_legacy' }),
  ];
}

function fakeHub(events: DomainEvent[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith(`/v1/projects/${WSP}/events`)) {
      throw new Error(`unexpected fetch: ${url.toString()}`);
    }
    const since = url.searchParams.get('since');
    const sinceIndex = since ? events.findIndex((event) => event.id === since) : -1;
    const slice = since ? (sinceIndex === -1 ? events : events.slice(sinceIndex + 1)) : events;
    return new Response(
      JSON.stringify({ events: slice, lastRemoteEventId: events[events.length - 1]?.id }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hub-replica-tasks-'));
  process.env.MEMORIZE_ROOT = sandbox;
});

afterEach(async () => {
  closeAll();
  delete process.env.MEMORIZE_ROOT;
  await rm(sandbox, { recursive: true, force: true }).catch(() => {});
});

describe('readTasks', () => {
  it('projects union tasks with joined handoffs and last-event attribution', async () => {
    const storeId = serverStoreId(WSP);
    const result = await readTasks({
      hubUrl: 'http://hub.fake',
      apiKey: 'mzk_fake',
      workspaceId: WSP,
      fetchImpl: fakeHub(remoteEvents(storeId)),
    });

    expect(result.storeId).toBe(storeId);
    expect(result.items).toHaveLength(2);

    const legacy = result.items.find((item) => item.id === 'task_legacy');
    expect(legacy).toEqual({
      id: 'task_legacy',
      at: '2026-07-03T00:02:00.000Z',
      createdAt: '2026-07-03T00:02:00.000Z',
      member: storeId, // unresolved on purpose: no provenance to attribute
      title: 'Old provenance-less task',
      status: 'todo',
      priority: 'medium',
      ownerType: 'unassigned',
    });

    const handed = result.items.find((item) => item.id === 'task_handed');
    expect(handed).toMatchObject({
      at: '2026-07-03T00:03:00.000Z',
      member: 'codex', // last task event wins (raw; the gateway resolves it)
      writer: 'codex',
      sourceProjectId: 'proj_alice_laptop',
      title: 'Wire the tasks tab',
      status: 'handoff_ready',
      goal: 'live board',
      acceptanceCriteria: ['board renders'],
      handoff: {
        summary: 'replica endpoint done',
        nextAction: 'wire the gateway route',
        doneItems: ['replica readTasks'],
      },
    });
    // Empty handoff lists are omitted, not sent as [].
    expect(handed?.handoff).not.toHaveProperty('remainingItems');
    expect(handed).not.toHaveProperty('description');
  });

  it('is idempotent across repeated reads', async () => {
    const storeId = serverStoreId(WSP);
    const fetchImpl = fakeHub(remoteEvents(storeId));
    await readTasks({ hubUrl: 'http://hub.fake', apiKey: 'mzk_fake', workspaceId: WSP, fetchImpl });
    const second = await readTasks({
      hubUrl: 'http://hub.fake',
      apiKey: 'mzk_fake',
      workspaceId: WSP,
      fetchImpl,
    });
    expect(second.pulled).toMatchObject({ total: 0, inserted: 0 });
    expect(second.items).toHaveLength(2);
  });

  it('derives createdAt, startedAt (first in_progress) and dependsOn', async () => {
    const storeId = serverStoreId(WSP);
    const t0 = '2026-07-03T00:00:00.000Z';
    const t1 = '2026-07-03T00:01:00.000Z';
    const t2 = '2026-07-03T00:02:00.000Z';
    const t3 = '2026-07-03T00:03:00.000Z';
    const ev = (
      id: string, type: DomainEvent['type'], at: string, payload: unknown,
      scope?: { scopeType: DomainEvent['scopeType']; scopeId: string },
    ): DomainEvent => ({
      id, schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: at, updatedAt: at, type,
      projectId: storeId, scopeType: scope?.scopeType ?? 'project',
      scopeId: scope?.scopeId ?? storeId, actor: 'user',
      writer: ACC, sourceProjectId: 'proj_alice_laptop',
      payload: payload as DomainEvent['payload'],
    });
    const events: DomainEvent[] = [
      ev('e0', 'project.created', t0, {
        id: storeId, schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: t0, updatedAt: t0,
        title: 'T', summary: 's', goals: [], status: 'active', rootPath: `hub://${WSP}`,
        importedContextCount: 0, activeWorkstreamIds: [], activeTaskIds: [],
        acceptedDecisionIds: [], ruleIds: [],
      }),
      // task_pre created first (predecessor)
      ev('e1', 'task.created', t1, {
        ...baseTask(storeId, 'task_pre', 'Predecessor', t1),
      }, { scopeType: 'task', scopeId: 'task_pre' }),
      // task_active created with a dependsOn edge, then in_progress at t2, done at t3
      ev('e2', 'task.created', t1, {
        ...baseTask(storeId, 'task_active', 'Active work', t1), dependsOn: ['task_pre'],
      }, { scopeType: 'task', scopeId: 'task_active' }),
      ev('e3', 'task.updated', t2, { id: 'task_active', status: 'in_progress', updatedAt: t2 },
        { scopeType: 'task', scopeId: 'task_active' }),
      ev('e4', 'task.updated', t3, { id: 'task_active', status: 'done', updatedAt: t3 },
        { scopeType: 'task', scopeId: 'task_active' }),
    ];

    const result = await readTasks({
      hubUrl: 'http://hub.fake', apiKey: 'mzk_fake', workspaceId: WSP,
      fetchImpl: fakeHub(events),
    });

    const active = result.items.find((i) => i.id === 'task_active');
    expect(active).toMatchObject({
      createdAt: t1,
      startedAt: t2,       // first in_progress transition
      at: t3,              // last transition (done)
      status: 'done',
      dependsOn: ['task_pre'],
    });

    const pre = result.items.find((i) => i.id === 'task_pre');
    expect(pre?.createdAt).toBe(t1);
    expect(pre).not.toHaveProperty('startedAt');   // never entered in_progress
    expect(pre).not.toHaveProperty('dependsOn');   // empty -> omitted
  });
});
