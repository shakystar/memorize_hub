# CLAUDE.md

This file orients Claude Code when working in the `memorize_hub` repo.

## Start here

Read **[`AGENTS.md`](./AGENTS.md)** (what this is, design direction, roadmap)
and **[`PROTOCOL.md`](./PROTOCOL.md)** (the authoritative HTTP wire contract).

## One-line

memorize_hub is the **"Hub" pnpm monorepo** for [memorize](../memorize)'s
P3-b-2 cross-machine auto sync. Two packages:

- **`packages/relay`** - the **optional relay server**: a dumb store-and-forward
  queue of opaque per-project event logs over HTTP (the original v1; unchanged).
- **`packages/gateway`** - the **control-plane** that fronts the relay: public
  edge, project-scoped API-key auth + ACL, beta access-request page, and a
  reverse proxy that injects the relay's internal token.

The sibling `memorize` repo holds the client.

## Key constraints

- **Implement `PROTOCOL.md` exactly.** It is shared with the memorize client; do
  not change the wire shape here without changing it there too.
- **The relay (`packages/relay`) stays dumb and isolated**: store + forward
  opaque events, dedup by `event.id`, preserve order, append-only. **Zero
  runtime deps, `node:http`, ndjson-on-disk, optional bearer token.** No
  projection, identity, or conflict resolution - that all lives in memorize
  clients (or, for access control, in the gateway). Never mix identity into the
  relay package.
- **The gateway (`packages/gateway`) is a separate component**: it MAY take
  runtime deps (e.g. `better-sqlite3`) and calls the relay as a separate process
  over HTTP, never importing its `EventStore`. Its DB holds only
  users/tokens/ACL - never event data.
- memorize is **local-first**: the relay is always optional and must never
  become a hard dependency of memorize.

## Status

- **relay** - v1 (2026-06-12), now at `packages/relay`: `node:http` server, ndjson
  store, env config, vitest unit + HTTP contract tests. Reference behavior lives in
  `../memorize/tests/harness/relay-stub.ts` + the golden round-trip there.
- **gateway** - `packages/gateway`: control-plane DB (better-sqlite3),
  project-scoped API keys, ACL reverse proxy, beta access-request page,
  `hub-gateway-admin` CLI (manual approval), and a two-replica async-convergence
  e2e through the gateway (`pnpm --filter @shakystar/memorize-hub-gateway e2e`).
  - **M4 done** - GitHub-OAuth operator dashboard (`/admin`) + participant
    self-service (`/account`), per-key project scoping + read-only keys.
  - **M5 done (infra)** - deployed live on Fly.io
    (`https://memorize-hub-shakystar.fly.dev`): gateway public + TLS, relay
    internal-only + token-gated, durable `/data` volume, CI continuous deploy +
    smoke test. See `docs/DEPLOY.md`.
  - **Personal-memory store** (2026-06-30, #32) - per-account owner-only `psm_`
    store + `GET /v1/account/personal-store` discovery; client side tracked in
    memorize#213.
  - **Remaining** - M5 *validation* only (onboard a real beta participant,
    measure live cross-device convergence); then "Later": relay
    retention/compaction, realtime SSE push (memorize P3-c).

Root `pnpm -r check` = typecheck + lint + test across both packages.

**Scope note (revised 2026-06-26):** this repo is the **Hub umbrella** =
`packages/relay` (transport) + `packages/gateway` (control-plane / the #92 read
surface's auth+request layer). The relay *package* remains transport-only - keep
projection/query/MCP/identity out of it. The remote MCP read surface (dashboards,
multi-user queries over event data) is still a separate headless memorize replica
that consumes the relay; do not grow that into the relay either.

<!-- memorize:ground-rule v=1 start -->
## Memorize ground rule

Memorize is the single source of truth for project state. Do not store
project ids, task lists, decisions, handoffs, or summaries of them in
your own memory system - they go stale silently. Query memorize at
session start instead (`memorize task resume`, `memorize project show`).
Your own memory is for per-self content only: user preferences and your
own working-style lessons. To absorb pre-existing notes into memorize,
see `memorize memory import` in AGENT_GUIDE.md.
<!-- memorize:ground-rule v=1 end -->
