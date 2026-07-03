import { createHttpSyncTransport } from '@shakystar/memorize/dist/adapters/sync-transport-http.js';
import type {
  Handoff,
  OwnerType,
  Priority,
  Task,
  TaskStatus,
} from '@shakystar/memorize/dist/domain/entities.js';
import type { DomainEvent } from '@shakystar/memorize/dist/domain/events.js';
import type { SyncPullResult } from '@shakystar/memorize/dist/domain/sync-protocol.js';
import { listTasks } from '@shakystar/memorize/dist/services/projection-store.js';
import { pullProject } from '@shakystar/memorize/dist/services/sync-service.js';
import { readEvents } from '@shakystar/memorize/dist/storage/event-store.js';

import { ensureReadLane } from './read-lane.js';

/**
 * H060 Tasks read surface: one board card per union-lane Task, its latest
 * handoff joined in server-side so a handoff_ready card can show the next
 * action without a second fetch (web `TaskEntry`,
 * docs/design/workspace-canvas-features.md §3 "작업"). Same lane and pull
 * cursor as Timeline; only the projection differs.
 */

export interface TaskBoardItem {
  id: string;
  /** Last transition timestamp (the Task row's updatedAt). */
  at: string;
  /**
   * Raw member key — writer/provenance fallback chain, resolved to an account
   * email by the GATEWAY via the source-store registry. Events without
   * provenance stay unresolved on purpose (the identity-divergence backfill
   * is a separate, undecided design): they pass through as the lane id.
   */
  member: string;
  writer?: string;
  sourceProjectId?: string;
  sourceProjectLabel?: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  ownerType: OwnerType;
  description?: string;
  goal?: string;
  acceptanceCriteria?: string[];
  openQuestions?: string[];
  riskNotes?: string[];
  handoff?: {
    summary: string;
    nextAction: string;
    doneItems?: string[];
    remainingItems?: string[];
  };
}

export interface ReadTasksParams {
  /** Public gateway base URL, the same edge clients use. */
  hubUrl: string;
  /** Calling user's API key. Authorization is still Hub ACL on the events route. */
  apiKey: string;
  /** Server-minted workspace store id (`wsp_...`). */
  workspaceId: string;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export interface ReadTasksResult {
  storeId: string;
  pulled: SyncPullResult;
  items: TaskBoardItem[];
}

const TASK_EVENT_TYPES = new Set(['task.created', 'task.updated', 'task.item-appended']);

function taskIdOfEvent(event: DomainEvent): string | undefined {
  if (!TASK_EVENT_TYPES.has(event.type)) return undefined;
  const payload = event.payload as { id?: unknown };
  if (typeof payload.id === 'string' && payload.id.startsWith('task_')) return payload.id;
  // task.item-appended carries no task id in its payload; the task scope does.
  return event.scopeType === 'task' ? event.scopeId : undefined;
}

function nonEmpty(items: string[] | undefined): string[] | undefined {
  return items && items.length > 0 ? items : undefined;
}

function toBoardItem(
  storeId: string,
  task: Task,
  lastEvent: DomainEvent | undefined,
  handoffs: Map<string, Handoff>,
): TaskBoardItem {
  const writer = lastEvent?.writer;
  const sourceProjectId = lastEvent?.sourceProjectId;
  const handoff = task.latestHandoffId ? handoffs.get(task.latestHandoffId) : undefined;
  return {
    id: task.id,
    at: task.updatedAt,
    member: writer ?? sourceProjectId ?? storeId,
    ...(writer ? { writer } : {}),
    ...(sourceProjectId
      ? { sourceProjectId, sourceProjectLabel: sourceProjectId }
      : {}),
    title: task.title,
    status: task.status,
    priority: task.priority,
    ownerType: task.ownerType,
    // The domain defaults description/goal to '' and list fields to [] —
    // absent, not filled — so the wire omits them (web domain.ts contract).
    ...(task.description ? { description: task.description } : {}),
    ...(task.goal ? { goal: task.goal } : {}),
    ...(nonEmpty(task.acceptanceCriteria) ? { acceptanceCriteria: task.acceptanceCriteria } : {}),
    ...(nonEmpty(task.openQuestions) ? { openQuestions: task.openQuestions } : {}),
    ...(nonEmpty(task.riskNotes) ? { riskNotes: task.riskNotes } : {}),
    ...(handoff
      ? {
          handoff: {
            summary: handoff.summary,
            nextAction: handoff.nextAction,
            ...(nonEmpty(handoff.doneItems) ? { doneItems: handoff.doneItems } : {}),
            ...(nonEmpty(handoff.remainingItems)
              ? { remainingItems: handoff.remainingItems }
              : {}),
          },
        }
      : {}),
  };
}

export async function readTasks(params: ReadTasksParams): Promise<ReadTasksResult> {
  if (!process.env.MEMORIZE_ROOT) {
    throw new Error('MEMORIZE_ROOT must be set to the replica server root');
  }

  const storeId = await ensureReadLane({
    workspaceId: params.workspaceId,
    hubUrl: params.hubUrl,
  });

  const pulled = await pullProject(
    storeId,
    createHttpSyncTransport(params.hubUrl, {
      token: params.apiKey,
      ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    }),
  );

  // Provenance rides events, not projection rows: the LAST task event wins so
  // a card is attributed to whoever moved it most recently (insertion order).
  // Handoffs are joined from their creation events too — in this read lane
  // every member row is foreign-lane (composite-keyed in the projection), and
  // a handoff is immutable, so its event payload IS its projected value.
  const events = await readEvents(storeId);
  const lastTaskEvent = new Map<string, DomainEvent>();
  const handoffs = new Map<string, Handoff>();
  for (const event of events) {
    const taskId = taskIdOfEvent(event);
    if (taskId) lastTaskEvent.set(taskId, event);
    if (event.type === 'handoff.created') {
      const handoff = event.payload as Handoff;
      if (typeof handoff.id === 'string') handoffs.set(handoff.id, handoff);
    }
  }

  const items = listTasks(storeId, {}, 'union')
    .map((task) => toBoardItem(storeId, task, lastTaskEvent.get(task.id), handoffs))
    .sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.id < b.id ? -1 : 1));

  return { storeId, pulled, items };
}
