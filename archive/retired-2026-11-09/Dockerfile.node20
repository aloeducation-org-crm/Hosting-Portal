# Isolated Node.js 20 runtime/build image. Use a persistent host volume for SQLite.
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0 ALO_HELPER_DIR=/app/helpers
RUN apk add --no-cache bash \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /var/lib/alo-hosting && chown nextjs:nodejs /var/lib/alo-hosting
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=root:root /app/helpers ./helpers
COPY --from=builder --chown=nextjs:nodejs /app/prisma/schema.prisma ./prisma/schema.prisma
RUN chmod 0755 /app/helpers/* && chmod 0644 /app/helpers/sudoers-alo
USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
