# ============================================================
# ビルドステージ
# ============================================================
FROM node:22-alpine AS builder
WORKDIR /app

# ルートの依存関係をインストール
COPY package*.json ./
RUN npm ci

# Prisma スキーマをコピーして Client 生成
COPY prisma ./prisma
RUN npx prisma generate

# ソースコード全体をコピー
COPY . .

# バックエンドビルド（TypeScript → JavaScript）
RUN npx tsc

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
