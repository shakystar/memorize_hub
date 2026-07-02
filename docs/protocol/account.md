# Account identity (gateway control-plane)

> Implemented by the **gateway**. Conventions (auth, status codes, id
> namespaces) in [`README.md`](./README.md).

## `GET /v1/account`

Identity echo (whoami): resolve the caller's credential to its account. This is
the one control-plane read that admits **every** principal - scoped and read-only
keys included - because it discloses nothing beyond the identity the caller
already authenticates as.

Why it exists: a memorize client, or the H060 headless replica authoring on a
user's behalf, holds a key but not the account id behind it. Event provenance
(`writer`) and roster self-identification both need that id, and the replica's
caller may only hold a **scoped** data-plane key. This endpoint must not require
an unscoped key.

- **Auth:** `Authorization: Bearer <api-key>` or a browser session.

Response `200`:

```json
{
  "accountId": "acc_...",
  "email": "user@example.com",
  "via": "key",
  "readOnly": false,
  "scoped": false
}
```

- `via` - `"key"` (API key) or `"session"` (browser cookie).
- `readOnly` / `scoped` - the credential's axes ([`README.md`](./README.md)
  sections 2 and 3), echoed so a client can explain why a later `403` happened.

Errors: `401` for a missing, unknown, or revoked credential, including a key
whose account no longer exists.
