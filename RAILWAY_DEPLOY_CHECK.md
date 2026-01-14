# Railway デプロイ確認手順

## 1. Railway ダッシュボードで環境変数を確認

https://railway.app/project/[your-project-id]/service/[your-service-id]

### 必須環境変数（全て設定されているか確認）：

```
DATABASE_URL=postgresql://postgres:YJtRQLNgBFxGopFxRHMCZURURdxIwWrN@switchyard.proxy.rlwy.net:32154/railway?sslmode=require

NODE_ENV=production

JWT_SECRET=4OqCYL8AHR/9jGFrV/YPNyNw6R4xFdQZUYod5ZigbY4=
JWT_REFRESH_SECRET=CzxjTBRlDUgQf+DXhnF2/FyUGSUZhRR+e69ikgH5CH4=

AI_API_KEY=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
AI_MODEL=gpt-5-mini

MARKET_API_URL=https://api.twelvedata.com
MARKET_API_KEY=29bcf8b5b4a347ca9b7024796af7cd3e
TWELVE_DATA_API_KEY=29bcf8b5b4a347ca9b7024796af7cd3e

VAPID_PUBLIC_KEY=BLu1-CLYTs3lQusgFRphvfDdpikHindH17HAFgjXH-xHgS14HonP9XOTrC1AmCb1gr-SChxnW4XqUq6saHrsqI4
VAPID_PRIVATE_KEY=EFZs_-q5Df_RgOm6lCqOpPe7jBnJZC6ch0z_wx4r_MI
VAPID_SUBJECT=mailto:admin@tradeassist.local

CTRADER_CLIENT_ID=20178_vRM8hQu39iKOkBe8MMcYhS1KZQPRLbf3yRYU9BDY3gSuU9m92C
CTRADER_CLIENT_SECRET=5sd8gT5lt125qh7JZbxd6ccdSVTf91bzvkkVRiu7orbOiZAK5F

CRON_ENABLED=false
SIDE_B_SCHEDULER_ENABLED=false
```

**重要**: `PORT` は Railway が自動設定するので設定不要

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
