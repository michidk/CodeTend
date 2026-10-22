# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

# ---- App build (TanStack Start on Bun) ----
FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS app-builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS app
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# The base image's `bun` user is uid 1000, the same uid as the Eve image's
# `node` user, so a data volume shared between the two containers needs no
# group juggling.
COPY --from=app-builder --chown=bun:bun /app/package.json /app/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=app-builder --chown=bun:bun /app/.output ./.output
COPY --from=app-builder --chown=bun:bun /app/drizzle ./drizzle
COPY --from=app-builder --chown=bun:bun /app/scripts ./scripts
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]

# ---- Eve agent runtime (Node 26) ----
FROM node:26-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe AS eve
WORKDIR /app
ENV NODE_ENV=production
ARG TARGETARCH
ARG OSV_SCANNER_VERSION=v2.6.0
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl \
  && cd /tmp \
  && curl --connect-timeout 15 --max-time 120 --retry 3 -fsSLO "https://github.com/google/osv-scanner/releases/download/${OSV_SCANNER_VERSION}/osv-scanner_linux_${TARGETARCH}" \
  && curl --connect-timeout 15 --max-time 120 --retry 3 -fsSLO "https://github.com/google/osv-scanner/releases/download/${OSV_SCANNER_VERSION}/osv-scanner_SHA256SUMS" \
  && grep " osv-scanner_linux_${TARGETARCH}$" osv-scanner_SHA256SUMS | sha256sum -c - \
  && install -m 0755 "osv-scanner_linux_${TARGETARCH}" /usr/local/bin/osv-scanner \
  && rm -rf /var/lib/apt/lists/* /tmp/osv-scanner_*
COPY src/lib/agent-execution.ts src/lib/eve-protocol.ts src/lib/findings.ts src/lib/github-app-auth.ts src/lib/scanners.ts src/lib/security-scans.ts ./src/lib/
COPY eve/package.json eve/package-lock.json* ./eve/
WORKDIR /app/eve
RUN npm ci
RUN ln -s /app/eve/node_modules /app/node_modules
COPY eve/agent ./agent
COPY eve/tsconfig.json ./
RUN NODE_ENV=development npx eve build
RUN mkdir -p /data && chown -R node:node /data /app/eve/.eve
USER node
EXPOSE 2000
CMD ["npx", "eve", "start", "--host", "0.0.0.0", "--port", "2000"]
