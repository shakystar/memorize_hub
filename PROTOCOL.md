# memorize_hub - Wire Protocol (v1)

> **Authoritative source of truth** for the HTTP sync contract shared by the
> `memorize` client (`src/adapters/sync-transport-http.ts`) and this relay
> server. Both sides implement THIS document. Versioned under `/v1`.

## Role

memorize_hub is the **optional relay** for memorize's P3-b-2 cross-machine auto
sync. It is a **dumb store-and-forward** queue of opaque events per project:

- The origin machine **pushes** new events.
- The relay **holds** them (durably).
- A replica machine **pulls** later - even if the origin is offline.

The relay never parses, validates, projects, or interprets event payloads. It
preserves insertion order and dedups by event id. All convergence/projection
logic lives in the memorize clients (CRDT-style: events are a grow-only set,
deduped by id). This keeps the relay vendor-independent and trivially correct.

## Transport

- HTTP/1.1, JSON bodies (`content-type: application/json`).
- Base URL is configured client-side (e.g. `https://hub.example.com`). All
  routes below are relative to it.
- **Auth (optional bearer token):** if the relay is started with a token, every
  route requires `Authorization: Bearer <token>`; mismatched/missing -> `401`.
  No token configured -> open (localhost/trusted-network dev). Local-first: the
  relay is always optional; clients without a configured relay never call it.

## Endpoints

**`:projectId` validation:** the path id MUST match `^[A-Za-z0-9_-]{1,128}$`.
Anything else -> `400`, before touching storage. (The id becomes a filesystem
path component on the relay, so this also closes path traversal; memorize ids
like `proj_...` already conform.)

### `POST /v1/projects/:projectId/events`

Append events for `:projectId`. `:projectId` is the memorize **replica id**
(same id on every machine - true-replica, memorize #30).

Request body = memorize `SyncPushRequest`:

```jsonc
{
  "projectId": "proj_...",          // sender's local id (== remote in true-replica)
  "remoteProjectId": "proj_...",    // optional; the relay keys by the PATH id
  "sincePushedEventId": "evt_...",  // optional; informational only
  "events": [ /* opaque DomainEvent JSON objects, each with a unique "id" */ ]
}
```

Behavior: for each event, if `event.id` is already stored for this project,
**skip it** (idempotent dedup); otherwise append in array order. Clients may
re-push overlapping ranges (stale watermark, concurrent pushes) - dedup makes
this safe.

Response `200` = `SyncPushResponse`:

```jsonc
{
  "accepted": ["evt_b", "evt_c"],   // ids newly stored this call (dupes excluded)
  "rejected": [],                   // [{ "eventId": "...", "reason": "..." }]
  "lastAcceptedEventId": "evt_c"    // optional; last id in `accepted`
}
```

> A client treats only `lastAcceptedEventId` as its push watermark. Returning
> the last *stored* id (not last *seen*) keeps the watermark monotonic.

> The v1 relay never rejects individual events: `rejected` is always `[]`.
> The field is reserved for future protocol versions.

### `GET /v1/projects/:projectId/events?since=:eventId`

Return events stored after `:eventId`, in insertion order.

- No `since` -> return **all** events for the project.
- `since` present but **not found** (e.g. compacted/never-stored) -> return
  **all** events. (Mirrors the memorize file adapter's `findIndex(-1)+1 =
  slice(0)`; the client dedups via local `INSERT OR IGNORE`, so over-returning
  is always safe, under-returning is not.)
- `since` found -> return everything strictly after it.

Response `200` = `SyncPullResponse`:

```jsonc
{
  "events": [ /* opaque DomainEvent JSON, insertion order */ ],
  "lastRemoteEventId": "evt_z"      // optional; id of the last event returned
}
```

### `GET /healthz`

Liveness. Response `200`: `{ "ok": true }`. (Subject to the auth gate too, so a
token holder can verify both reachability and credentials in one call.)

## Status codes

| Code | When |
|---|---|
| `200` | success |
| `400` | malformed JSON / invalid `:projectId` / bad request |
| `401` | auth required and token missing or wrong |
| `404` | unknown route / method |
| `413` | request body exceeds the relay's size limit |
| `5xx` | relay-side failure |

Any non-2xx makes the memorize client throw; its never-throw auto-sync gate
degrades that to a deferred no-op and retries at the next boundary. So transient
relay outages are invisible and self-healing - never data loss (events stay in
the local append-only log until a push succeeds).

## Invariants the relay MUST uphold

1. **Append-only.** Never mutate or drop a stored event. Dedup = skip-on-write,
   not overwrite.
2. **Order-preserving.** Pull returns events in the order they were stored.
3. **Idempotent.** Re-pushing a stored id is a no-op; re-pulling a range is safe.
4. **Opaque payloads.** Do not depend on any field except `event.id`.

## Non-goals (v1)

Conflict resolution, projection, HLC tie-break, semantic search - all live in
memorize clients, not the relay. The relay is intentionally dumb.
