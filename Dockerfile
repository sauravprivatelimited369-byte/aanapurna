FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-only placeholders let Next collect route modules without a live database. They are not real credentials.
# Runtime DB URLs, auth secrets and encryption keys are injected by Compose and never baked into the final image.
RUN DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    AUTH_DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    WORKER_DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    MIGRATION_DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    AUTH_SECRET=build-only-not-for-runtime-012345678901234567890123456789 \
    OTP_HASH_KEY=MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA= \
    OTP_ENCRYPTION_KEY=MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA= \
    EMAIL_ENCRYPTION_KEY=MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA= \
    APP_URL=https://build.invalid \
    npm run build

# Install the lockfile first, then prune. A fresh npm ci --omit=dev can retain
# Better Auth's optional drizzle-kit peer but omit its matching platform esbuild,
# causing a version mismatch at install time.
FROM dependencies AS production-dependencies
RUN npm prune --omit=dev && npm cache clean --force

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/tsconfig.json ./tsconfig.json
RUN mkdir -p /app/uploads/private && chown -R node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "server.js"]
