# Store resolution (server-minted ids)

> Every remote store id is **server-minted by the gateway** (memorize SoT-020 /
> Hub SoT [[H050]]); the client never uses its local `proj_…` as the path id. This
> doc is the map from "what the client wants to sync" to "which discovery endpoint
> mints/returns the store id it then syncs via the events route"
> ([`transport.md`](./transport.md)). A bare relay serves **none** of these
> resolution endpoints — only the events route, for an id you already hold.

Three resolution surfaces:

| Want | Endpoint | Returns | Detail |
|---|---|---|---|
| **Personal memory** | `GET /v1/account/personal-store` | `psm_…` | [`personal-store.md`](./personal-store.md) |
| **Private project** | `POST /v1/workspaces` | `wsp_…` (`inviteReachable:false`, 1 member) | [`workspace.md`](./workspace.md) |
| **Shared workspace** | the same `wsp_…`, grown to N members | `wsp_…` | via invite/join, [`workspace.md`](./workspace.md) |
| **Discover mine** | `GET /v1/account/workspaces` | list of `wsp_…` | includes private (1-member) and shared |

## A private project is a degenerate workspace

There is **one** store mechanism. `POST /v1/workspaces` always mints a
`wsp_…` with `inviteReachable:false` and the caller as sole `owner` — that *is* a
private project (Hub SoT [[H040]]: project = degenerate workspace). It becomes a
shared workspace the moment its owner mints the first invite (the store flips to
`inviteReachable:true`; see [`workspace.md`](./workspace.md)). So the client does
not choose "private vs shared" at creation — it is a consequence of whether anyone
was ever invited.

`GET /v1/account/workspaces` returns both kinds; `inviteReachable` + `memberCount`
on each entry let the client distinguish a still-private project from a shared
workspace.

## Local binding stays client-side

The client binds a local folder to a resolved store id and keeps that mapping
**locally** — `folderIdentity` (git origin / root commit / repo-relative path) is
a local discovery hint, **never** sent as identity (memorize SoT-020, Hub SoT
[[H040]]). The Hub knows only `membership(account <-> store)`, never which folder
on which machine.

## Why server-minted (Hub SoT [[H050]])

When users A and B each upload their already-populated DBs into one workspace, a
client-minted id would collide (both have their own `proj_…` root). The shared
store must therefore be a **server-minted `wsp_…`**, and each side's `proj_…`
stays a provenance label inside the events (`sourceProjectId`) — never rewritten,
never a routing key. That is what makes cross-account join-and-merge safe without
folding two histories into one id.
