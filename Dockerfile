# ============================================================
# ビルドステージ
# ============================================================
FROM node:22-alpine AS builder
WORKDIR /app

# ルートの依存関係をインストール（next, react, prisma 含む）
COPY package*.json ./
RUN npm ci

# Prisma スキーマをコピーして Client 生成
COPY prisma ./prisma
RUN npx prisma generate

# フロントエンド依存関係をインストール（ビルド用 devDeps が必要）
COPY src/frontend/package*.json ./src/frontend/
RUN cd src/frontend && npm ci

# ソースコード全体をコピー
COPY . .

# バックエンドビルド（TypeScript → JavaScript）
RUN npx tsc

# フロントエンドビルド（Next.js standalone）
RUN cd src/frontend && npm run build

# ============================================================
# 実行ステージ
# ============================================================
FROM node:22-alpine
WORKDIR /app

# Alpine で Prisma / Next.js が動作するためのネイティブライブラリ
RUN apk add --no-cache libc6-compat openssl

# 本番環境フラグ
ENV NODE_ENV=production

# ── 依存関係: ルートの node_modules のみ（競合なし） ──
COPY --from=builder /app/node_modules ./node_modules

# ── バックエンド成果物 ──
COPY --from=builder /app/dist ./dist

# ── フロントエンド: standalone の中身を /app/frontend に展開 ──
# standalone 出力: .next/standalone/src/frontend/* → /app/frontend/
COPY --from=builder /app/src/frontend/.next/standalone/src/frontend ./frontend
# Next.js 16 の設定ファイル（runtimeServerDeploymentId 等を含む）
COPY --from=builder /app/src/frontend/.next/required-server-files.json ./frontend/.next/required-server-files.json
# static と public は standalone に含まれないため手動配置
COPY --from=builder /app/src/frontend/.next/static ./frontend/.next/static
COPY --from=builder /app/src/frontend/public ./frontend/public

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
