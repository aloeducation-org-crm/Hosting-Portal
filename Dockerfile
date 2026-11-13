# Single canonical container image. Matches the Node 22 runtime used by CI
# and the >=22 engines constraint. Use a persistent host volume for SQLite.
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
# postinstall runs `prisma generate`, so the schema must be present before npm ci.
COPY prisma ./prisma
RUN npm ci

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run db:generate
RUN npm run build && npm run build:worker

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0 ALO_HELPER_DIR=/app/helpers
RUN apk add --no-cache bash git \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /var/lib/alo-hosting && chown nextjs:nodejs /var/lib/alo-hosting
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=root:root /app/helpers ./helpers
COPY --from=builder --chown=nextjs:nodejs /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder --chown=root:root /app/deploy ./deploy
RUN chmod 0755 /app/helpers/* && chmod 0440 /app/deploy/sudoers/*
USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
