# --- Build the web client ---------------------------------------------------------
# Runs on the build machine's own architecture: the output (dist + runtime node_modules) is plain
# JavaScript with no native modules, so it can be copied into an image for any platform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# --- Runtime ----------------------------------------------------------------------
# The server is TypeScript run directly by Node (type stripping), so there is no server build step.
FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache su-exec
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    PUID=1000 \
    PGID=1000 \
    UMASK=022 \
    NODE_NO_WARNINGS=1
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/
RUN mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/auth/status" >/dev/null || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.ts"]
