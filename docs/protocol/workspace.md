# Workspace (gateway control-plane + opaque relay data-plane)

> Control-plane implemented by the **gateway**; data-plane rides the **opaque
> relay events route unchanged**. Documented here so the memorize client has one
> wire-contract source. A bare relay (no gateway) does not serve the
> control-plane; its events route still works for anyone who already holds a
> `wsp_…` id. All conventions (auth, `read_only`/scope, status codes, `403` vs
> `404`) are defined once in [`README.md`](./README.md) — this doc only states
> per-endpoint specifics.

A **workspace** is a shared, multi-account project surface: several accounts each
sync their project DB into one shared event log, and each member's local store
becomes the **union** of all members' project memory, distinguished by provenance
(memorize SoT-040). A **private project is the degenerate 1-member case** of the
same mechanism (Hub SoT [[H040]]): same `wsp_` store, one member, no invites.

## Transport model (Hub SoT [[H020]], resolves memorize SoT-900 #1)

Hybrid, not one transport:

- **Control-plane = typed gateway endpoints** (below). Workspace lifecycle,
  membership, invite/join, and roles are *server-issued identity* (SoT-020: the
  `wsp_` id is minted by the server; join is by invite URL, never a content hash).
  The dumb relay cannot own this.
- **Data-plane = the existing opaque events route.** Once a member has resolved
  the workspace's `wsp_…` id, shared memory flows over
  `POST/GET /v1/projects/:wsp_…/events` **byte-for-byte** as for a project
  ([`transport.md`](./transport.md)). No new event envelope: a member *publishes
  by syncing their project DB* (whole-DB union), and every `DomainEvent` already
  carries `writer` + `sourceProjectId` provenance (SoT-030/040). The relay stays
  dumb; it routes only on `event.id`.

## Identifiers and roles

- **`wsp_…`** — the workspace id; it *is* the relay store path id (one id, as
  `psm_…` is both the personal-store id and its path id). Reserved namespace
  ([`README.md`](./README.md) §1).
- **Roles (two, SoT-040):** `owner` (creates the workspace, manages membership,
  mints/revokes invites, changes roles, deletes the workspace, and may globally
  retract *any* member's assertions) and `member` (sync = publish; may retract
  *their own*). `read_only` is orthogonal to role ([`README.md`](./README.md) §3).

## The private -> shared transition (Hub SoT [[H040]])

A store carries an `invite_reachable` flag. `POST /v1/workspaces` always mints it
**`false`** — a 1-member private project. The store flips to **`true`** the first
time its owner mints an invite (`POST …/invites`). So "private vs shared" is not a
creation-time mode the client chooses; it is a consequence of *whether the owner
has ever invited anyone*. One store mechanism, one create endpoint. There is no
separate "make it shared" call.

---

## Control-plane endpoints

All require an **account principal** ([`README.md`](./README.md) §2). Mutations
additionally require a **non-`read_only`, unscoped** key or a session
([`README.md`](./README.md) §3). Auth failure -> `401`; visibility/role rules per
[`README.md`](./README.md) §5.

### `POST /v1/workspaces`

Create a workspace; the caller becomes its `owner` and sole member.

- **Body:** `{ "name"?: "..." }` — optional display name (metadata only, never an
  identity; <= 200 chars, else `400`).
- **Auth:** unscoped, non-`read_only`.

Response `201`:

```jsonc
{
  "workspaceId": "wsp_...",
  "eventsUrl": "/v1/projects/wsp_.../events",
  "role": "owner",
  "inviteReachable": false            // always false at creation (a private project)
}
```

### `GET /v1/account/workspaces`

Discovery: list workspaces the calling account belongs to (the sibling of
`GET /v1/account/personal-store`). Includes 1-member private projects — they are
degenerate workspaces — so `inviteReachable` + `memberCount` let the client tell a
private project from a shared workspace.

- **Auth:** unscoped (any `read_only`).

Response `200`:

```jsonc
{
  "workspaces": [
    {
      "workspaceId": "wsp_...",
      "eventsUrl": "/v1/projects/wsp_.../events",
      "role": "owner",              // this account's role
      "name": "...",                // may be null
      "inviteReachable": true,      // false => still a private project
      "memberCount": 3
    }
  ]
}
```

### `GET /v1/workspaces/:workspaceId`

Membership roster — identifies co-writers so the client can label shared-memory
provenance. Any member may read it; non-member or unknown id -> `404`.

Response `200`:

```jsonc
{
  "workspaceId": "wsp_...",
  "name": "...",                    // may be null
  "inviteReachable": true,
  "members": [
    {
      "accountId": "acc_...",
      "role": "owner",
      "email": "alice@example.com", // verified email — display handle for provenance
      "joinedAt": "2026-07-01T00:00:00Z"
    }
  ]
}
```

### `POST /v1/workspaces/:workspaceId/source-stores`

A member self-declares "my local store `proj_…` writes into this workspace". This
is the control-plane bridge that lets the Hub resolve per-event `sourceProjectId`
provenance to the owning **account** without ever reading event content (the
gateway never parses payloads, and `writer` inside events is an *agent* actor
like `codex`, not an identity). The Timeline uses it to attribute items to
members; unregistered source stores fall back to raw provenance labels.

The client calls this when it binds/joins a workspace, and again (idempotently)
alongside push, so stores bound before this endpoint existed heal on their next
sync.

- **Body:** `{ "sourceProjectId": "proj_...", "label"?: "..." }` —
  `sourceProjectId` is the client-minted local store id (`proj_` prefix, <= 125
  chars, `[A-Za-z0-9_-]`, else `400`); `label` is an optional human display
  handle for the store (repo/folder/machine name; <= 120 chars), metadata only.
- **Auth:** unlike the management routes above, this is a **data-plane
  companion** — it travels with push, so it is callable with the same key a
  syncing machine holds: membership ∩ key scope ∩ non-`read_only` (the
  events-route gate), **scoped keys allowed**. Non-member -> `403` (data-plane
  denial, mirroring the events route).
- **First registration wins:** a `sourceProjectId` already registered to
  **another** account in this workspace -> `409` (spoof guard — you cannot claim
  someone else's bubbles). Same-account re-registration succeeds and updates the
  label.

Response `200`:

```jsonc
{
  "workspaceId": "wsp_...",
  "sourceProjectId": "proj_...",
  "accountId": "acc_...",           // the caller — registration is always self
  "label": "..."                    // null when not provided
}
```

Registration is a display/attribution aid, never authorization: events push and
pull exactly the same with or without it (opacity invariant #4 untouched).

### `GET /v1/workspaces/:workspaceId/timeline`

Browser/API read surface for the workspace Timeline (H060). The gateway
authenticates, applies the same membership ACL as the roster, and forwards to
the internal headless replica, which pulls the `wsp_` union and projects
memories. Any member may read; non-member/unknown -> `404`.

- **Query:** `limit`? — newest N items, chronological display order preserved.
- **Labeling (canvas chat grammar — bubble unit = member):** the gateway
  resolves each item's `member` to the owning account's **email**, through the
  source-store registry first (client-synced events) and the membership roster
  second (Hub-authored events). Registered labels replace `sourceProjectLabel`.
  `writer` stays the raw agent actor (`codex`, `claude`, …) as bubble metadata,
  except when it is itself an account id (Hub web-authored events). Items whose
  provenance resolves to nothing pass through unlabeled.

Response `200`: `{ "storeId": "...", "pulled": {...}, "items": [ { "id", "at",
"type", "kind", "text", "salience", "member", "writer"?, "sourceProjectId"?,
"sourceProjectLabel"?, "tags"? } ] }`.

### `POST /v1/workspaces/:workspaceId/invites`

Owner mints a revocable, optionally-expiring, **multi-use** invite. Always grants
`member` (there is no owner-by-invite; promote later via role-change). **First
successful mint flips the store's `inviteReachable` to `true`** (private ->
shared).

- **Auth:** owner (member-not-owner -> `403`); non-member/unknown -> `404`.
- **Body:** `{ "maxUses"?: number | null, "expiresAt"?: "<ISO-8601>" }` —
  `maxUses` omitted/`null` = unlimited; `maxUses <= 0` -> `400`. `expiresAt`
  omitted = never expires; a non-future `expiresAt` -> `400`.

Response `201`:

```jsonc
{
  "inviteId": "inv_...",
  "token": "...",                   // the join capability; shown ONCE, never re-served
  "joinUrl": "https://.../join?token=...",
  "role": "member",
  "maxUses": null,                  // echo of the effective policy
  "expiresAt": "2026-07-08T00:00:00Z"  // may be null
}
```

The token grants **join** (become a member), not data access — data access comes
only from membership after an authenticated join, per account (SoT-020). It is a
locator, not a durable secret.

### `GET /v1/workspaces/:workspaceId/invites`

Owner lists outstanding invites (to audit or find an `inviteId` to revoke). The
`token` is **never** echoed here — it is shown once, at mint.

- **Auth:** owner -> `200`; member-not-owner -> `403`; non-member/unknown -> `404`.

Response `200`:

```jsonc
{
  "invites": [
    {
      "inviteId": "inv_...",
      "maxUses": null,              // null = unlimited
      "usedCount": 2,
      "expiresAt": "2026-07-08T00:00:00Z",  // may be null
      "revokedAt": null,           // set => dead
      "createdAt": "2026-07-01T00:00:00Z"
    }
  ]
}
```

### `DELETE /v1/workspaces/:workspaceId/invites/:inviteId`

Owner revokes an invite. Idempotent: revoking an already-revoked or already-
exhausted invite still returns `204` (the invite is dead either way). Revocation
does **not** flip `inviteReachable` back — a store that was ever shared stays
shared.

- **Auth:** owner -> `204`; member-not-owner -> `403`; unknown `inviteId` or
  workspace, or non-member -> `404`.

### `POST /v1/workspaces/join`

Redeem an invite for the calling account (CLI/key path).

- **Auth:** unscoped, non-`read_only` (join is a mutation).
- **Body:** `{ "token": "..." }` (missing -> `400`).

On success adds the caller as `member`, increments the invite's `usedCount`, and
returns the discovery shape:

```jsonc
{ "workspaceId": "wsp_...", "eventsUrl": "/v1/projects/wsp_.../events", "role": "member" }
```

- Unknown / revoked / expired / **`usedCount >= maxUses`** token -> `403`.
- **Already a member** -> `200` (idempotent), returning the existing membership;
  does **not** consume a use.

### `GET /join?token=...`  (browser landing)

The human-facing wrapper of the join capability (from a shared `joinUrl`). Serves
an HTML page:

- If the visitor has no session -> Google OAuth login, then return here.
- With a session -> redeem the token exactly as `POST /v1/workspaces/join` does
  (`via: "session"`), then show a success page naming the workspace and how to
  bind a local folder to it.
- Unknown / revoked / expired / exhausted token -> a `403` page (not a raw JSON
  body). Not configured for OAuth -> `503` (mirrors `/account`, `/admin`).

The token is the same capability as the API path; a user may redeem via either.

### `PATCH /v1/workspaces/:workspaceId/members/:accountId`

Owner changes a member's role (promote `member` -> `owner`, or demote). This is
how ownership is **transferred** (promote a member, then leave).

- **Auth:** owner -> `200`; member-not-owner -> `403`; non-member/unknown
  workspace, or unknown `:accountId` -> `404`.
- **Body:** `{ "role": "owner" | "member" }` (other value -> `400`).
- **Last-owner invariant:** demoting the **sole** remaining `owner` -> `409`
  (promote another member first). Promoting is always allowed.

Response `200`: `{ "accountId": "acc_...", "role": "owner" }`.

### `DELETE /v1/workspaces/:workspaceId/members/:accountId`

Remove a member. **Two authorized callers:**

- an **owner** removing anyone, or
- **any member removing themselves** (`:accountId` == caller) — self-leave.

Any other caller -> `403`; non-member/unknown workspace or unknown `:accountId`
-> `404`. Removal revokes the account's future access; already-pulled bytes are
not recallable (SoT-040/050).

- **Last-owner invariant:** removing (or self-leaving as) the **sole** remaining
  `owner` while other members exist -> `409` (transfer ownership first, or delete
  the workspace). A sole owner who is also the **only** member may leave — that is
  equivalent to deleting an empty workspace and returns `204`.
- Idempotent: removing an account that is not a member -> `404` (it was never
  there) — a prior successful removal is thus not silently masked.

Success -> `204`.

### `PATCH /v1/workspaces/:workspaceId`

Owner renames the workspace (display metadata only, never identity — the `wsp_`
id is immutable).

- **Auth:** owner -> `200`; member-not-owner -> `403`; non-member/unknown -> `404`.
- **Body:** `{ "name": "..." | null }` — a string (<= 200 chars, else `400`) sets
  the name; `null` or an empty/whitespace string clears it back to untitled.

Response `200`: `{ "workspaceId": "wsp_...", "name": "..." | null }`.

### `DELETE /v1/workspaces/:workspaceId`

Owner deletes the workspace: drops all memberships and invites (control-plane
rows), revoking every member at once. This is the terminal an owner uses to tear
a workspace down wholesale — distinct from the last-owner invariant on member
removal, which only stops an owner from *orphaning* a workspace that still has
members. Deleting one outright is always allowed for an owner.

- **Auth:** owner -> `204`; member-not-owner -> `403`; non-member/unknown ->
  `404`.
- The relay's `wsp_…/events.ndjson` log is **not** deleted by this call — the
  relay has no delete route and deletion is a separate ops/retention concern
  ([[H010]]). After control-plane deletion the log is orphaned (unreachable via
  the gateway, since no membership resolves it) until retention reclaims it.

---

## Data-plane authorization (opaque relay events route)

For a `wsp_…` id the gateway enforces **membership-coarse** ACL on
`POST/GET /v1/projects/:wsp_…/events` — it never parses payloads (opacity
invariant #4):

1. The calling account is a **member**, else `403`.
2. A **scoped** key additionally must list this `wsp_` in its scope
   ([`README.md`](./README.md) §3), else `403`.
3. `POST` (publish) requires a **non-`read_only`** key, else `403`. Any member may
   publish — there is no per-item publish permission (SoT-040: membership =
   publish).
4. `GET` (pull) returns the full union of all members' events, in insertion
   order. The client rebuilds its consolidated view locally and does final
   ranking (SoT-060).

**Owner-only *global* retract is enforced at projection, not the relay.** A
retraction is just another append-only event (SoT-050); the opaque relay cannot
tell it apart and the gateway will not parse it. The rule "only an owner may
retract *another* writer's assertion" is honoured **client-side at projection
time**, keyed on the retract event's `writer` role — not at write time.

## Encryption axis (at-rest, not E2E — Hub SoT [[H070]])

Workspace shared memory **must not require** the `__enc` E2E envelope: the server
needs plaintext to consolidate shared memory once for everyone (SoT-070). So v1
workspace payloads travel **plaintext-to-server** (encrypted at rest by the
server, which *is* the trust boundary here). Personal / private-project sync MAY
still use the E2E envelope; a workspace that later opts into E2E forgoes
server-side consolidation. "OAuth authenticated the account" does not mean "the
server cannot read this" — it can, by design.

## Client responsibility (the one hard boundary)

The gateway sees accounts and membership but not event *scope* (payloads are
opaque). So the memorize client MUST enforce the SoT-010 hard boundary itself:
**never push personal-scoped or cross-account-private events into a `wsp_…`
log.** Only project-scoped memory is publishable to a workspace; the personal
store is the sole thing excluded from workspace push (SoT-040) — the same leak
boundary the client already owns for personal sync (memorize #181).

## Deferred (not v1 wire)

Server-side consolidated-view generation + a coarse-recall workspace *query*
endpoint (the cloud-MCP exception mode for corpora too large to replicate,
SoT-060/900), and E2E for workspace shared memory (envelope encryption +
device-keypair enrollment, gated on a recovery policy, SoT-070/900). The v1
workspace data-plane is the opaque events route and nothing more.
