# syntax=docker/dockerfile:1

# Node 24 to match .nvmrc / engines (>=24).
FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY admin/package.json ./admin/package.json
# --ignore-scripts: the image needs neither git hooks (lefthook prepare) nor the
# dev-only native build steps here; tsc and the runtime deps are pure JS (the
# admin's native Tailwind engine is rebuilt in the build stage).
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/admin/node_modules ./admin/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY drizzle ./drizzle
COPY admin ./admin
# Tailwind v4's native engine was skipped by --ignore-scripts; build it for the admin bundle.
RUN pnpm rebuild @tailwindcss/oxide
RUN pnpm build
RUN pnpm --filter @cadence/admin build

# Runtime node_modules: a fresh prod-only install (avoids `pnpm prune`, which
# would re-run the lefthook `prepare` hook that has no place in the image).
FROM node:24-slim AS prod-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY admin/package.json ./admin/package.json
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/admin/dist ./admin/dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./
USER node
# Default command is the api; the worker service overrides it in compose.
CMD ["node", "dist/entrypoints/api.js"]
