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
4. **Opaque payloads.** Do not depend on any field except `event.id`. A payload
   MAY be an end-to-end-encrypted ciphertext envelope (see below) - never parse,
   validate, or transform it, and never assume it is plaintext.

## Payload encryption (E2E)

memorize MAY end-to-end-encrypt each event's `payload` at the sync boundary
(memorize #182): the client encrypts on push and decrypts on pull with a
per-project symmetric key the relay never sees. On the wire the `payload`
becomes a self-describing ciphertext envelope:

```jsonc
{ "__enc": "A256GCM", "kid": "<key fingerprint>", "iv": "...", "ct": "...", "tag": "..." }
```

`event.id` and every routing/metadata field stay plaintext (`event.id` is
authenticated as AAD). Because the relay routes only on `event.id` and treats
`payload` as fully opaque, encryption needs **zero** relay or wire changes - an
encrypted payload is just another opaque object. The relay MUST NOT parse,
validate, or transform the envelope.

**What the relay still sees, even with E2E on:** the metadata - `event.id`,
event type, scope, actor, plus payload **size** and push/pull **timing**. E2E
hides payload contents only, not the existence or shape of activity. Key
distribution is out of band in v1 (manual copy at clone); an asymmetric
key-wrapping path that would add Hub endpoints is deferred - it still requires
out-of-band fingerprint verification, since a relay serving public keys is a
man-in-the-middle vector.

## Personal memory store (gateway control-plane extension)

> **Implemented by the gateway, not the relay.** The relay knows nothing of
> accounts or personal memory; a personal store is just another opaque event log
> keyed by a path id. This section is documented here so the memorize client has
> a single wire-contract source. A bare relay (no gateway) does not serve it.

memorize keeps **global, cross-project personal memory** that must sync across a
user's own machines but **never** leak into shared/project/team surfaces. The
gateway models this as a per-account **personal store**: one opaque event log
per account, owned by exactly one account and **never grantable or shared**.

It rides the **same event contract** as a project — the `POST`/`GET
/v1/projects/:storeId/events` endpoints above, byte-for-byte, including E2E
payload encryption. Only the authorization axis differs (owner-only, below).

### `GET /v1/account/personal-store`

Resolve the caller's account (by API key) to its personal-store id, provisioning
one on first call. The client then syncs personal memory via the events route
under the returned id.

- **Auth:** `Authorization: Bearer <api-key>` (the same participant key used for
  project sync). The CLI holds a key, not a browser cookie.
- Only an **unscoped** key qualifies. A key narrowed to a project subset cannot
  reach personal memory and gets `403` here — mint an unscoped key for personal
  sync.

Response `200`:

```jsonc
{
  "storeId": "psm_...",                       // relay path id for this account's personal memory
  "eventsUrl": "/v1/projects/psm_.../events"  // convenience; the normal events route
}
```

### Authorization (owner-only isolation)

For a personal-store id, the gateway bypasses project ACL entirely and enforces:

1. The key's account **owns** that personal store, else `403`. No account can
   reach another's personal store — this is the privacy guarantee.
2. The key is **unscoped** (`tokenCoversPersonal`), else `403`.
3. `read_only` keys may pull but never push (`403` on `POST`), as for projects.

The personal-store id namespace (`psm_…`) is **reserved**: the gateway refuses
to grant or create an access request for an id in that shape, so a project can
never shadow or be granted as a personal store. The client MUST treat the leak
boundary as its own responsibility too — personal-scoped events go only to the
personal store, never mixed into any project's push (memorize #181).

## Non-goals (v1)

Conflict resolution, projection, HLC tie-break, semantic search - all live in
memorize clients, not the relay. The relay is intentionally dumb.
