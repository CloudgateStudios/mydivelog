# syntax=docker/dockerfile:1
# Built from the repository root: docker build -f apps/worker/Dockerfile .

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/domain/package.json packages/domain/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/worker apps/worker
RUN pnpm --filter @mydivelog/worker build
RUN pnpm --filter @mydivelog/worker --prod --legacy deploy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/package.json ./package.json
USER node

EXPOSE 8080
ENV WORKER_PORT=8080
CMD ["node", "dist/main.js"]
