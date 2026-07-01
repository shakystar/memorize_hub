# Device Authorization — `POST /v1/device/code` · `GET /device` · `POST /v1/device/token`

Surface: **gateway (control-plane).** Lets a CLI/agent obtain an API key via a
browser approval instead of a manually-copied dashboard key — the OAuth 2.0
**Device Authorization Grant** ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628))
shape. `memorize auth login` (or `memorize login`) with no `--token` drives it.

Conventions in [`README.md`](./README.md) bind here too; deviations are called out.

## Flow

1. Client (unauthenticated) requests a device code.
2. Client shows the user a short `user_code` + a `verification_uri`; the user
   opens it in a browser, signs in (Google OAuth session), and approves.
3. Client polls the token endpoint until approval, then receives a freshly-minted
   `mzk_` key and stores it host-scoped (see `memorize auth login`).

The key is minted **at collection, not at approval**, so the plaintext is returned
in the poll response and never persisted — only its hash is stored, exactly as
`POST /v1/account/keys` (README §3). The `device_auth` record never holds a key.

## `POST /v1/device/code` — start (no auth)

Request body (optional): `{ "label"?: string }` — label for the minted key
(default `"device login"`).

`200`:
```json
{
  "device_code": "<opaque, client-held secret>",
  "user_code": "WDJB-MJHT",
  "verification_uri": "https://<hub>/device",
  "verification_uri_complete": "https://<hub>/device?code=WDJB-MJHT",
  "expires_in": 600,
  "interval": 5
}
```
- `device_code` — 256-bit base64url random; the poll secret. Unguessable, so an
  unknown `device_code` leaks nothing (README §5 rationale).
- `user_code` — 8 chars from an unambiguous alphabet (no `O/0/I/1`), grouped
  `XXXX-XXXX`; what the human reads and types.
- `expires_in` — `600` (10 min). `interval` — `5` (min seconds between polls).

## `GET /device` — approval page (browser, `via:"session"`)

Session-gated exactly like `/admin` (README §6): no session -> account login,
then back. `?code=WDJB-MJHT` (from `verification_uri_complete`) pre-fills the
field. The page shows the pending request for that `user_code` and an **Approve**
button; `POST /device` (form, same session) with the `user_code` approves it —
the gateway records `status=approved` + the session's `accountId` on that record.
Unknown/expired `user_code` -> a plain "code not found or expired" page. **No key
is minted here.**

CSRF: the approve `POST` carries the session cookie **and** a signed form token
(same `GATEWAY_SESSION_SECRET` HMAC as the OAuth `state`), so a cross-site POST
cannot approve.

## `POST /v1/device/token` — poll / collect (no auth)

Body: `{ "device_code": "<from step 1>" }`. The `device_code` is itself the bearer
of authority — no `Authorization` header. RFC 8628 error strings in the body:

| State | Response |
|---|---|
| still pending | `400 { "error": "authorization_pending" }` |
| polled faster than `interval` | `400 { "error": "slow_down" }` |
| expired (`> expires_in`) | `400 { "error": "expired_token" }` |
| user rejected | `400 { "error": "access_denied" }` |
| unknown `device_code` | `400 { "error": "expired_token" }` (no existence leak) |
| **approved (first poll)** | `200 { "token": "mzk_…", "tokenId": "tok_…", "label": "device login" }` |

On the approved poll the gateway mints the key (`issueApiKey(accountId)` —
unscoped, read-write) and **consumes** the record (single delivery). Re-polling a
consumed record -> `expired_token`.

## Storage

One `device_auth` control-plane row per request (migration `v4`):

| Column | Note |
|---|---|
| `device_code` | PK — opaque client secret |
| `user_code` | UNIQUE — the human code |
| `account_id` | NULL until approved; `-> accounts(id)` |
| `status` | `pending` \| `approved` \| `denied` |
| `created_at`, `expires_at` | 10-min TTL |
| `last_polled_at` | drives `slow_down` |

**No token column** — the key is never stored in plaintext. Expired/consumed rows
are swept lazily on access. This is control-plane identity state, so it lives in
the gateway DB, never the relay (README §7, [[H010]]).
