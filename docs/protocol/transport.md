# Transport (relay events route)

> The **only** surface a bare relay (no gateway) serves. The relay never parses,
> validates, projects, or interprets event payloads; it preserves insertion order
> and dedups by `event.id`. All convergence/projection lives in memorize clients
> (CRDT-style grow-only set). Conventions (id validation, status codes) are in
> [`README.md`](./README.md); this doc states the relay-specific contract.

## Role

memorize_hub is the **optional relay** for memorize's cross-machine auto sync — a
dumb store-and-forward queue of opaque events per store:

- the origin machine **pushes** new events,
- the relay **holds** them durably,
- a replica machine **pulls** later, even if the origin is offline.

## Transport basics

- HTTP/1.1, JSON bodies (`content-type: application/json`).
- Base URL is configured client-side (e.g. `https://hub.example.com`); routes are
  relative to it.
- **Relay auth (optional internal bearer token):** if the relay is started with a
  token, every route requires `Authorization: Bearer <token>`; missing/mismatched
  -> `401`. No token configured -> open (localhost/trusted-network dev). This is
  the relay's *internal* token, injected by the gateway — distinct from the
  participant API keys the gateway authenticates ([`README.md`](./README.md) §2).

## `POST /v1/projects/:storeId/events`

Append events for `:storeId` (a server-minted `psm_…`/`wsp_…`; see
[`store-resolution.md`](./store-resolution.md)). The route keeps its
`/v1/projects/…` path; the relay is prefix-blind and keys on the raw id.

> **`proj_…` is provenance, not the path id.** memorize's own project id
> (memorize#30 true-replica) travels as `sourceProjectId` *inside* each event, not
> as the store path — which is why two users merging their DBs into one workspace
> never collide on the path id.

Request body = memorize `SyncPushRequest`:

```jsonc
{
  "storeId": "wsp_...",             // server-minted target store (== the PATH id)
  "sincePushedEventId": "evt_...",  // optional; informational only
  "events": [ /* opaque DomainEvent JSON, each: unique "id" + writer/sourceProjectId provenance */ ]
}
```

Behavior: for each event, if `event.id` is already stored for this store, **skip
it** (idempotent dedup); otherwise append in array order. Clients may re-push
overlapping ranges (stale watermark, concurrent pushes) — dedup makes this safe.

Response `200` = `SyncPushResponse`:

```jsonc
{
  "accepted": ["evt_b", "evt_c"],   // ids newly stored this call (dupes excluded)
  "rejected": [],                   // reserved; the v1 relay never rejects, always []
  "lastAcceptedEventId": "evt_c"    // optional; last id in `accepted`
}
```

> A client treats only `lastAcceptedEventId` as its push watermark. Returning the
> last *stored* id (not last *seen*) keeps the watermark monotonic.

## `GET /v1/projects/:storeId/events?since=:eventId`

Return events stored after `:eventId`, in insertion order.

- No `since` -> return **all** events for the store.
- `since` present but **not found** (compacted/never-stored) -> return **all**
  events. (The client dedups via local `INSERT OR IGNORE`, so over-returning is
  always safe, under-returning is not.)
- `since` found -> return everything strictly after it.

Response `200` = `SyncPullResponse`:

```jsonc
{
  "events": [ /* opaque DomainEvent JSON, insertion order */ ],
  "lastRemoteEventId": "evt_z"      // optional; id of the last event returned
}
```

## `GET /healthz`

Liveness. Response `200`: `{ "ok": true }`. Subject to the relay auth gate too, so
a token holder can verify reachability and credentials in one call.

## Invariants the relay MUST uphold

1. **Append-only.** Never mutate or drop a stored event. Dedup = skip-on-write,
   not overwrite.
2. **Order-preserving.** Pull returns events in the order they were stored.
3. **Idempotent.** Re-pushing a stored id is a no-op; re-pulling a range is safe.
4. **Opaque payloads.** Depend on no field except `event.id`. A payload MAY be an
   end-to-end-encrypted ciphertext envelope (below) — never parse, validate, or
   transform it, and never assume it is plaintext.

## Payload encryption (E2E, optional)

memorize MAY end-to-end-encrypt each event's `payload` at the sync boundary
(memorize #182): the client encrypts on push and decrypts on pull with a
per-store symmetric key the relay never sees. On the wire the `payload` becomes a
self-describing ciphertext envelope:

```jsonc
{ "__enc": "A256GCM", "kid": "<key fingerprint>", "iv": "...", "ct": "...", "tag": "..." }
```

`event.id` and every routing/metadata field stay plaintext (`event.id` is
authenticated as AAD). Because the relay routes only on `event.id` and treats
`payload` as fully opaque, encryption needs **zero** relay or wire changes — an
encrypted payload is just another opaque object.

**What the relay still sees, even with E2E on:** the metadata — `event.id`, event
type, scope, actor, plus payload **size** and push/pull **timing**. E2E hides
payload *contents* only, not the existence or shape of activity. Key distribution
is out of band in v1 (manual copy at clone); an asymmetric key-wrapping path that
would add Hub endpoints is deferred (Hub SoT [[H070]]) — it still requires
out-of-band fingerprint verification, since a relay serving public keys is a
man-in-the-middle vector.

> Workspace shared memory is deliberately **not** E2E in v1 — the server needs
> plaintext to consolidate once for everyone ([`workspace.md`](./workspace.md),
> Hub SoT [[H070]]). The E2E envelope is for personal / private-project sync.
