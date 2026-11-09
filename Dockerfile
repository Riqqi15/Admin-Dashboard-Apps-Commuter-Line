# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations
COPY src ./src
# Generation does not connect to PostgreSQL. No real credential is used at build time.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run prisma:generate
RUN npm run build

# One-shot migration image. Prisma CLI stays outside the running API image.
FROM build AS migrate
ENV NODE_ENV=production
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma.config.ts"]

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# Prisma CLI is an optional peer of @prisma/client; exclude optional tooling too.
RUN npm ci --omit=dev --omit=optional

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health/ready',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
