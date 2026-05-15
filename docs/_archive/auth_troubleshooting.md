# 認証エラー トラブルシューティング

## 事象

デプロイ後にログインしようとすると「認証エラー」が発生する。

---

## 調査結果（2026/02/13）

### 1. ログから判明したこと

| 時刻 | イベント |
|------|----------|
| 20:12:30 | cTrader から認可コード受信、コールバック処理開始 |
| 20:12:30 | **ログイン成功のログなし**（callback 完了していない） |
| 20:12:36 | `Too many database connections` - DB 接続枯渇 |
| 20:12:36 | `/me` が `hasCookie: false, hasAuthHeader: false` で 401 |
| 20:12:37 | コンテナ異常終了 (exit 1) |

### 2. 根本原因

**DB 接続枯渇による認証コールバックの失敗**

- OAuth コールバック (`POST /api/auth/ctrader/callback`) が認可コードを受け取り、`exchangeCodeAndLogin` で DB アクセスしようとした際に接続を取得できず失敗
- その後も DB 接続枯渇が続き、コンテナがクラッシュ
- ユーザーにはトークンが返らず「認証エラー」となる

### 3. 補足：認証フローの概要

1. ユーザーが cTrader で認可 → リダイレクト
2. フロント（Vercel）`/auth/ctrader/callback` で code 取得
3. バックエンド（GCP）`POST /api/auth/ctrader/callback` に code 送信
4. バックエンド: code → トークン交換、DB にユーザー保存、JWT 発行
5. JWT をレスポンスの `token` と Cookie の両方で返す
6. フロント: `saveToken(data.token)` で localStorage に保存、`/` へリダイレクト

**重要**: ステップ 4 で DB 接続を取得できないと、5・6 まで到達しない。

---

## 対策

### 対策 1: Supabase Transaction モード（プーラー）の利用（推奨）★実施済み

Cloud Run + Prisma では直接接続（5432）だと接続枯渇しやすい。**Transaction モード（6543）** を使用する。

**実行手順：**

```bash
./scripts/setup-supabase-pooler.sh
gcloud run services update trader-note --region asia-northeast1 --project ai-note-486020 --update-secrets DATABASE_URL=DATABASE_URL:latest
```

詳細は [docs/supabase_pooler_setup.md](supabase_pooler_setup.md) を参照。

**接続構成：**
- `DATABASE_URL`: port 6543 + `?pgbouncer=true`（アプリ実行用）
- `DIRECT_URL`: port 5432（マイグレーション用、変更不要）

### 対策 2: CTRADER_REDIRECT_URI の確認

cTrader の Redirect URI と完全一致させる。  
**ローカル（localhost）**の最短手順は [cTrader-localhost-cheatsheet.md](cTrader-localhost-cheatsheet.md) を参照。

**確認項目：**

1. connect.spotware.com の cTrader アプリ設定の Redirect URIs に次が含まれているか  
   - `https://trader-note-build-ai.vercel.app/auth/ctrader/callback`
2. GCP Secret Manager の `CTRADER_REDIRECT_URI` が同じ値か  
   - `gcloud secrets versions access latest --secret=CTRADER_REDIRECT_URI --project=ai-note-486020`

末尾スラッシュやプロトコル (`http` vs `https`) の違いも不一致の原因になるので、完全一致を確認する。

### 対策 3: 一時的な対処（ユーザー向け）

DB 負荷・接続枯渇が疑われる場合：

- 数分待ってから再度ログインを試す
- 負荷の高い時間帯を避けてログインする

---

## 関連ファイル

| ファイル | 役割 |
|----------|------|
| `src/backend/api/ctraderAuthRoutes.ts` | 認証 API（callback を含む） |
| `src/frontend/app/auth/ctrader/callback/page.tsx` | コールバック用フロント |
| `src/backend/services/auth/sessionService.ts` | JWT・Cookie 設定 |
| `src/frontend/contexts/AuthContext.tsx` | 認証コンテキスト・トークン管理 |
| `src/infrastructure/prismaClient.ts` | Prisma クライアント |

---

## ログ確認コマンド

```bash
# 認証関連ログ
gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=trader-note AND textPayload=~"cTraderAuth"' \
  --limit 30 --project ai-note-486020 --format='table(timestamp,textPayload)'

# DB 接続エラー
gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=trader-note AND textPayload=~"connection"' \
  --limit 20 --project ai-note-486020 --format='table(timestamp,textPayload)'
```
