# Phase 7 本番環境変数設定テンプレート

## Railway 環境変数（API サービス）

```
# === データベース接続 ===
# Railway PostgreSQL の CONNECTION_STRING をコピーペーストしてください
DB_URL=postgresql://user:password@host:5432/tradeassist

# === 実行環境 ===
NODE_ENV=production

# === スケジューラー設定 ===
# Phase 7 では自動処理を行わないため false
CRON_ENABLED=false

# === サーバーポート ===
# Railway が自動割り当てするため、通常は設定不要
# BACKEND_PORT=（Railway が自動設定）

# === AI サービス設定（現在は未使用、プレースホルダー） ===
AI_API_KEY=（OpenAI API キーがあれば設定）
AI_MODEL=gpt-4o-mini
AI_BASE_URL=https://api.openai.com/v1

# === 市場データ API（現在は未使用、プレースホルダー） ===
MARKET_API_URL=（市場データ API エンドポイント）
MARKET_API_KEY=（市場データ API キー）

# === 通知サービス（現在は未使用、プレースホルダー） ===
PUSH_NOTIFICATION_KEY=（通知サービスキー）

# === マッチング判定設定 ===
MATCH_THRESHOLD=0.75
CHECK_INTERVAL_MINUTES=15
```

## Vercel 環境変数（UI サービス）

```
# === API 接続設定 ===
# Railway API の Public URL をコピーペーストしてください
# 例: https://api-production-xxxx.railway.app
NEXT_PUBLIC_API_BASE_URL=https://[api-production-url].railway.app
```

## 設定手順

### Step 1: Railway PostgreSQL Connection String の取得

1. [Railway Dashboard](https://railway.app/dashboard) にログイン
2. PostgreSQL サービスを選択
3. 「Connect」タブをクリック
4. 「CONNECTION_STRING」をコピー
   - 形式: `postgresql://user:password@host:port/dbname`

### Step 2: Railway API 環境変数設定

1. Railway Dashboard で API サービスを選択
2. 「Variables」タブをクリック
3. 上記テンプレートの変数を追加
4. 「Deploy」タブで「Redeploy」を実行（環境変数が反映される）

### Step 3: Railway API Public URL の確認

1. API サービスを選択
2. 「Settings」タブをクリック
3. 「Domains」セクションで「Public URL」をコピー
   - 例: `https://api-production-xxxx.railway.app`

### Step 4: Vercel 環境変数設定

1. [Vercel Dashboard](https://vercel.com/dashboard) にログイン
2. Project を選択
3. 「Settings」→「Environment Variables」をクリック
4. 以下を追加:
   - **Name**: `NEXT_PUBLIC_API_BASE_URL`
   - **Value**: 上記 Step 3 でコピーした URL
5. 「Save」をクリック

### Step 5: Vercel 再デプロイ

1. Vercel Dashboard → 「Deployments」タブ
2. 最新の Deployment を選択
3. 「Redeploy」ボタンをクリック
4. ビルドが完了するまで待機（約 1-3 分）

## 環境変数チェックリスト

### Railway API

- [ ] `DB_URL` が設定されている
- [ ] `NODE_ENV=production` が設定されている
- [ ] `CRON_ENABLED=false` が設定されている
- [ ] 変更後に Redeploy が実行された

### Vercel UI

- [ ] `NEXT_PUBLIC_API_BASE_URL` が設定されている
- [ ] URL が `https://` で始まっている
- [ ] URL が有効な Railway API Public URL である
- [ ] 変更後に Redeploy が実行された

## デバッグ用確認コマンド

### 環境変数の確認（ローカル開発時）

```bash
# Backend 環境変数の確認
echo "DB_URL: $DB_URL"
echo "NODE_ENV: $NODE_ENV"
echo "CRON_ENABLED: $CRON_ENABLED"

# Frontend 環境変数の確認（Next.js は NEXT_PUBLIC_* のみアクセス可能）
cd src/frontend
grep NEXT_PUBLIC .env.local 2>/dev/null || echo "No .env.local found"
```

### Railway API への疎通確認

```bash
# ローカルで API が起動している場合
curl -X GET http://localhost:3100/health

# 本番 Railway API への確認
curl -X GET https://[railway-api-url]/health
```

### Vercel デプロイログ確認

1. Vercel Dashboard → Project → Deployments
2. 最新の Deployment をクリック
3. 「Build Logs」タブで環境変数が正しく注入されているか確認

## セキュリティに関する注意

⚠️ **API キー / 認証情報は絶対にコミットしない**

- `.env` ファイルは `.gitignore` に含まれていることを確認
- 本番環境の環境変数は Railway / Vercel の Web UI でのみ管理
- Git リポジトリに秘密情報をプッシュした場合は、すぐに Railway / Vercel で無効化

## よくあるトラブル

### 「API 接続エラー」が UI で表示される

**原因**: `NEXT_PUBLIC_API_BASE_URL` が正しくない、または Railway API が起動していない

**確認方法**:
```bash
# Vercel で設定されている URL を確認
curl -X GET [NEXT_PUBLIC_API_BASE_URL]/health
```

**解決方法**:
1. Railway API の Public URL を再度確認
2. Vercel の環境変数を更新
3. Vercel で Redeploy を実行

### Migration エラーで API が起動しない

**原因**: DB 接続失敗、または Prisma Migration の失敗

**確認方法**:
1. Railway API のログを確認
2. `DB_URL` が正しい接続文字列であることを確認

**解決方法**:
1. Railway Dashboard で PostgreSQL サービスのステータスを確認
2. Connection String を再度取得して設定

