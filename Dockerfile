# api と worker は同じ image を使い、APP_TYPE で切り替える
FROM node:24.22.1-alpine AS base
WORKDIR /app
# package.json の packageManager と同じ版を入れる。上げるときは両方を書き換える。
# corepack を使うと、初回実行時に pnpm が npm レジストリの版ごとの情報を取りに行き、
# そこが障害で 502 を返したときに build が止まった（2026-10-22）。npm install はその URL を使わない
RUN npm install -g pnpm@12.14.0

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma7.config.ts ./
COPY prisma ./prisma
# postinstall の prisma generate で src/generated に Prisma Client を作る
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Prisma Client は build で dist に入っているので、prisma generate（devDependencies の prisma が要る）は走らせない
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/main.js"]
