import { createHttpSyncTransport } from '@shakystar/memorize/dist/adapters/sync-transport-http.js';
import type { ConsolidatedMemoryKind } from '@shakystar/memorize/dist/domain/entities.js';
import type { DomainEvent } from '@shakystar/memorize/dist/domain/events.js';
import type { SyncPullResult } from '@shakystar/memorize/dist/domain/sync-protocol.js';
import { listValidMemories } from '@shakystar/memorize/dist/services/projection-store.js';
import { pullProject } from '@shakystar/memorize/dist/services/sync-service.js';
import { readEvents } from '@shakystar/memorize/dist/storage/event-store.js';

import { ensureReadLane } from './read-lane.js';

const DEFAULT_LIMIT = 50;

export interface TimelineCursor {
  at: string;
  id: string;
}

/** Opaque wire cursor. Only the replica encodes/decodes it. */
export function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): TimelineCursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = decoded.indexOf('|');
  if (sep <= 0 || sep === decoded.length - 1) {
    throw new Error(`malformed timeline cursor: ${raw}`);
  }
  return { at: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
}

/** Strict (at,id) < cursor, matching byAscendingTimeline ordering. */
function isBeforeCursor(item: { at: string; id: string }, cursor: TimelineCursor): boolean {
  if (item.at !== cursor.at) return item.at < cursor.at;
  return item.id < cursor.id;
}

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
  /** Return items strictly older than this cursor (backward pagination). */
  before?: TimelineCursor;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export interface ReadTimelineResult {
  storeId: string;
  pulled: SyncPullResult;
  items: TimelineMemoryItem[];
  /** True when older items exist beyond this page. */
  hasMore: boolean;
  /** Opaque cursor for the next older page; omitted when hasMore is false. */
  nextCursor?: string;
}

function memoryIdFromEvent(event: DomainEvent): string | undefined {
  if (event.type !== 'memory.consolidated') return undefined;
  const payload = event.payload as { id?: unknown };
  return typeof payload.id === 'string' ? payload.id : undefined;
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

  const events = await readEvents(storeId);
  const memoryEvents = new Map<string, DomainEvent>();
  for (const event of events) {
    const memoryId = memoryIdFromEvent(event);
    if (memoryId) memoryEvents.set(memoryId, event);
  }

  const all = listValidMemories(storeId, 'union')
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

  const limit = params.limit ?? DEFAULT_LIMIT;
  const pool = params.before ? all.filter((i) => isBeforeCursor(i, params.before!)) : all;
  const page = pool.slice(-limit);
  const hasMore = pool.length > page.length;
  const oldest = page[0];

  return {
    storeId,
    pulled,
    items: page,
    hasMore,
    ...(hasMore && oldest ? { nextCursor: encodeCursor(oldest.at, oldest.id) } : {}),
  };
}
