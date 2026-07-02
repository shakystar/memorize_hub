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

/** memorize Priority, verbatim. */
export type Priority = 'low' | 'medium' | 'high';

/** memorize OwnerType, verbatim. */
export type OwnerType = 'human' | 'agent' | 'unassigned';

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
  /**
   * The workspace member (account email) this item belongs to — server-resolved
   * from the source store's owner. The chat-style timeline groups by member
   * (mine right, others left); writer/source are per-bubble metadata.
   */
  member: string;
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
 * Sync arrivals are deliberately NOT feed items: sync is heading toward
 * realtime, so per-arrival rows would flood the timeline. Sync visibility
 * belongs in aggregate form (e.g. a per-member "last synced" indicator).
 */
export type TimelineItem = DomainTimelineItem;

/**
 * [replica] A tasks-board card — one Task (`entities/task.ts`) with its
 * latest handoff joined in server-side (`latestHandoffId` →
 * `entities/handoff.ts`), so a handoff_ready card can show what the next
 * machine should do without a second fetch. Field names verbatim from the
 * entities; the domain defaults list fields to `[]` and the wire omits
 * empties. No due/start dates — the domain has none (a memorize-side
 * decision if a calendar/gantt view is ever wanted).
 */
export interface TaskEntry extends Provenance {
  id: string;
  /** ISO-8601 timestamp of the last status transition. */
  at: string;
  /** Owning workspace member (account email), server-resolved as in the timeline. */
  member: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  ownerType: OwnerType;
  description?: string;
  goal?: string;
  acceptanceCriteria?: string[];
  openQuestions?: string[];
  riskNotes?: string[];
  /** Joined from latestHandoffId; present when status is handoff_ready. */
  handoff?: {
    summary: string;
    nextAction: string;
    doneItems?: string[];
    remainingItems?: string[];
  };
}
