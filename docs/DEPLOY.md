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

Events are stored **as plaintext JSON** on the relay. "Opaque" in the design
means the relay does not *interpret* payloads - **not** that they are encrypted.

- **In transit:** encrypted (HTTPS/TLS terminated at the gateway edge).
- **Access control:** a participant's API key is scoped to specific projects;
  others cannot pull your project through the gateway.
- **At rest / from the operator:** **plaintext.** Whoever runs the Hub can read
  every participant's memory content on disk.

So this is an **operator-trusted** model - fine when the operator is you and the
machines are yours. End-to-end encryption (encrypt payloads client-side, keep
`event.id` plaintext) is a **future memorize-client feature** and needs **no Hub
change** because the relay is already payload-opaque - tracked at
[memorize#182](https://github.com/shakystar/memorize/issues/182). Until then,
only onboard participants who are willing to have the operator able to read
their content.

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

### 2. GitHub OAuth app (operator dashboard)
Create one at https://github.com/settings/developers -> **New OAuth App**:
- **Homepage URL:** `https://<your-app-name>.fly.dev`
- **Authorization callback URL:** `https://<your-app-name>.fly.dev/admin/callback`

Copy the Client ID and generate a Client secret.

### 3. Secrets + operator config
```bash
fly secrets set \
  RELAY_INTERNAL_TOKEN="$(openssl rand -base64 32)" \
  GATEWAY_SESSION_SECRET="$(openssl rand -base64 32)" \
  GITHUB_CLIENT_ID="<client id>" \
  GITHUB_CLIENT_SECRET="<client secret>" \
  GATEWAY_PUBLIC_URL="https://<your-app-name>.fly.dev" \
  GATEWAY_ADMIN_LOGINS="<your-github-login>"
```
`start-hub.mjs` mirrors `RELAY_INTERNAL_TOKEN` into `MEMORIZE_RELAY_TOKEN`, so the
relay gates on the same value the gateway presents - one secret, both sides.

### 4. Deploy + verify
```bash
fly deploy
curl https://<your-app-name>.fly.dev/healthz          # {"ok":true}
open  https://<your-app-name>.fly.dev/beta            # public request page
open  https://<your-app-name>.fly.dev/admin          # GitHub sign-in -> dashboard
```

### 5. Onboard a beta participant
1. They submit the form at `/beta` (email + their project id).
2. You approve at `/admin` (or `hub-gateway-admin requests approve <id>` via
   `fly ssh console`) - the dashboard shows the **one-time API key**.
3. Send them the key. They configure memorize:
   `memorize project sync --bind <projectId>` then sync with
   `--remote-url https://<your-app-name>.fly.dev --token <key>`.

### Backups
`/data` holds all durable state. `fly volumes` snapshots cover it; for an
app-level copy, `fly ssh console` + `tar` the relay ndjson + `gateway.db`.
