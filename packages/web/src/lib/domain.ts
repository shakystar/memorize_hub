/**
 * Wire-shape view types for the memory canvas — the demand-side draft of the
 * read-surface (headless replica, H060) JSON API. Field names mirror the
 * memorize domain (`../memorize/src/domain/events.ts`, `entities/memory.ts`,
 * `entities/task.ts`); keep them identical so the eventual API needs no
 * translation. Spec: docs/design/workspace-canvas-features.md.
 */

/** memorize ConsolidatedMemoryKind, verbatim. */
export type ConsolidatedMemoryKind = 'decision' | 'rationale' | 'progress';

/** memorize TaskStatus, verbatim. */
export type TaskStatus = 'todo' | 'in_progress' | 'handoff_ready' | 'blocked' | 'done' | 'cancelled';

/** Per-event provenance (memorize 3.0.0 Phase 0): who wrote it, from where. */
export interface Provenance {
  /** Originating actor identity (DomainEvent.writer). */
  writer: string;
  /**
   * Originating store id (DomainEvent.sourceProjectId). Internal id — shown
   * only in detail panels, never as the leading label.
   */
  sourceProjectId: string;
  /** Server-resolved display name for the source store (the translation layer). */
  sourceProjectLabel?: string;
}

interface TimelineItemBase extends Provenance {
  id: string;
  /** ISO-8601 timestamp. */
  at: string;
}

/**
 * [replica] Domain-event feed items. `type` values are memorize
 * DomainEventType members — no invented event names.
 */
export type DomainTimelineItem =
  | (TimelineItemBase & {
      type: 'memory.consolidated';
      kind: ConsolidatedMemoryKind;
      text: string;
      /** Importance 1-10, scored at the consolidation boundary. */
      salience: number;
      tags?: string[];
    })
  | (TimelineItemBase & { type: 'memory.retracted'; text: string })
  | (TimelineItemBase & { type: 'decision.accepted'; title: string })
  | (TimelineItemBase & { type: 'task.created'; title: string })
  | (TimelineItemBase & { type: 'task.updated'; title: string; status: TaskStatus })
  | (TimelineItemBase & { type: 'handoff.created'; title: string })
  | (TimelineItemBase & { type: 'session.started' | 'session.completed'; agent: string });

/**
 * [now] Control-plane feed item — a gateway-observed sync arrival, not a
 * DomainEvent. The member (account) is the only attribution the control-plane
 * has (per-repo attribution is payload-internal, replica-only — H010).
 */
export interface SyncTimelineItem {
  id: string;
  at: string;
  type: 'sync.push' | 'sync.pull';
  /** The syncing member's account email. */
  member: string;
}

export type TimelineItem = DomainTimelineItem | SyncTimelineItem;

export function isSyncItem(item: TimelineItem): item is SyncTimelineItem {
  return item.type === 'sync.push' || item.type === 'sync.pull';
}
