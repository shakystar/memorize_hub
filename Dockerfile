# memorize Hub — single image running relay (private) + gateway (public).
# Multi-stage: build the workspace, then ship dist + production deps.

# ---- builder ----
FROM node:24-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable

# Install with the lockfile first (better layer caching). better-sqlite3's
# native binary is fetched/built here for linux during install.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/relay/package.json packages/relay/package.json
COPY packages/gateway/package.json packages/gateway/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm -r build
# Note: no dev-dep prune. `pnpm prune --prod` at a workspace root strips the
# virtual store to the (empty) root deps, breaking the gateway's better-sqlite3
# symlink. The full tree is shipped instead — correct, slightly larger.

# ---- runtime ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    GATEWAY_PORT=8080 \
    MEMORIZE_RELAY_PORT=8787 \
    RELAY_URL=http://127.0.0.1:8787 \
    MEMORIZE_RELAY_STORE=/data/relay \
    GATEWAY_DB=/data/gateway.db

# Copy the whole built tree (pnpm's symlinked node_modules stay valid at the
# same absolute path).
COPY --from=builder /app /app
RUN mkdir -p /data

EXPOSE 8080
CMD ["node", "scripts/start-hub.mjs"]
