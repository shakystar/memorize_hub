# Deploying memorize Hub

The Hub is **one machine** running two processes:

```
participant memorize ──HTTPS──▶ gateway :8080 (public)
                                   │  API-key auth + per-project ACL
                                   ▼  HTTP + internal token (127.0.0.1)
                                relay :8787 (private, never published)
                                   ▼
                                /data  (relay ndjson + gateway sqlite)
```

`scripts/start-hub.mjs` launches relay + gateway as separate processes in one
container; the gateway is the only public surface.

## Privacy / threat model (read this before onboarding others)

The relay stores events as JSON the running server can read: **"opaque" means the
relay does not *interpret* payloads - not that they are end-to-end encrypted.**

- **In transit:** encrypted (HTTPS/TLS terminated at the gateway edge).
- **At rest:** the `/data` volume is **disk/volume-encrypted** (host / Fly volume
  encryption) - the v1 at-rest baseline (Hub SoT H070, memorize SoT-070). The
  GitHub model: encrypted on disk, readable by the running server.
- **Access control:** a participant's API key is scoped; others cannot pull your
  project or workspace through the gateway.
- **From the operator:** **still readable.** Disk encryption stops disk theft, not
  the operator - whoever runs the Hub can read memory content via the running
  server. This is by design: the server is the trust boundary and reads shared
  data to consolidate it once for everyone (SoT-070).

So this is an **operator-trusted** model - fine when the operator is you and the
machines are yours. End-to-end encryption (per-store data keys wrapped per device)
is **deferred and demand-gated**: it is blocked on a recovery-policy decision
(single-device loss = permanent loss) and would forgo server-side workspace
consolidation (Hub SoT H070/H900, memorize SoT-070/900,
[memorize#182](https://github.com/shakystar/memorize/issues/182)). Until then,
only onboard participants willing to have the operator able to read their content.

---

## Local run + two-replica test (one PC)

This is the local cross-machine test: run the Hub, then point **two memorize
homes** (`MEMORIZE_ROOT` = the replica boundary, *not* the project folder) at it.

**Option A - automated.** The gateway e2e does the whole loop (key issue -> push ->
clone -> convergence) and reports latency:

```bash
pnpm -r build
pnpm --filter @shakystar/memorize-hub-gateway e2e
```

**Option B - by hand.**

```bash
# 1. Run the Hub (relay private + gateway public) in one container:
docker build -t memorize-hub .
docker run --rm -p 8080:8080 -v "$PWD/hub-data:/data" \
  -e RELAY_INTERNAL_TOKEN=dev-secret memorize-hub
#    (or without Docker: set the envs and run both
#     `node packages/relay/dist/index.js` and `node packages/gateway/dist/index.js`)

# 2. Issue a participant key (operator step) against the same GATEWAY_DB:
#    first submit a request at http://localhost:8080/beta, then:
GATEWAY_DB=./hub-data/gateway.db \
  node packages/gateway/dist/admin-cli.js requests list
GATEWAY_DB=./hub-data/gateway.db \
  node packages/gateway/dist/admin-cli.js requests approve <requestId>   # prints the key once

# 3. Two "machines" = two MEMORIZE_ROOTs against the gateway:
MEMORIZE_ROOT=~/.mz-a memorize project init                              # -> projectId
MEMORIZE_ROOT=~/.mz-a memorize project sync --push --remote-url http://localhost:8080 --token <key>
MEMORIZE_ROOT=~/.mz-b memorize project clone <projectId> --remote-url http://localhost:8080 --token <key>
#    -> events converge. (The key must be scoped to <projectId>; grant it for the
#      project the participant actually creates.)
```

> Note: this measures **async (poll-on-boundary)** convergence - the beta target.
> Real-time SSE push (memorize P3-c) is not built; this is its future testbed.

---

## Fly.io deploy

One machine, ~$3.5/mo at 512MB (less with `auto_stop_machines`). The relay's
port is never published; it is reached only on `127.0.0.1` and is token-gated.

### 1. Prerequisites
```bash
fly version            # install: https://fly.io/docs/flyctl/install/
fly auth login
fly apps create <your-app-name>          # then set `app = "<your-app-name>"` in fly.toml
fly volumes create hub_data --size 1 --region nrt   # durable /data (match primary_region)
```

### 2. Google OAuth client (operator dashboard + participant /account)
Create one in the Google Cloud console -> **APIs & Services -> Credentials ->
Create credentials -> OAuth client ID -> Web application**:
- **Authorized redirect URIs:**
  - `https://<your-app-name>.fly.dev/oauth/callback`
  - `http://localhost:8080/oauth/callback` (local dev; match `GATEWAY_PORT`)

One client backs both flows: the operator dashboard (`/admin`) and participant
self-service (`/account`) share this single callback. Register these exact URLs —
they are exact matches, not sub-directories.

Publish the OAuth consent screen to **Production** so any Google account may sign
in (scopes are `openid email profile` — non-sensitive, so no Google review is
needed). Copy the Client ID and secret.

### 3. Secrets + operator config
```bash
fly secrets set \
  RELAY_INTERNAL_TOKEN="$(openssl rand -base64 32)" \
  GATEWAY_SESSION_SECRET="$(openssl rand -base64 32)" \
  GOOGLE_CLIENT_ID="<client id>" \
  GOOGLE_CLIENT_SECRET="<client secret>" \
  GATEWAY_PUBLIC_URL="https://<your-app-name>.fly.dev" \
  GATEWAY_ADMIN_EMAILS="<your-google-email>"
```
`start-hub.mjs` mirrors `RELAY_INTERNAL_TOKEN` into `MEMORIZE_RELAY_TOKEN`, so the
relay gates on the same value the gateway presents - one secret, both sides.

### 4. Deploy + verify
```bash
fly deploy
curl https://<your-app-name>.fly.dev/healthz          # {"ok":true}
open  https://<your-app-name>.fly.dev/beta            # public request page
open  https://<your-app-name>.fly.dev/admin          # Google sign-in -> dashboard
```

### 5. Onboard a beta participant
1. They submit the form at `/beta` (email + their project id).
2. You approve at `/admin` - the dashboard shows the **one-time API key**.
   (The `hub-gateway-admin` CLI was retired with the rebuild; `/admin` is the
   only operator surface.)
3. Send them the key. They configure memorize:
   `memorize project sync --bind <projectId>` then sync with
   `--remote-url https://<your-app-name>.fly.dev --token <key>`.

### Backups
`/data` holds all durable state. `fly volumes` snapshots cover it; for an
app-level copy, `fly ssh console` + `tar` the relay ndjson + `gateway.db`.
