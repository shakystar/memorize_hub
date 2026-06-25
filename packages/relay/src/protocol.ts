/**
 * Wire types for PROTOCOL.md v1. These mirror the memorize client's
 * sync-protocol shapes (src/domain/sync-protocol.ts) but stay structurally
 * independent: the relay treats events as opaque and depends on nothing but
 * `event.id` (PROTOCOL.md invariant 4).
 */

/** An event as the relay sees it: an `id`, everything else opaque. */
export interface OpaqueEvent {
  id: string;
  [key: string]: unknown;
}

export interface SyncPushRequest {
  projectId?: string;
  remoteProjectId?: string;
  sincePushedEventId?: string;
  events?: OpaqueEvent[];
}

export interface SyncPushResponse {
  accepted: string[];
  /** Always [] in v1; reserved for future protocol versions. */
  rejected: { eventId: string; reason: string }[];
  lastAcceptedEventId?: string;
}

export interface SyncPullResponse {
  events: OpaqueEvent[];
  lastRemoteEventId?: string;
}

/** Path ids become filesystem path components — validate before storage. */
export const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
