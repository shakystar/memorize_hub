import { createHash } from 'node:crypto';

import {
  ACTOR_SYSTEM,
  CURRENT_SCHEMA_VERSION,
} from '@shakystar/memorize/dist/domain/common.js';
import type { Project } from '@shakystar/memorize/dist/domain/entities.js';
import type { DomainEvent } from '@shakystar/memorize/dist/domain/events.js';
import {
  insertExternalEvents,
  readEvents,
} from '@shakystar/memorize/dist/storage/event-store.js';

import { bindWorkspaceStore, serverStoreId } from './workspace.js';

/**
 * Shared read-lane setup for the replica's read surfaces (Timeline, Tasks).
 * Every read pulls the workspace union into the same deterministic local lane
 * (`serverStoreId`), so the lane must be a coherent memorize store before the
 * first projection runs.
 */

function projectIdFromCreatedEvent(event: DomainEvent): string | undefined {
  if (event.type !== 'project.created') return undefined;
  const payload = event.payload as { id?: unknown };
  return typeof payload.id === 'string' ? payload.id : undefined;
}

/**
 * Deterministic id so repeated reads (and both read surfaces) converge on ONE
 * local genesis. The `timeline` name is historical (S2 shipped it first) and
 * must not change: the id is already persisted in live read-lane stores.
 */
function readLaneGenesisEventId(storeId: string): string {
  const digest = createHash('sha256').update(storeId).digest('hex').slice(0, 24);
  return `evt_hub_timeline_genesis_${digest}`;
}

async function ensureLaneProject(storeId: string, workspaceId: string): Promise<void> {
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
      id: readLaneGenesisEventId(storeId),
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

/**
 * Bind the deterministic lane to the workspace and make sure it has a local
 * genesis. Returns the lane's store id. Callers pull AFTER this.
 */
export async function ensureReadLane(params: {
  workspaceId: string;
  hubUrl: string;
}): Promise<string> {
  const storeId = serverStoreId(params.workspaceId);
  await bindWorkspaceStore({
    storeId,
    workspaceId: params.workspaceId,
    hubUrl: params.hubUrl,
  });
  await ensureLaneProject(storeId, params.workspaceId);
  return storeId;
}
