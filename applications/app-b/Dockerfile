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
COPY applications/app-b ./applications/app-b
RUN npm run build --workspace=applications/app-b

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/applications/app-b/dist ./applications/app-b/dist
COPY applications/app-b/package.json ./applications/app-b/package.json
COPY applications/app-b/drizzle ./applications/app-b/drizzle

WORKDIR /app/applications/app-b
EXPOSE 5000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
