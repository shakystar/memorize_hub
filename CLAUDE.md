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

Scaffolded 2026-06-08 (docs only). Server implementation is the next task.
Reference behavior + tests live in `../memorize/tests/harness/relay-stub.ts` and
`../memorize/tests/golden/sync-roundtrip-http-golden.test.ts`.
