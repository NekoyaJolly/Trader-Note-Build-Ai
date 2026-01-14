# Railway デプロイ確認手順

## 1. Railway ダッシュボードで環境変数を確認

https://railway.app/project/[your-project-id]/service/[your-service-id]

### 必須環境変数（全て設定されているか確認）：

```
DATABASE_URL=postgresql://postgres:****@switchyard.proxy.rlwy.net:32154/railway?sslmode=require

NODE_ENV=production

JWT_SECRET=****
JWT_REFRESH_SECRET=****

AI_API_KEY=sk-****
AI_MODEL=gpt-5-mini

MARKET_API_URL=https://api.twelvedata.com
MARKET_API_KEY=****
TWELVE_DATA_API_KEY=****

VAPID_PUBLIC_KEY=****
VAPID_PRIVATE_KEY=****
VAPID_SUBJECT=mailto:admin@tradeassist.local

CTRADER_CLIENT_ID=****
CTRADER_CLIENT_SECRET=****

CRON_ENABLED=false
SIDE_B_SCHEDULER_ENABLED=false
```

**重要**: 
- `PORT` は Railway が自動設定するので設定不要
- 実際のシークレット値は `.env` ファイルから取得し、Railway Variables に設定してください
- パスワードやキーをドキュメントに記載しないこと

## 2. Railway ビルドコマンド確認

**Settings** → **Build Command** が以下になっているか確認：

```
npm install && npm run build:backend
```

## 3. Railway スタートコマンド確認

**Settings** → **Start Command** が以下になっているか確認：

```
node dist/index.js
```

## 4. デプロイログ確認

**Deployments** → 最新デプロイ → **View Logs**

### 確認すべきエラー：

- [ ] `npm install` が成功しているか
- [ ] `npx prisma generate` が成功しているか
- [ ] `tsc` (TypeScript コンパイル) が成功しているか
- [ ] `node dist/index.js` が起動しているか
- [ ] DATABASE_URL 関連のエラーがないか
- [ ] 環境変数の読み込みエラーがないか

## 5. エラーが見つかったら

ログのエラー部分をコピーして共有してください。

## 6. テスト

デプロイ完了後：

```bash
# Health check
curl https://trader-note-build-ai-production.up.railway.app/health

# cTrader 認証 URL 取得
curl https://trader-note-build-ai-production.up.railway.app/api/auth/ctrader/url
```

## トラブルシューティング

### DATABASE_URL が認識されない場合

Railway PostgreSQL の Variables タブで `DATABASE_URL` をコピーし、
Node.js サービスの Variables で直接設定（参照変数 `${{...}}` ではなく実際の値）

### ビルドは成功するが起動に失敗する場合

Start Command を確認：
- ❌ `npm start` → Procfile を無視する可能性
- ✅ `node dist/index.js` → 直接実行

### PORT エラーが出る場合

Railway は自動で `PORT` 環境変数を設定します。
`config.server.port` が `process.env.PORT` を読んでいることを確認。
