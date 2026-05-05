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
COPY package*.json ./
COPY scripts ./scripts
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
