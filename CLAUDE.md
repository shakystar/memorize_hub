# CLAUDE.md

This file orients Claude Code when working in the `memorize_hub` repo.

## Start here

Read **[`AGENTS.md`](./AGENTS.md)** (what this is, design direction, roadmap)
and **[`PROTOCOL.md`](./PROTOCOL.md)** (the authoritative HTTP wire contract).

## One-line

memorize_hub is the **optional relay server** for [memorize](../memorize)'s
P3-b-2 cross-machine auto sync — a dumb store-and-forward queue of opaque
per-project event logs over HTTP. The sibling `memorize` repo holds the client.

## Key constraints

- **Implement `PROTOCOL.md` exactly.** It is shared with the memorize client; do
  not change the wire shape here without changing it there too.
- **Zero runtime deps, `node:http`.** Match memorize's std-lib-first style.
- **ndjson-on-disk** store-and-forward, **optional bearer token** auth.
- The relay is **dumb**: store + forward opaque events, dedup by `event.id`,
  preserve order, append-only. No projection, no conflict resolution — that all
  lives in memorize clients.
- memorize is **local-first**: this relay is always optional and must never
  become a hard dependency of memorize.

## Status

v1 implemented 2026-06-12: `node:http` server (`src/server.ts`), ndjson-on-disk
store (`src/store.ts`), env config (`src/config.ts`), vitest unit + HTTP
contract tests. `pnpm check` = typecheck + lint + test.
Reference behavior + tests live in `../memorize/tests/harness/relay-stub.ts` and
`../memorize/tests/golden/sync-roundtrip-http-golden.test.ts`.

**Scope note (2026-06-12):** this repo is the Hub's *transport layer* only. The
#92 read surface (remote MCP endpoint, dashboards) will be a separate headless
memorize replica that consumes this relay — do not grow projection/query/MCP
features here.
