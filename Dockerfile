# syntax=docker/dockerfile:1
# One image: the server and the built web app (spec §17 "One image", docs/why/docker-images.md).
# Stages: deps (every dependency) → build (the Prisma client and the web app) → prod-deps (only what runs) → runtime.

FROM node:22-bookworm-slim AS base
WORKDIR /app
# Prisma's schema engine (it runs `migrate deploy`) links against OpenSSL, and the slim image doesn't ship it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Each workspace's package.json first: this layer, and the npm ci below, are reused until a dependency changes.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY packages/protocol/package.json packages/protocol/

FROM manifests AS deps
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
RUN npm run db:generate -w apps/server && npm run build -w apps/web

# Only the server's runtime dependencies (tsx and the prisma CLI are among them: the server runs from its TypeScript
# source, and the container runs its migrations).
FROM manifests AS prod-deps
RUN npm ci --omit=dev --ignore-scripts -w apps/server -w packages/protocol
# --ignore-scripts skipped Prisma's postinstall, the step that downloads its schema engine. Run it here, at build
# time, so a container never downloads anything at boot (a self-hoster behind a firewall can still start it).
RUN node node_modules/@prisma/engines/scripts/postinstall.js

FROM base AS runtime
# GHCR links the published image to this repository (its page, its README, who may push).
LABEL org.opencontainers.image.source="https://github.com/NikosGkikas13/nitpilot"
# CHECKPOINT_DISABLE: the prisma CLI doesn't phone home for a newer version at every start.
ENV NODE_ENV=production \
    PORT=8787 \
    WEB_DIST_DIR=/app/apps/web/dist \
    CHECKPOINT_DISABLE=1
# The node image's non-root `node` user owns the files and runs the server (Odyhook's Dockerfile does the same).
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.base.json ./
COPY --from=build --chown=node:node /app/packages/protocol ./packages/protocol
COPY --from=build --chown=node:node /app/apps/server/package.json /app/apps/server/tsconfig.json /app/apps/server/prisma.config.ts ./apps/server/
COPY --from=build --chown=node:node /app/apps/server/prisma ./apps/server/prisma
COPY --from=build --chown=node:node /app/apps/server/src ./apps/server/src
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
USER node
WORKDIR /app/apps/server
EXPOSE 8787
# The slim image has no curl or wget; node's own fetch asks /healthz.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Migrations first (safe to run again: Prisma skips the ones already applied), then the server. `exec` replaces the
# shell with node, so SIGTERM from `docker stop` reaches the server's shutdown code (apps/server/src/main.ts).
CMD ["sh", "-c", "/app/node_modules/.bin/prisma migrate deploy && exec node --import tsx src/main.ts"]
