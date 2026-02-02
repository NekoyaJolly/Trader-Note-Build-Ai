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

# ビルド成果物をコピー
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/frontend/.next ./src/frontend/.next
COPY --from=builder /app/src/frontend/public ./src/frontend/public
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
