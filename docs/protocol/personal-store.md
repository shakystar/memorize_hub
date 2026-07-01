# Personal memory store (gateway control-plane)

> Implemented by the **gateway**, not the relay. The relay knows nothing of
> accounts or personal memory; a personal store is just another opaque event log
> keyed by a path id. Documented here so the memorize client has one wire-contract
> source. A bare relay does not serve it. Conventions in [`README.md`](./README.md).

memorize keeps **global, cross-project personal memory** that must sync across a
user's own machines but **never** leak into shared/project/team surfaces. The
gateway models this as a per-account **personal store**: one opaque event log per
account, owned by exactly one account and **never grantable or shared**.

It rides the **same event contract** as a project — the `POST/GET
/v1/projects/:storeId/events` endpoints ([`transport.md`](./transport.md)),
byte-for-byte, including the optional E2E payload envelope. Only the authorization
axis differs (owner-only).

## `GET /v1/account/personal-store`

Resolve the caller's account (by API key) to its personal-store id, provisioning
one on first call. The client then syncs personal memory via the events route
under the returned id.

- **Auth:** `Authorization: Bearer <api-key>` (the same participant key used for
  project sync; the CLI holds a key, not a browser cookie).
- Only an **unscoped** key qualifies. A key narrowed to a project subset cannot
  reach personal memory -> `403` ([`README.md`](./README.md) §3). Mint an unscoped
  key for personal sync.

Response `200`:

```jsonc
{
  "storeId": "psm_...",                       // relay path id for this account's personal memory
  "eventsUrl": "/v1/projects/psm_.../events"  // convenience; the normal events route
}
```

## Authorization (owner-only isolation)

For a `psm_…` id, the gateway bypasses workspace membership entirely and enforces:

1. The key's account **owns** that personal store, else `403`. No account can
   reach another's personal store — this is the privacy guarantee.
2. The key is **unscoped**, else `403`.
3. `read_only` keys may pull but never push (`403` on `POST`), as for any store.

The `psm_…` namespace is **reserved** ([`README.md`](./README.md) §1): the gateway
refuses to grant or create an access request for an id in that shape, so a project
can never shadow or be granted as a personal store.

## Client leak boundary

The client MUST treat the leak boundary as its own responsibility: personal-scoped
events go **only** to the personal store, never mixed into any project's or
workspace's push (memorize #181). The gateway cannot enforce this — payloads are
opaque — so it is a hard client invariant (Hub SoT [[H010]] / memorize SoT-010).
