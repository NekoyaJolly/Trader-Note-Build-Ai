# ============================================================
# ビルドステージ
# ============================================================
FROM node:22-alpine AS builder
WORKDIR /app

# ルートの依存関係をインストール
#
# `prepare` (= node scripts/install-git-hooks.js) が `npm ci` 中に走るため、
# 先に scripts/ を COPY しておく必要がある。
# install-git-hooks.js は `.git` 不在で no-op で抜ける (CI / Docker 想定済み)。
#
# 注意: `--ignore-scripts` で全 lifecycle を停止する案は採用しない。bcrypt の
# ネイティブバイナリ / @prisma/client / @prisma/engines 等の依存側 install フックも
# 止めてしまうため、コンテナ実行時に require / 初期化が壊れる可能性がある。
#
# ★ `.npmrc` も COPY する必要がある (2026-05-14 deploy 修正):
#   ADK Step 1 で @google/adk@^1.1.0 を導入したが、ADK の peerDependencies が
#   MikroORM ファミリー (@mikro-orm/{mariadb,mssql,mysql,postgresql,sqlite,knex})
#   を要求する一方、本プロジェクトは Prisma 単独 ORM 方針で MikroORM を採用しない
#   (`ADK_ADOPTION.md` §2.3、Nekoさん 2026-05-12 確定)。
#   この方針は `.npmrc` の `legacy-peer-deps=true` で実現されており、
#   `.npmrc` が無い環境で `npm ci` を実行すると strict mode で MikroORM peer を
#   要求して "Missing from lock file" エラーになる (run #457 以降の deploy 失敗原因)。
#   `.npmrc` には token 等の secret は含まれず legacy-peer-deps=true のみのため、
#   本番イメージに含めても情報漏洩リスクなし。
COPY package*.json .npmrc ./
COPY scripts ./scripts
# Last-Mile Shared Context (Phase 11) — `package.json` が `file:./vendor/last-mile-context/*.tgz`
# を直接参照するため、`npm ci` 前に vendor/ を COPY しないと "ENOENT: ... .tgz" で失敗する。
# 配布物は registry に publish していない (社内 / vendor 同梱方針) ため、本ファイルが正本。
COPY vendor ./vendor
RUN npm ci

# Prisma スキーマをコピーして Client 生成
COPY prisma ./prisma
RUN npx prisma generate

# ソースコード全体をコピー
COPY . .

# バックエンドビルド（TypeScript → JavaScript）
RUN npx tsc

# 非 .ts アセット(.md プロンプト等)を dist にコピー
# loadPrompt() が実行時参照するため dist/side-b/prompts/ に配置する必要がある。
# copy-assets.js は minCount 未満なら非 0 終了するので、.dockerignore で
# プロンプト .md が欠落した場合はここでビルドが失敗し本番へ出ない。
RUN npm run copy:assets

# ============================================================
# 実行ステージ
# ============================================================
FROM node:22-alpine
WORKDIR /app

# Alpine で Prisma が動作するためのネイティブライブラリ
RUN apk add --no-cache libc6-compat openssl

# 本番環境フラグ
ENV NODE_ENV=production

# ── 依存関係: ルートの node_modules のみ ──
COPY --from=builder /app/node_modules ./node_modules

# ── バックエンド成果物 ──
COPY --from=builder /app/dist ./dist

# ── Prisma スキーマ（ランタイム参照用） ──
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

# 実行ユーザー作成
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# 書き込みディレクトリ
RUN mkdir -p data/ohlcv data/trades && chown -R nodejs:nodejs data

USER nodejs
EXPOSE 8080

CMD ["node", "dist/index.js"]
