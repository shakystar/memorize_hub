# memorize_hub Wire Protocol (v1)

> **Authoritative source of truth** for the HTTP contract shared by the
> `memorize` client (`src/adapters/sync-transport-http.ts`) and this Hub. Both
> sides implement these documents. Versioned under `/v1`. The top-level
> [`../../PROTOCOL.md`](../../PROTOCOL.md) is a thin index that points here.

The contract splits by **surface**, not by one giant file, because the
control-plane now carries 10+ endpoints and the cross-cutting rules below must be
stated **once** instead of re-derived per endpoint (which is how error cases went
missing in the single-file draft).

| Document | Surface | Plane |
|---|---|---|
| [`transport.md`](./transport.md) | `POST/GET .../events`, `/healthz`, E2E envelope | relay (transport) |
| [`store-resolution.md`](./store-resolution.md) | server-minted store ids, discovery overview | gateway (control) |
| [`personal-store.md`](./personal-store.md) | `psm_` per-account personal memory | gateway (control) |
| [`workspace.md`](./workspace.md) | `wsp_` create / invite / join / membership / roles | gateway (control) |
| [`device-auth.md`](./device-auth.md) | `POST /v1/device/code` · `/device` · `POST /v1/device/token` (browser device login) | gateway (control) |

`transport.md` is the only surface a **bare relay** (no gateway) serves. The rest
are gateway control-plane; a relay knows nothing of accounts, stores, or prefixes
(Hub SoT [[H010]]).

---

## Conventions (bind on every endpoint below)

Stated here once; each surface doc references this section instead of repeating
it. When a surface doc is silent on auth, status, or existence-leak, **this
section is the answer.**

### 1. Identifiers and namespaces (Hub SoT [[H050]])

Every path id MUST match `^[A-Za-z0-9_-]{1,128}$`. Anything else -> `400`, before
touching storage (the id becomes a relay filesystem path component, so this also
closes path traversal). All server-minted ids conform by construction.

| Prefix | Kind | Minted by | Is a relay path id? |
|---|---|---|---|
| `acc_` | account (OAuth root) | gateway | no (control-plane id) |
| `psm_` | personal store | gateway | yes |
| `wsp_` | project/workspace store (1-member = private, N-member = shared) | gateway | yes |
| `inv_` | invite | gateway | no |
| `tok_` | API key id | gateway | no |
| `proj_` | **client** local project identity + provenance | memorize client | **no** — travels as `sourceProjectId` *inside* events, never as a path id |

**Reserved namespaces.** The gateway refuses to grant, clone, or create an
access request for a `psm_`/`wsp_`/`inv_`-shaped id as if it were a plain project
— a store's kind is fixed at mint time and never reinterpreted.

### 2. Principal and auth axes (Hub SoT [[H030]])

Every gateway endpoint resolves the caller to a single **principal**:

```
principal = { accountId: "acc_…", via: "key" | "session", readOnly: bool, scoped: bool }
```

- **`via: "key"`** — `Authorization: Bearer <mzk_…>`. A key resolves to exactly
  one `accountId` (memorize SoT-020). This is the CLI/agent path.
- **`via: "session"`** — a browser OAuth session cookie, resolving to one
  `accountId`. This is the `/account`, `/admin`, and `/join` web path.

`authorize(principal, resource, action)` is the single policy gate: **resource** is
a store (`psm_`/`wsp_`) or a control object (workspace / invite / membership);
**action** is `read` (pull), `write` (push / mutate), or `admin` (manage
membership, mint/revoke invites, delete). The gateway never parses event payloads
— authorization is **coarse** (metadata only), by construction (SoT-060, [[H010]]).

### 3. `read_only` x scope matrix

Two orthogonal key attributes narrow — never widen — what a key may do. Both
default to "off" (a plain key is read-write and unscoped).

| Attribute | Effect |
|---|---|
| **`read_only`** | The key may perform **reads only, on both planes**: data-plane `GET .../events` (pull) and control-plane `GET` discovery/roster. It may NOT push events *or* perform any control-plane mutation (create / invite / join / revoke / remove / role-change / leave / delete) -> `403`. A read-only key is a pull-only agent capability. |
| **scoped** (`token_scopes` non-empty) | A **data-plane-only** capability, narrowed to the specific store ids it lists. It may pull/push **only** those `wsp_` stores (still `∩` membership), reaches **no** personal store, and reaches **no** control-plane management endpoint -> `403`. Management (create/join/discover/roster/member-admin) and personal memory require an **unscoped** key. |

Rationale: a scoped key that could create a workspace would mint one it then
can't reach (not in its scope) — so management is unscoped-only, mirroring the
personal-store rule. `read_only` is the read/write axis; scope is the
which-stores axis; they compose by intersection (SoT [[H030]]).

### 4. Status codes (global)

| Code | When |
|---|---|
| `200` | success (idempotent no-op included) |
| `201` | resource created (workspace, invite) |
| `204` | success, no body (revoke, remove, delete) |
| `400` | malformed JSON / invalid id format / missing required field |
| `401` | auth required and key/session missing or invalid |
| `403` | authenticated but not permitted (role/`read_only`/scope denies a **visible** resource) |
| `404` | unknown route, or a resource the caller may not even observe (see §5) |
| `409` | conflict — the mutation violates an invariant (last-owner removal/demote) |
| `413` | request body exceeds the size limit |
| `5xx` | relay- or gateway-side failure |

Error body is always `{ "error": "<human message>" }`. Any non-2xx makes the
memorize client throw; its never-throw auto-sync gate degrades that to a deferred
no-op and retries at the next boundary, so transient outages are invisible and
self-healing — never data loss (events stay in the local append-only log until a
push succeeds).

### 5. `403` vs `404` — existence-leak policy

Uniform rule so it is intentional, not per-endpoint accident:

- **Control-plane workspace resources** (`/v1/workspaces/:id/…`): you must be a
  **member** to observe the resource at all. Non-member **or** unknown id ->
  `404` (identical response; a non-member cannot confirm a workspace exists).
  Member-but-insufficient-role (e.g. a `member` attempting an owner action) ->
  `403`. Invalid id format -> `400`.
- **Data-plane events route** (`/v1/projects/:storeId/events`): a store-level
  access denial (not a member of the `wsp_`, or not the owner of the `psm_`) ->
  `403`, matching the established personal-store convention. The events route is a
  generic relay proxy; `403` = "you cannot access this store."

Server-minted ids are unguessable, so `404` for non-members leaks nothing while
giving cleaner client behaviour.

### 6. Two client audiences

The same capability is reachable two ways, and both are first-class:

- **CLI / agent** holds an **API key** (`via: "key"`) and drives every route as
  JSON over HTTPS.
- **Browser** holds an **OAuth session** (`via: "session"`) for `/account`,
  `/admin`, and the **`/join?token=…` invite landing** — the human-facing
  redeem path that wraps the same join capability as
  `POST /v1/workspaces/join` (see [`workspace.md`](./workspace.md)).

### 7. Planes stay separate (Hub SoT [[H010]])

The **relay** stores opaque, append-only, order-preserving event logs keyed only
on `event.id`; it is prefix-blind and never learns accounts, membership, or store
kinds. The **gateway** owns identity / keys / membership / invites and
reverse-proxies the relay with an internal token. They are separate processes
talking only over HTTP. No gateway authorization ever depends on a payload field.

### 8. Onboarding, and the entitlements seam (forward-compat)

v1 has **no beta gate**: any account that authenticates (OAuth session, or a key
it self-minted at `/account`) may create workspaces and sync. The legacy
per-project access-request + manual-approval flow is **retired** — `project_acl`
grants are replaced entirely by workspace membership ([[H040]], superseding its
"access_requests kept" line).

A **billing model (free / team / pro)** is planned but **deliberately deferred**:
finish the core control-plane first, then layer tiers on top — *a sequencing
choice, not a scope cut*. Billing is, structurally, **permission separation +
quotas** — an *entitlements* concern — so it plugs into the **same
`authorize(principal, resource, action)` gate** (§2), never scattered across
handlers:

- the principal already carries `accountId`; a future `plan = planOf(accountId)`
  lookup is purely additive;
- tier limits (max workspaces per account, max members per workspace, read-only
  seats, retention window) become **quota checks inside `authorize`**, returning
  `403`/`409` with a machine-readable reason;
- no endpoint shape changes — entitlements narrow existing actions, exactly as
  `read_only` / scope already do (§3).

Keeping every "can this account do this, and how much" decision in one policy
layer is what lets billing land as an additive layer, not a rewrite. Until then,
`plan` is implicitly unlimited for every account.
