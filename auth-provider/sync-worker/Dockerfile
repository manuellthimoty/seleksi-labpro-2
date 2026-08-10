FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY auth-provider/server/package.json ./auth-provider/server/
COPY auth-provider/sync-worker/package.json ./auth-provider/sync-worker/
COPY applications/app-a/package.json ./applications/app-a/
COPY applications/app-b/package.json ./applications/app-b/
RUN npm ci

FROM deps AS build
COPY auth-provider/sync-worker ./auth-provider/sync-worker
RUN npm run build --workspace=auth-provider/sync-worker

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/auth-provider/sync-worker/dist ./auth-provider/sync-worker/dist
COPY auth-provider/sync-worker/package.json ./auth-provider/sync-worker/package.json

WORKDIR /app/auth-provider/sync-worker
CMD ["node", "dist/index.js"]
