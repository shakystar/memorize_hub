# memorize_hub — Wire Protocol (v1)

> **Authoritative source of truth** for the HTTP sync contract shared by the
> `memorize` client (`src/adapters/sync-transport-http.ts`) and this Hub. Both
> sides implement it. Versioned under `/v1`.

The contract outgrew a single file once the control-plane grew to 10+ endpoints,
so it now lives **split by surface** under [`docs/protocol/`](./docs/protocol/).
This file is a thin index; the folder is authoritative. Start at
**[`docs/protocol/README.md`](./docs/protocol/README.md)** — it defines the
conventions (identifiers, auth principal, `read_only`/scope, status codes,
`403`-vs-`404`) that bind every endpoint.

## Surfaces

| Document | Surface | Plane |
|---|---|---|
| [`docs/protocol/README.md`](./docs/protocol/README.md) | conventions (bind on every endpoint) | — |
| [`docs/protocol/transport.md`](./docs/protocol/transport.md) | `POST/GET /v1/projects/:storeId/events`, `/healthz`, E2E envelope | relay (transport) |
| [`docs/protocol/store-resolution.md`](./docs/protocol/store-resolution.md) | server-minted store ids, discovery map | gateway (control) |
| [`docs/protocol/account.md`](./docs/protocol/account.md) | `GET /v1/account` identity echo (whoami) | gateway (control) |
| [`docs/protocol/personal-store.md`](./docs/protocol/personal-store.md) | `GET /v1/account/personal-store` (`psm_`) | gateway (control) |
| [`docs/protocol/workspace.md`](./docs/protocol/workspace.md) | `wsp_` create / invite / join / membership / roles | gateway (control) |
| [`docs/protocol/derived-store.md`](./docs/protocol/derived-store.md) | `GET /v1/stores/:parentStoreId/derived/:artifactKind` derived artifact sidecar (`der_`) provisioning | gateway (control) |

Only `transport.md` is served by a **bare relay** (no gateway). The rest are
gateway control-plane; the relay knows nothing of accounts, stores, or prefixes
(Hub SoT `docs/SoT/H010`).

## Role (one line)

The relay is a **dumb store-and-forward** queue of opaque per-store event logs:
the origin pushes, the relay holds durably, a replica pulls later — even if the
origin is offline. It never parses, projects, or interprets payloads; all
convergence/projection lives in memorize clients (CRDT grow-only set, deduped by
`event.id`). The gateway fronts it with identity / keys / membership / invites.

## Invariants (non-negotiable — full text in `transport.md`)

1. **Append-only** — never mutate or drop a stored event; dedup = skip-on-write.
2. **Order-preserving** — pull returns insertion order.
3. **Idempotent** — re-pushing a stored id is a no-op; re-pulling is safe.
4. **Opaque payloads** — depend on nothing but `event.id`; a payload MAY be an
   E2E ciphertext envelope.

The design rationale and architecture invariants behind this contract live in
[`docs/SoT/`](./docs/SoT/) (Hub Source-of-Truth: 2-plane boundary, workspace
transport, control-plane model, identifiers, authorization, onboarding).
