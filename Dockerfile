# syntax=docker/dockerfile:1

# ---- App build (TanStack Start on Bun) ----
FROM oven/bun:1.4.0 AS app-builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.0-slim AS app
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid 1001 --create-home --shell /usr/sbin/nologin app
COPY --from=app-builder --chown=app:nodejs /app/package.json /app/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=app-builder --chown=app:nodejs /app/.output ./.output
COPY --from=app-builder --chown=app:nodejs /app/drizzle ./drizzle
COPY --from=app-builder --chown=app:nodejs /app/scripts ./scripts
RUN mkdir -p /data && chown app:nodejs /data
USER app
EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]

# ---- Eve agent runtime (Node 24) ----
FROM node:24-bookworm-slim AS eve
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY src/lib/findings.ts src/lib/scanners.ts ./src/lib/
COPY eve/package.json eve/package-lock.json* ./eve/
WORKDIR /app/eve
RUN npm install
COPY eve/agent ./agent
COPY eve/tsconfig.json ./
RUN npx eve build
RUN mkdir -p /data && chown node:node /data /app/eve
USER node
EXPOSE 2000
CMD ["npx", "eve", "start", "--host", "0.0.0.0", "--port", "2000"]
