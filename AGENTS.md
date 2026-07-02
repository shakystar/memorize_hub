# memorize_hub - Agent Guide

## What this is

`memorize_hub` is the **optional relay server** for [memorize](../memorize)'s
P3-b-2 cross-machine auto sync. It is a **dumb store-and-forward** queue: it
holds opaque per-project event logs so machines that do **not** share a
filesystem can auto-sync over the network.

It is the network sibling of memorize's `file` transport (a shared cloud-sync
folder). Same model - origin pushes, relay holds, replica pulls later - just
over HTTP instead of a shared directory.

**Read [`PROTOCOL.md`](./PROTOCOL.md) first** - it is the authoritative wire
contract this server implements and the memorize client speaks. Do not change
the wire shape here unilaterally; it is shared with the memorize repo.

## Relationship to memorize

- Sibling repo: `../memorize` (the CLI/client; client transport at
  `src/adapters/sync-transport-http.ts`).
- memorize is **local-first**: the relay is always optional. A memorize install
  with no configured relay never talks to this server. Nothing here may become
  a hard dependency of memorize.
- The convergence/projection/CRDT logic lives entirely in memorize clients. The
  relay does **none** of it - it only stores and forwards opaque events.

## Design direction (decided 2026-06-08)

- **Runtime:** Node `node:http` - **zero runtime dependencies**, vendor-neutral.
  Mirror memorize's no-framework, std-lib-first style (it uses better-sqlite3 +
  plain node, no express/fastify).
- **Storage:** **ndjson on disk**, one append-only file per project
  (`<store>/<projectId>/events.ndjson`) - same layout memorize's file transport
  uses. Durable across restarts, dedup by id on append, trivial to inspect.
  (An in-memory map is fine for the very first spike, but ship ndjson.)
  On boot, rebuild each project's dedup index (seen-id `Set`) by scanning its
  `events.ndjson` - the file is the only durable state.
- **Auth:** **optional bearer token** via env (e.g. `MEMORIZE_RELAY_TOKEN`).
  Unset = open (localhost/trusted dev). Set = `401` gate on every route.
- **Concurrency:** serialize appends per project (file lock or per-project async
  queue) so concurrent pushes can't interleave ndjson lines.

## Decisions (2026-06-12)

Distilled from the post-v1 design conversation (cross-repo position lives in
this repo's discussions; follow-up to memorize#92 "write at the edge, read
everywhere"). Binding on future work here:

> **Update (2026-06-26) - Hub umbrella monorepo.** The repo is now a pnpm
> monorepo: `packages/relay` (this transport layer, kept byte-for-byte and
> isolated) + `packages/gateway` (a new control-plane). The bullets below still
> bind, with one clarification: "not in the relay" means **not in the relay
> *package***, not "not in this repo." The gateway is the home for the auth
> ladder's later rungs (project-scoped API keys - built), OAuth/identity, the
> beta access-request page (built), TLS-terminating public edge, and the
> users/tokens/ACL DB (built, better-sqlite3, no event data). It calls the relay
> as a separate process over HTTP with the internal token - never importing
> `EventStore`. The relay package stays zero-dep, opaque, and transport-only.

- **Transport layer only.** This repo is the Hub's *transport layer*. The #92
  read surface (remote MCP endpoint, dashboards, multi-user identity) will be
  a separate **headless memorize replica that consumes this relay** - never
  grow projection, query, or MCP features here. The relay must never learn the
  memory taxonomy (short-term observations vs consolidated memories are just
  opaque lines); that is what lets the client schema evolve without touching
  the relay.
- **Auth ladder.** v1 = single shared bearer token (a capability, not an
  identity; deploy-key model). Step 2, triggered by the first second person
  sharing a relay: per-project token scoping. OAuth/identity belongs to the
  headless replica's MCP endpoint (trigger: the first claude.ai consumer) and
  is **never built into the relay** - the replica authenticates users and
  holds the relay token internally. TLS termination also stays outside
  (reverse proxy); the relay speaks plain HTTP.
- **Crash consistency is a shared contract, not a relay feature.** Hydration
  skips a torn final ndjson line; the client's push watermark advances only on
  a 200, so a lost tail is re-pushed at the next boundary and dedup absorbs
  it. This loop - not fsync - is why the relay claims no-data-loss. Do not
  "fix" the torn-line skip into an error.
- **Data plane = per-project files; control plane = small shared DB (future,
  not here).** Per-project ndjson keeps concurrent pushes contention-free
  across projects and makes ops file-grained (backup/clone/delete/retention =
  file ops). A single shared table would couple unrelated projects' write
  locks and index growth for zero benefit - memorize has no cross-project
  queries by design. If the read surface ever needs a shared DB, it holds
  only users/tokens/ACL, never event data.
- **Project/event id alignment across machines** (true-replica, memorize#30):
  replicas adopt the origin's `proj_` id via `project clone`; event ids are minted
  once globally-unique. **Update (2026-07-01, SoT):** the *remote store* id is now
  **server-minted** by the gateway (`wsp_…`/`psm_…`), and `proj_` is demoted to a
  provenance label inside events (memorize SoT-020, Hub SoT H050). The **relay**
  still keys by whatever path id it is handed and needs no mapping layer; the
  **gateway** holds the account↔store mapping. See `docs/SoT/`.
- **Scale path for the store, when needed (not before):** lazy per-project
  hydration instead of boot scan -> seen-id Set + file-offset index with
  streamed pulls -> retention/compaction (roadmap). Never a DB migration.

## Configuration (env)

| Variable | Default | Meaning |
|---|---|---|
| `MEMORIZE_RELAY_PORT` | `8787` | listen port |
| `MEMORIZE_RELAY_STORE` | `./data` | root dir for `<store>/<projectId>/events.ndjson` |
| `MEMORIZE_RELAY_TOKEN` | unset | bearer token; unset = open (localhost/trusted dev) |
| `MEMORIZE_RELAY_MAX_BODY` | `10485760` (10 MiB) | request body cap; over -> `413` |

## Scaffolding (mirror memorize)

TypeScript ESM (`"type": "module"`), Node >= 22, pnpm, `tsc` build / `tsx` dev /
`vitest` tests / `eslint` + typescript-eslint - the same toolchain as
`../memorize`. "Zero runtime dependencies" still stands; dev-dependencies are
fine.

## Invariants (non-negotiable - see PROTOCOL.md §"Invariants")

1. Append-only - never mutate/drop a stored event.
2. Order-preserving - pull returns insertion order.
3. Idempotent - dedup by `event.id` on write; re-pull is safe.
4. Opaque payloads - depend on nothing but `event.id`.

## Roadmap

- **v1** - `node:http` server, ndjson-on-disk store-and-forward, optional bearer
  token, `POST/GET /v1/projects/:id/events` + `/healthz`. Implements PROTOCOL.md.
- **gateway v0** (2026-06-26, `packages/gateway`) - control-plane: control-plane
  DB (users/tokens/ACL), **project-scoped API keys** (per-project token scoping,
  done in the gateway not the relay), ACL reverse proxy that injects the relay's
  internal token, public **beta access-request page** + `hub-gateway-admin`
  manual-approval CLI (both retired since - onboarding is git-style
  `memorize login`/`clone`, and `/admin` is the only operator surface), and a
  two-replica async-convergence e2e through the gateway.
- **M4 (done)** - operator **OAuth login + dashboard** (`/admin`) + participant
  self-service (`/account`), browser approval UI, per-key project scoping +
  read-only keys. Decision resolved: **Google OAuth (OIDC)** (one client, one
  `/oauth/callback`, backs both flows). Revised from GitHub OAuth so non-developer
  participants are not gated on having a GitHub account; email is the identity
  anchor + admin allowlist key, provider is generic (`provider_sub`).
- **M5 (done, infra)** - **public deploy** on **Fly.io** (decision resolved):
  gateway (public, TLS-terminated) + relay (internal-only, token-gated) in one
  Docker image, durable `/data` volume, CI continuous deploy + live smoke test;
  public at `https://memorize-hub-shakystar.fly.dev`. See `docs/DEPLOY.md`.
  *Remaining (validation, not build):* onboard the first real beta participant,
  measure real cross-device async convergence over the live Hub.
- **Personal-memory store (done, 2026-06-30, #32)** - per-account, owner-only
  `psm_` store + `GET /v1/account/personal-store` discovery; the gateway-side
  enforcement of the personal-vs-project isolation (memorize#181). Client side
  tracked in memorize#213.
- **Shared workspace (designed 2026-07-01, rebuild pending)** - cross-account
  union sync: server-minted `wsp_…` stores, membership/roles/invites in the
  gateway (`POST /v1/workspaces` + invite/join + `GET /v1/account/workspaces`),
  data over the opaque events route (relay unchanged). Architecture in
  `docs/SoT/` (H020/H040/H050/H060/H080); wire in `docs/protocol/workspace.md`
  (full endpoint set: create/invite/join/roster/role-change/leave/delete). The
  gateway is being rebuilt clean (new package + ported core); relay untouched.
- **Later** - retention/compaction policy, and a **realtime push channel**
  (SSE/websocket) for memorize P3-c (cross-machine live watermark deltas, not
  just poll-on-boundary).

## Verifying against the contract

The memorize repo has an in-test reference relay
(`memorize/tests/harness/relay-stub.ts`) implementing this exact contract, plus
a golden round-trip (`tests/golden/sync-roundtrip-http-golden.test.ts`). Use it
as the behavioral reference. End-to-end validation = point a real memorize
client at this server (`memorize project sync --push --remote-url <url>` then
`project clone <id> --remote-url <url>` on a second machine) and confirm events
converge.
