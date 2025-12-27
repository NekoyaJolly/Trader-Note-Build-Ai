# Phase 7 本番環境動作確認ガイド

**目的**: Railway / Vercel にデプロイ後、実際に動作することを確認するための手順書

---

## 目次

1. [Railway API 起動確認](#railway-api-起動確認)
2. [Vercel UI デプロイ確認](#vercel-ui-デプロイ確認)
3. [UI ↔ API 疎通確認](#ui--api-疎通確認)
4. [トラブルシューティング](#トラブルシューティング)

---

## Railway API 起動確認

### 手順 1：デプロイログの確認

1. [Railway Dashboard](https://railway.app/dashboard) にログイン
2. 対象 Project を選択
3. **API Service** を選択
4. **Deployments** タブをクリック
5. 最新の Deployment をクリック
6. **Build Logs** と **Deploy Logs** を確認

### 期待されるログ メッセージ

#### Build Phase

```
> npm ci
added 500+ packages

> npm run build
> tsc && npm run build:frontend
✓ Compiled successfully

> next build
✓ Compiled successfully in X seconds
✓ Generating static pages using 3 workers
✓ Creating optimized production build
```

**成功の指標**: ❌ エラーなし

#### Deploy Phase

```
Starting Railway VM...
✓ VM started
> npm start
node dist/index.js

Prisma connect...
✓ Prisma generated
> prisma migrate deploy
✓ Migrations applied successfully

═══════════════════════════════════════
  TradeAssist MVP Server
═══════════════════════════════════════
  Environment: production
  Server running on port: [ASSIGNED_PORT]
  Match threshold: 0.75
  Check interval: 15 minutes
═══════════════════════════════════════
```

**成功の指標**: 
- ✅ ポート割り当て完了
- ✅ Migration 成功
- ✅ Server started

### 手順 2：API Public URL の確認

1. API Service の **Settings** タブをクリック
2. **Domains** セクションで **Public URL** をコピー
   - 例: `https://trader-assist-api-production-xxxx.railway.app`

### 手順 3：ヘルスチェック エンドポイント確認

```bash
# Terminal または Browser で実行
curl -X GET https://[RAILWAY_API_URL]/health
```

**期待される応答** (200 OK):

```json
{
  "status": "ok",
  "timestamp": "2025-12-27T10:30:45.123Z",
  "schedulerRunning": false
}
```

**確認項目**:
- [x] HTTP Status Code: **200**
- [x] `status`: **"ok"**
- [x] `schedulerRunning`: **false**（Cron 無効化を確認）
- [x] `timestamp`: 現在時刻が ISO 8601 形式

---

## Vercel UI デプロイ確認

### 手順 1：Vercel デプロイログの確認

1. [Vercel Dashboard](https://vercel.com/dashboard) にログイン
2. 対象 Project を選択
3. **Deployments** タブをクリック
4. 最新の Deployment をクリック
5. **Build Logs** を確認

### 期待されるログ メッセージ

```
Building production bundle...
> next build

✓ Compiled successfully
✓ Generating static pages using 3 workers (5/5) in 163ms
✓ Finalizing page optimization

Route (app)
├ ○ /
├ ○ /_not-found
├ ○ /notifications
└ ƒ /notifications/[id]

Build output size: 250 KB
```

**成功の指標**:
- ✅ ビルド成功
- ✅ エラーなし
- ✅ ステータス: **Ready** (緑)

### 手順 2：Vercel Production URL の確認

Vercel Dashboard で Project を選択:
```
Domain: https://[project-name].vercel.app
```

### 手順 3：Production ページの表示確認

Browser で Production URL を開く:

```
https://[project-name].vercel.app
```

**確認事項**:
- [x] ページが正常に読み込まれる
- [x] レイアウト / スタイルが表示されている
- [x] JavaScript エラーが Console に出力されていない
- [x] 画像 / 静的リソースが正常に読み込まれている

---

## UI ↔ API 疎通確認

### 手順 1：Vercel 環境変数の確認

1. Vercel Dashboard → Project Settings → Environment Variables
2. 以下が設定されていることを確認:

```
NEXT_PUBLIC_API_BASE_URL = https://[railway-api-url]
```

### 手順 2：Browser DevTools で Network を監視

1. Production URL を Browser で開く
2. DevTools を開く（F12 または ⌘+Option+I）
3. **Network** タブをクリック
4. **XHR/Fetch** フィルタを有効化
5. ページをリロード（F5）

### 期待される API リクエスト

```
Request: GET [API_BASE_URL]/api/notifications
Status: 200 OK
Response:
  []  (空配列)
```

**確認事項**:
- [x] API リクエストが送信されている
- [x] ステータスコード: **200 系**
- [x] CORS エラーがない
- [x] レスポンスが JSON 形式

### 手順 3：API 直接呼び出し確認

Terminal で実行:

```bash
# /api/notifications エンドポイント
curl -X GET https://[railway-api-url]/api/notifications

# 期待される応答
[]
```

```bash
# /health エンドポイント（再確認）
curl -X GET https://[railway-api-url]/health

# 期待される応答
{
  "status": "ok",
  "timestamp": "...",
  "schedulerRunning": false
}
```

### 手順 4：UI 画面状態の確認

Production UI で以下を確認:

#### ホームページ (`/`)

- [x] ページが表示される
- [x] トップページのコンテンツが見える
- [x] ナビゲーションが機能している

#### 通知ページ (`/notifications`)

- [x] ページが表示される
- [x] 通知一覧が表示される（空状態 OK）
- [x] 空状態メッセージが表示される（例: "通知がありません"）

#### 動的ページ (`/notifications/[id]`)

- [ ] 存在しない ID でアクセス（例: `/notifications/invalid-id`）
  - 期待: 404 またはエラーメッセージが表示される
  - 実際: ？

---

## Database 接続確認

### 手順 1：Railway PostgreSQL ステータス確認

1. [Railway Dashboard](https://railway.app/dashboard) にログイン
2. 対象 Project を選択
3. **PostgreSQL Service** を選択
4. **Status** タブを確認
   - 期待: **Running** (緑)

### 手順 2：API ログで DB 接続確認

1. API Service の **Logs** タブを開く
2. 以下のログが出力されていることを確認:

```
Prisma connecting to database...
✓ Prisma connected successfully
✓ Database tables verified
```

**確認項目**:
- [x] DB 接続成功
- [x] テーブル存在確認完了
- [x] エラーログなし

---

## トラブルシューティング

### 現象 1：API が起動しない（Railway で Failed 表示）

**原因の可能性**:
1. `DB_URL` が正しくない
2. PostgreSQL サービスが Running していない
3. Migration に失敗している

**確認手順**:

```bash
# 1. DB_URL が設定されているか確認
railway variables list

# 2. PostgreSQL サービスが Running か確認
# Railway Dashboard で確認

# 3. ローカルで Migration テストを実行
DB_URL="postgresql://..." npx prisma migrate deploy --preview-features
```

**修正方法**:
1. Railway Dashboard で PostgreSQL サービスを再起動
2. API Service を Redeploy

---

### 現象 2：UI から API にアクセスできない（CORS エラー）

**原因の可能性**:
1. `NEXT_PUBLIC_API_BASE_URL` が正しくない
2. API の CORS 設定が不足している

**確認手順**:

```bash
# 1. Vercel 環境変数を確認
# Vercel Dashboard → Settings → Environment Variables

# 2. API への直接アクセスを確認
curl -X GET https://[api-url]/health

# 3. Browser Console でエラーメッセージを確認
```

**修正方法**:
1. Vercel で `NEXT_PUBLIC_API_BASE_URL` を正しい URL に修正
2. Vercel で **Redeploy** を実行

---

### 現象 3：UI が「API 接続エラー」を表示している

**原因の可能性**:
1. API が起動していない
2. API のレスポンスが遅い
3. ネットワーク接続に問題がある

**確認手順**:

```bash
# 1. API の健全性を確認
curl -X GET https://[api-url]/health
curl -X GET https://[api-url]/api/notifications

# 2. API のレスポンス時間を確認
time curl -X GET https://[api-url]/health
```

**修正方法**:
1. Railway で API サービスを Redeploy
2. API ログでエラーを確認

---

### 現象 4：ビルドに失敗（Railway または Vercel）

**原因の可能性**:
1. Node.js バージョン不一致
2. 依存関係のインストール失敗
3. TypeScript コンパイルエラー

**確認手順**:

```bash
# ローカルでビルド確認
npm install
npm run build

# エラーメッセージを確認
```

**修正方法**:
1. ローカルでエラーを修正
2. Git にコミット・Push
3. Railway / Vercel が自動的に再デプロイする

---

## 完了チェックリスト

すべての手順を完了したら、以下をチェック:

### Railway API

- [ ] **Build**: ✅ 成功
- [ ] **Deploy**: ✅ 成功、Running 状態
- [ ] **Logs**: ✅ Prisma Migration 成功、エラーなし
- [ ] **Public URL**: ✅ 確認済み
- [ ] **/health**: ✅ 200 OK、レスポンス正常
- [ ] **Database**: ✅ Running、接続確認済み

### Vercel UI

- [ ] **Build**: ✅ 成功
- [ ] **Deploy**: ✅ Ready 状態
- [ ] **Production URL**: ✅ 表示可能
- [ ] **Environment Variables**: ✅ 設定済み
- [ ] **Pages**: ✅ 表示可能、エラーなし

### 疎通確認

- [ ] **UI → API**: ✅ Network リクエスト送信
- [ ] **API → DB**: ✅ 接続成功
- [ ] **API エンドポイント**: ✅ 200 系レスポンス
- [ ] **Empty State**: ✅ 空状態が正常に表示される

---

## 記録

**確認日時**: ________________  
**確認者**: ________________  
**結果**: ⬜ 準備中 / ✅ 成功 / ⚠️ 警告 / ❌ 失敗

**メモ / トラブル記録**:

```
[記入例]
- 初回デプロイで Migration タイムアウト → Redeploy で解決
- CORS エラー → API_BASE_URL 設定ミス → 修正済み
```

---

