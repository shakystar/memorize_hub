# memorize_hub — Agent Guide

## What this is

`memorize_hub` is the **optional relay server** for [memorize](../memorize)'s
P3-b-2 cross-machine auto sync. It is a **dumb store-and-forward** queue: it
holds opaque per-project event logs so machines that do **not** share a
filesystem can auto-sync over the network.

It is the network sibling of memorize's `file` transport (a shared cloud-sync
folder). Same model — origin pushes, relay holds, replica pulls later — just
over HTTP instead of a shared directory.

**Read [`PROTOCOL.md`](./PROTOCOL.md) first** — it is the authoritative wire
contract this server implements and the memorize client speaks. Do not change
the wire shape here unilaterally; it is shared with the memorize repo.

## Relationship to memorize

- Sibling repo: `../memorize` (the CLI/client; client transport at
  `src/adapters/sync-transport-http.ts`).
- memorize is **local-first**: the relay is always optional. A memorize install
  with no configured relay never talks to this server. Nothing here may become
  a hard dependency of memorize.
- The convergence/projection/CRDT logic lives entirely in memorize clients. The
  relay does **none** of it — it only stores and forwards opaque events.

## Design direction (decided 2026-06-08)

- **Runtime:** Node `node:http` — **zero runtime dependencies**, vendor-neutral.
  Mirror memorize's no-framework, std-lib-first style (it uses better-sqlite3 +
  plain node, no express/fastify).
- **Storage:** **ndjson on disk**, one append-only file per project
  (`<store>/<projectId>/events.ndjson`) — same layout memorize's file transport
  uses. Durable across restarts, dedup by id on append, trivial to inspect.
  (An in-memory map is fine for the very first spike, but ship ndjson.)
  On boot, rebuild each project's dedup index (seen-id `Set`) by scanning its
  `events.ndjson` — the file is the only durable state.
- **Auth:** **optional bearer token** via env (e.g. `MEMORIZE_RELAY_TOKEN`).
  Unset = open (localhost/trusted dev). Set = `401` gate on every route.
- **Concurrency:** serialize appends per project (file lock or per-project async
  queue) so concurrent pushes can't interleave ndjson lines.

## Decisions (2026-06-12)

Distilled from the post-v1 design conversation (cross-repo position lives in
this repo's discussions; follow-up to memorize#92 "write at the edge, read
everywhere"). Binding on future work here:

- **Transport layer only.** This repo is the Hub's *transport layer*. The #92
  read surface (remote MCP endpoint, dashboards, multi-user identity) will be
  a separate **headless memorize replica that consumes this relay** — never
  grow projection, query, or MCP features here. The relay must never learn the
  memory taxonomy (short-term observations vs consolidated memories are just
  opaque lines); that is what lets the client schema evolve without touching
  the relay.
- **Auth ladder.** v1 = single shared bearer token (a capability, not an
  identity; deploy-key model). Step 2, triggered by the first second person
  sharing a relay: per-project token scoping. OAuth/identity belongs to the
  headless replica's MCP endpoint (trigger: the first claude.ai consumer) and
  is **never built into the relay** — the replica authenticates users and
  holds the relay token internally. TLS termination also stays outside
  (reverse proxy); the relay speaks plain HTTP.
- **Crash consistency is a shared contract, not a relay feature.** Hydration
  skips a torn final ndjson line; the client's push watermark advances only on
  a 200, so a lost tail is re-pushed at the next boundary and dedup absorbs
  it. This loop — not fsync — is why the relay claims no-data-loss. Do not
  "fix" the torn-line skip into an error.
- **Data plane = per-project files; control plane = small shared DB (future,
  not here).** Per-project ndjson keeps concurrent pushes contention-free
  across projects and makes ops file-grained (backup/clone/delete/retention =
  file ops). A single shared table would couple unrelated projects' write
  locks and index growth for zero benefit — memorize has no cross-project
  queries by design. If the read surface ever needs a shared DB, it holds
  only users/tokens/ACL, never event data.
- **Project/event id alignment across machines is already solved client-side**
  (true-replica, memorize#30): replicas adopt the origin's projectId via
  `project clone`, event ids are minted once globally-unique. The relay keys
  by path id and needs no mapping layer.
- **Scale path for the store, when needed (not before):** lazy per-project
  hydration instead of boot scan → seen-id Set + file-offset index with
  streamed pulls → retention/compaction (roadmap). Never a DB migration.

## Configuration (env)

| Variable | Default | Meaning |
|---|---|---|
| `MEMORIZE_RELAY_PORT` | `8787` | listen port |
| `MEMORIZE_RELAY_STORE` | `./data` | root dir for `<store>/<projectId>/events.ndjson` |
| `MEMORIZE_RELAY_TOKEN` | unset | bearer token; unset = open (localhost/trusted dev) |
| `MEMORIZE_RELAY_MAX_BODY` | `10485760` (10 MiB) | request body cap; over → `413` |

## Scaffolding (mirror memorize)

TypeScript ESM (`"type": "module"`), Node >= 22, pnpm, `tsc` build / `tsx` dev /
`vitest` tests / `eslint` + typescript-eslint — the same toolchain as
`../memorize`. "Zero runtime dependencies" still stands; dev-dependencies are
fine.

## Invariants (non-negotiable — see PROTOCOL.md §"Invariants")

1. Append-only — never mutate/drop a stored event.
2. Order-preserving — pull returns insertion order.
3. Idempotent — dedup by `event.id` on write; re-pull is safe.
4. Opaque payloads — depend on nothing but `event.id`.

## Roadmap

- **v1** — `node:http` server, ndjson-on-disk store-and-forward, optional bearer
  token, `POST/GET /v1/projects/:id/events` + `/healthz`. Implements PROTOCOL.md.
- **Later** — retention/compaction policy, per-project token scoping, TLS/deploy
  guide, and a **realtime push channel** (SSE/websocket) for memorize P3-c
  (cross-machine live watermark deltas, not just poll-on-boundary).

## Verifying against the contract

The memorize repo has an in-test reference relay
(`memorize/tests/harness/relay-stub.ts`) implementing this exact contract, plus
a golden round-trip (`tests/golden/sync-roundtrip-http-golden.test.ts`). Use it
as the behavioral reference. End-to-end validation = point a real memorize
client at this server (`memorize project sync --push --remote-url <url>` then
`project clone <id> --remote-url <url>` on a second machine) and confirm events
converge.
