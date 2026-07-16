# Rook — one image, two targets: `web` (Next.js) and `workers` (tick daemon).
#   docker build --target web -t rook-web .
#   docker build --target workers -t rook-workers .

FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY workers/package.json workers/
COPY sim/package.json sim/
RUN npm ci
COPY . .

FROM base AS webbuild
ENV NODE_ENV=production
RUN npm run -w web build

FROM node:20-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
COPY --from=webbuild /app ./
EXPOSE 3300
CMD ["npm", "run", "-w", "web", "start"]

FROM base AS workers
ENV NODE_ENV=production
CMD ["npx", "tsx", "workers/src/daemon.ts"]
