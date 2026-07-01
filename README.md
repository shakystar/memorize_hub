# memorize_hub

The **Hub** for [memorize](https://github.com/shakystar/memorize)'s cross-machine
auto sync — a pnpm monorepo with two packages:

- **`packages/relay`** — the optional **relay server**: a dumb store-and-forward
  queue of opaque per-project event logs over HTTP. Zero runtime deps,
  `node:http`, ndjson-on-disk, append-only, dedup by event id. It does no
  projection, identity, or conflict resolution — that all lives in memorize
  clients.
- **`packages/gateway`** — the **control-plane** that fronts the relay: public
  edge, project-scoped API-key auth + ACL, GitHub-OAuth operator/account
  dashboards, a beta access-request page, and a reverse proxy that injects the
  relay's internal token.

memorize is local-first, so the Hub is **always optional** — a memorize install
with no configured relay never talks to it.

## Docs

- **[PROTOCOL.md](./PROTOCOL.md)** — the authoritative HTTP wire contract
- **[docs/SoT/](./docs/SoT/)** — Hub architecture Source-of-Truth (2-plane
  boundary, workspace transport, control-plane model, identifiers, security)
- **[AGENTS.md](./AGENTS.md)** — design direction, invariants, roadmap
- **[docs/DEPLOY.md](./docs/DEPLOY.md)** — Fly.io deploy guide (secrets + steps)
- **[docs/WORKSPACE_CONTRACT_BRIEF.md](./docs/WORKSPACE_CONTRACT_BRIEF.md)** ·
  **[docs/JOIN_AND_MERGE.md](./docs/JOIN_AND_MERGE.md)** — workspace design notes

## Self-hosting

The Hub is built to be self-hosted. Quick local run:

```sh
pnpm install
pnpm -r build
node scripts/start-hub.mjs   # relay + gateway on one box
```

For a real deployment (gateway public + TLS, relay internal-only + token-gated,
durable volume), follow **[docs/DEPLOY.md](./docs/DEPLOY.md)**. A reference
instance runs on Fly.io.

`pnpm -r check` = typecheck + lint + test across both packages.

## License

memorize_hub is **fair-code** distributed under the **Sustainable Use License**
(see [faircode.io](https://faircode.io)). You may use, modify, and **self-host**
it freely for your own internal, non-commercial, or personal use. The one thing
reserved to the author is selling it to third parties as a hosted/managed
service. See **[LICENSE.md](./LICENSE.md)** for the full terms.
