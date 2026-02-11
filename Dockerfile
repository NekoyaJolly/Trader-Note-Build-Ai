# ビルドステージ
FROM node:22-alpine AS builder
WORKDIR /app

# 依存関係を先にインストールしてビルドキャッシュを有効化
COPY package*.json ./
RUN npm ci

# Prisma スキーマ・マイグレーションを同梱
COPY prisma ./prisma

# フロントエンド依存関係を先に解決
COPY src/frontend/package*.json ./src/frontend/
RUN cd src/frontend && npm ci

# ソースコードをコピー
COPY . .

# Prisma Client 生成
RUN npm run prisma:generate

# バックエンド/フロントエンドをビルド
RUN npm run build:backend
RUN npm run build:frontend

# 実行ステージ
FROM node:22-alpine
WORKDIR /app

# 本番環境として動作させる（Next.js 統合ハンドラーの登録に必要）
ENV NODE_ENV=production

# ビルド成果物をコピー
COPY --from=builder /app/dist ./dist

# Next.js standalone 資産を /app/frontend に集約
# standalone 内の深い階層 (src/frontend) の中身をフラットに配置
COPY --from=builder /app/src/frontend/.next/standalone/src/frontend ./frontend
# standalone が生成する root node_modules をコピー
COPY --from=builder /app/src/frontend/.next/standalone/node_modules ./node_modules
# バックエンド node_modules を上書きマージ（共通化）
COPY --from=builder /app/node_modules ./node_modules
# static / public は standalone に含まれないため手動配置
COPY --from=builder /app/src/frontend/.next/static ./frontend/.next/static
COPY --from=builder /app/src/frontend/public ./frontend/public
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

# 実行ユーザー作成
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# 書き込みが必要なディレクトリを作成
RUN mkdir -p data/ohlcv data/trades && chown -R nodejs:nodejs data

# ランタイムでも Prisma Client を再生成
RUN npm run prisma:generate

USER nodejs
EXPOSE 8080

# Cloud Run Job がマイグレーションを担当
CMD ["node", "dist/index.js"]
