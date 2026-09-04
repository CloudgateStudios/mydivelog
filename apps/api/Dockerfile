# syntax=docker/dockerfile:1
#
# Built from the repository root:
#   docker build -f apps/api/Dockerfile .
#
# The build context is the whole workspace because the API depends on workspace
# packages that pnpm resolves by path.

FROM node:24-alpine AS base
WORKDIR /repo
# pnpm is installed directly rather than through corepack: corepack is being
# unbundled from Node and is already absent from node:26, which broke the image
# build the moment the base tag moved. The version is read from packageManager
# so it cannot drift from what the workspace expects.
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")" \
    && pnpm --version

# --- dependencies ----------------------------------------------------------
# Manifests are copied before sources so this layer caches across code changes.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/domain/package.json packages/domain/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- build -----------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/api apps/api
RUN pnpm --filter @mydivelog/api build
# Produces a self-contained directory with production dependencies only, with
# workspace links resolved into real files.
RUN pnpm --filter @mydivelog/api --prod --legacy deploy /out

# --- runtime ---------------------------------------------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run unprivileged. node:alpine ships a `node` user for exactly this.
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/package.json ./package.json
USER node

EXPOSE 8080
ENV API_PORT=8080
CMD ["node", "dist/main.js"]
