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
COPY applications/app-a ./applications/app-a
RUN npm run build --workspace=applications/app-a

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/applications/app-a/dist ./applications/app-a/dist
COPY applications/app-a/package.json ./applications/app-a/package.json

WORKDIR /app/applications/app-a
EXPOSE 4000
CMD ["node", "dist/index.js"]
