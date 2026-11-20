# Build stage — bun base mirrored into the internal registry
# (oven/bun:<tag>, pushed from oven/bun). bun is both
# the package manager and the container runtime; keep the tag in lockstep with
# ci-cd.yaml's bun_version + local bun to avoid lockfile skew.
FROM oven/bun:1.4.4-alpine AS builder

# Build arguments for Vite (become env vars baked into the SPA bundle)
ARG VITE_KEYCLOAK_URL
ARG VITE_KEYCLOAK_REALM
ARG VITE_KEYCLOAK_CLIENT_ID
ARG VITE_AUTH_BYPASS

ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL
ENV VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM
ENV VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID
ENV VITE_AUTH_BYPASS=$VITE_AUTH_BYPASS

WORKDIR /app

# CI's "Configure npm registry" step writes a workspace .npmrc with the
# @nonagentic scope + auth token + strict-ssl=false (for npm.test's
# self-signed cert). bun reads that .npmrc, so COPY it in (glob `*` keeps the
# build working when no .npmrc is present, e.g. test fixtures).
#
# NODE_TLS_REJECT_UNAUTHORIZED=0 is the bun equivalent of npm's strict-ssl=false:
# bun's installer ignores .npmrc strict-ssl, NODE_EXTRA_CA_CERTS, and bunfig
# cafile for tarball fetches (verified), so this blunt flag is the only way to
# accept npm.test's internal-ca-signed cert. Scoped to these RUNs only and
# to the throwaway builder stage — it never reaches the runtime image.
COPY package.json bun.lock .npmrc* ./
RUN NODE_TLS_REJECT_UNAUTHORIZED=0 bun install --frozen-lockfile

COPY . .

RUN bun run prepare
RUN bun run build

# Production node_modules are resolved HERE, in the builder, not in the runtime
# stage. Two reasons, both load-bearing:
#
#   1. This is the only stage with the TLS workaround above. The runtime stage
#      ran the same install with cert verification ON and died with
#      UNABLE_TO_VERIFY_LEAF_SIGNATURE on every tarball — 92 of them — while the
#      builder install 30s earlier succeeded against the same registry. Verified
#      by local repro: an unmodified build fails at exactly this step, a build
#      with this change succeeds.
#   2. It lets the runtime stage drop `COPY .npmrc*` entirely. CI's "Configure
#      npm registry" step writes //npm.test/:_authToken into that .npmrc
#      (the private CI archetype), and .dockerignore does not exclude
#      it, so copying it into the final stage shipped a live npm auth token in
#      every published image layer.
#
# Built in a clean dir so the tree is production-only, with .npmrc removed
# before the runtime stage copies it so it cannot ride along.
RUN mkdir -p /prod \
 && cp package.json bun.lock /prod/ \
 && if [ -f .npmrc ]; then cp .npmrc /prod/; fi \
 && cd /prod \
 && NODE_TLS_REJECT_UNAUTHORIZED=0 bun install --production --frozen-lockfile --ignore-scripts \
 && rm -f /prod/.npmrc

# Production stage — real node, NOT bun.
#
# ⛔ Do not put bun back here. bun's node:http drains the whole request socket
# into an internal buffer regardless of stream backpressure: it honours a JS
# `req.pause()` (no more 'data' events) but keeps reading the socket anyway, so
# a 64 MiB upload part is retained almost in full. Measured on
# oven/bun:1.3.11-alpine: 75.9 MiB retained per in-flight part, which OOMKilled
# both replicas (exitCode 137) against the 512Mi limit on 2026-08-20. Real node
# closes the TCP window instead — same probe, ~2 MiB accepted vs bun's 64 MiB.
# Repro: scripts/oom-repro/ (run-docker.sh + pause-probe.js).
#
# Note that "just change CMD to node" on the bun base does NOT work: the `node`
# on PATH in the bun image is bun's own shim
# (/usr/local/bun-node-fallback-bin/node), so the base image itself has to
# change. bun stays the BUILD-stage bundler and package manager above.
FROM node:26-alpine

# Run as a non-root user. Some k8s admission policies reject root containers
# outright; even where they don't, principle of least privilege applies. The
# node base ships a built-in `node` user at uid/gid 1000 — use it rather than
# creating a duplicate.
WORKDIR /app

COPY --from=builder --chown=node:node /app/build ./build
COPY --from=builder --chown=node:node /app/server.js ./server.js
COPY --from=builder --chown=node:node /app/server-backpressure.js ./server-backpressure.js
COPY --from=builder --chown=node:node /app/server-cookie-auth.js ./server-cookie-auth.js
COPY --from=builder --chown=node:node /app/package.json /app/bun.lock ./

# Only `dependencies` (server.js needs http-proxy-3 at runtime); the
# --production tree built in the builder above already dropped devDependencies.
# It is a plain
# node-resolvable tree — bun installed it, but nothing in it is bun-specific.
# The runtime stage does no network install and receives no .npmrc — nothing
# here needs a registry.
COPY --from=builder --chown=node:node /prod/node_modules ./node_modules

USER node

EXPOSE 6183
ENV NODE_ENV=production
ENV PORT=6183

# Kubernetes livenessProbe / readinessProbe in clusters/strato/services/w2v/
# are the source of truth for health. A Dockerfile HEALTHCHECK is dead
# weight under k8s and only causes drift if the probe paths change.

CMD ["node", "server.js"]
