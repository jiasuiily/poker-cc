# Production image: one Node process serving the API, WebSocket and the built front end.
# Built from the repository root:  docker compose -f deploy/docker-compose.yml build

FROM node:24-slim AS build
WORKDIR /src
RUN npm install -g pnpm@11.28.5
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @poker/web build && pnpm --filter @poker/server build

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=2567 \
    MIGRATIONS_DIR=/app/drizzle \
    WEB_DIR=/app/web
WORKDIR /app
# The server bundle; only native/WASM modules are installed here (listed in dist/package.json).
COPY --from=build /src/apps/server/dist ./dist
RUN cd dist && npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /src/apps/server/drizzle ./drizzle
COPY --from=build /src/apps/web/dist ./web
USER node
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:2567/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
