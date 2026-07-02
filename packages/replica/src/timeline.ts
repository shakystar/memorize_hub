import { createHash } from 'node:crypto';

import { createHttpSyncTransport } from '@shakystar/memorize/dist/adapters/sync-transport-http.js';
import {
  ACTOR_SYSTEM,
  CURRENT_SCHEMA_VERSION,
} from '@shakystar/memorize/dist/domain/common.js';
import type {
  ConsolidatedMemoryKind,
  Project,
} from '@shakystar/memorize/dist/domain/entities.js';
import type { DomainEvent } from '@shakystar/memorize/dist/domain/events.js';
import type { SyncPullResult } from '@shakystar/memorize/dist/domain/sync-protocol.js';
import { listValidMemories } from '@shakystar/memorize/dist/services/projection-store.js';
import { pullProject } from '@shakystar/memorize/dist/services/sync-service.js';
import {
  insertExternalEvents,
  readEvents,
} from '@shakystar/memorize/dist/storage/event-store.js';

import { bindWorkspaceStore, serverStoreId } from './workspace.js';

export interface TimelineMemoryItem {
  id: string;
  at: string;
  type: 'memory.consolidated';
  kind: ConsolidatedMemoryKind;
  text: string;
  salience: number;
  member: string;
  writer?: string;
  sourceProjectId?: string;
  sourceProjectLabel?: string;
  tags?: string[];
}

export interface ReadTimelineParams {
  /** Public gateway base URL, the same edge clients use. */
  hubUrl: string;
  /** Calling user's API key. Authorization is still Hub ACL on the events route. */
  apiKey: string;
  /** Server-minted workspace store id (`wsp_...`). */
  workspaceId: string;
  /** Return the newest N items while preserving chronological display order. */
  limit?: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export interface ReadTimelineResult {
  storeId: string;
  pulled: SyncPullResult;
  items: TimelineMemoryItem[];
}

function memoryIdFromEvent(event: DomainEvent): string | undefined {
  if (event.type !== 'memory.consolidated') return undefined;
  const payload = event.payload as { id?: unknown };
  return typeof payload.id === 'string' ? payload.id : undefined;
}

function projectIdFromCreatedEvent(event: DomainEvent): string | undefined {
  if (event.type !== 'project.created') return undefined;
  const payload = event.payload as { id?: unknown };
  return typeof payload.id === 'string' ? payload.id : undefined;
}

function timelineGenesisEventId(storeId: string): string {
  const digest = createHash('sha256').update(storeId).digest('hex').slice(0, 24);
  return `evt_hub_timeline_genesis_${digest}`;
}

async function ensureTimelineProject(storeId: string, workspaceId: string): Promise<void> {
  const events = await readEvents(storeId);
  if (events.some((event) => projectIdFromCreatedEvent(event) === storeId)) return;

  const now = new Date().toISOString();
  const project: Project = {
    id: storeId,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    title: 'Hub Timeline',
    summary: `Server-side Timeline read lane for ${workspaceId}`,
    goals: [],
    status: 'active',
    rootPath: `hub://${workspaceId}`,
    importedContextCount: 0,
    activeWorkstreamIds: [],
    activeTaskIds: [],
    acceptedDecisionIds: [],
    ruleIds: [],
  };

  // Local-only read-model anchor: do not push this event back to the relay.
  await insertExternalEvents(storeId, [
    {
      id: timelineGenesisEventId(storeId),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      type: 'project.created',
      projectId: storeId,
      scopeType: 'project',
      scopeId: storeId,
      actor: ACTOR_SYSTEM,
      writer: ACTOR_SYSTEM,
      sourceProjectId: storeId,
      payload: project,
    },
  ]);
}

function byAscendingTimeline(a: TimelineMemoryItem, b: TimelineMemoryItem): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export async function readTimeline(
  params: ReadTimelineParams,
): Promise<ReadTimelineResult> {
  if (!process.env.MEMORIZE_ROOT) {
    throw new Error('MEMORIZE_ROOT must be set to the replica server root');
  }
  if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1)) {
    throw new Error(`limit must be a positive integer, got: ${params.limit}`);
  }

  const storeId = serverStoreId(params.workspaceId);
  await bindWorkspaceStore({
    storeId,
    workspaceId: params.workspaceId,
    hubUrl: params.hubUrl,
  });
  await ensureTimelineProject(storeId, params.workspaceId);

  const pulled = await pullProject(
    storeId,
    createHttpSyncTransport(params.hubUrl, {
      token: params.apiKey,
      ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    }),
  );

  const events = await readEvents(storeId);
  const memoryEvents = new Map<string, DomainEvent>();
  for (const event of events) {
    const memoryId = memoryIdFromEvent(event);
    if (memoryId) memoryEvents.set(memoryId, event);
  }

  const items = listValidMemories(storeId, 'union')
    .map(({ memory }) => {
      const event = memoryEvents.get(memory.id);
      const writer = event?.writer;
      const sourceProjectId = memory.sourceProjectId ?? event?.sourceProjectId;
      return {
        id: memory.id,
        at: memory.createdAt,
        type: 'memory.consolidated' as const,
        kind: memory.kind,
        text: memory.text,
        salience: memory.salience,
        member: writer ?? sourceProjectId ?? storeId,
        ...(writer ? { writer } : {}),
        ...(sourceProjectId
          ? { sourceProjectId, sourceProjectLabel: sourceProjectId }
          : {}),
        ...(memory.tags?.length ? { tags: memory.tags } : {}),
      };
    })
    .sort(byAscendingTimeline);

  return {
    storeId,
    pulled,
    items: params.limit ? items.slice(-params.limit) : items,
  };
}
