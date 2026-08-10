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
COPY auth-provider/server ./auth-provider/server
RUN npm run build --workspace=auth-provider/server

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/auth-provider/server/dist ./auth-provider/server/dist
COPY auth-provider/server/package.json ./auth-provider/server/package.json

WORKDIR /app/auth-provider/server
EXPOSE 3000
CMD ["node", "dist/index.js"]
