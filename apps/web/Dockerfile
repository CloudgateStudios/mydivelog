# syntax=docker/dockerfile:1
# Built from the repository root: docker build -f apps/web/Dockerfile .
#
# Relies on Next.js `output: 'standalone'`, which traces the files actually
# used and emits a server that needs no node_modules install at runtime.

FROM node:24-alpine AS base
WORKDIR /repo
# pnpm is installed directly rather than through corepack: corepack is being
# unbundled from Node and is already absent from node:26, which broke the image
# build the moment the base tag moved. The version is read from packageManager
# so it cannot drift from what the workspace expects.
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")" \
    && pnpm --version

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/domain packages/domain
COPY apps/web apps/web
RUN pnpm --filter @mydivelog/web... build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# outputFileTracingRoot is the repo root, so the standalone tree mirrors the
# workspace layout: the server lands at apps/web/server.js.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node

EXPOSE 8080
ENV PORT=8080 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
