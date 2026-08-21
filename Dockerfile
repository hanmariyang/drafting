# ─── build stage ─────────────────────────────────────────────────────────
# node:24 ships the built-in `node:sqlite` module (no native deps to compile).
FROM node:24-bookworm-slim AS build
WORKDIR /app

# install workspace deps (root + api + web)
COPY package.json package-lock.json* ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm install

# copy sources and build web (static) + api (tsc)
COPY . .
RUN npm run build

# prune dev deps for the api runtime
RUN npm prune --omit=dev --workspace api || true
# workspaces 는 루트로 호이스트되어 api/node_modules 가 없을 수 있음 — COPY 실패 방지
RUN mkdir -p api/node_modules

# ─── runtime stage ───────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DATABASE_PATH=/data/drafting.sqlite

# api runtime + built artifacts
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/api/node_modules ./api/node_modules
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/api/templates ./api/templates
COPY --from=build /app/api/package.json ./api/package.json
# 루트 package.json = 앱 버전 단일 소스 (config.readVersion 이 REPO_ROOT 에서 읽음)
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/db ./db
# built frontend served statically by the api
COPY --from=build /app/web/dist ./web/dist

RUN mkdir -p /data
VOLUME /data
EXPOSE 8080

CMD ["node", "api/dist/index.js"]
