# Phase 7：本番インフラ構築ガイド（Deploy Infra）

**実行日**: 2025-12-27  
**目的**: TradeAssist MVP の本番インフラを構築し、「空でも本番環境が生きている」状態を実現

---

## 実行前チェック

- [ ] Phase 6（仕様フリーズ）が完了済みであることを確認
- [ ] AGENTS.md を読み、本フェーズでの禁止事項を理解
- [ ] Railway / Vercel アカウントが存在すること
- [ ] GitHub リポジトリが public または適切な権限があること

---

## Step 7-1：Railway（API / DB）構築

### 7-1-1：Railway PostgreSQL サービス作成

**実行手順**:

1. [Railway Dashboard](https://railway.app/dashboard) にログイン
2. 「+ New Project」クリック
3. 「Provision PostgreSQL」を選択
4. サービス詳細設定:
   - **Database name**: `tradeassist`
   - **Username**: `tradeassist_user`（自動生成 OK）
   - **Password**: 自動生成（複雑なパスワードであることを確認）
   - **Port**: 5432（デフォルト）

5. サービスが Running 状態になるまで待機（約 1-2 分）

**完了確認**: Railway Dashboard で PostgreSQL サービスが「Running」と表示される

---

### 7-1-2：Railway API サービス作成

**事前準備**:

GitHub リポジトリが以下の構成であることを確認:
```
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   └── app.ts
├── prisma/
│   └── schema.prisma
└── .gitignore（node_modules を含むこと）
```

**実行手順**:

1. Railway Dashboard で「+ New」→「GitHub Repo」を選択
2. GitHub リポジトリを選択: `NekoyaJolly/Trader-Note-Build-Ai`
3. デプロイ設定:
   - **Root Directory**: `/`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Install Command**: `npm install`

4. 環境変数を設定（以下参照）

**完了確認**: Railway Dashboard で API サービスが「Running」と表示される

---

### 7-1-3：Railway 環境変数設定

API サービスに以下の環境変数を設定:

| 変数名 | 値 | 説明 |
|--------|-----|------|
| `DB_URL` | PostgreSQL の CONNECTION_STRING | Prisma が接続するための接続文字列 |
| `NODE_ENV` | `production` | 本番環境として認識 |
| `CRON_ENABLED` | `false` | 自動スケジューリングを無効化 |
| `AI_API_KEY` | （任意）OpenAI API キー | AI 機能用（現在は未使用） |
| `MARKET_API_KEY` | （任意） | 市場データ API キー（現在は未使用） |

**取得方法**:

1. Railway Dashboard で PostgreSQL サービスを選択
2. 「Connect」タブで **CONNECTION_STRING** をコピー
3. API サービスの「Variables」タブでペースト

**設定確認コマンド** (Railway CLI):

```bash
railway variables list
```

**完了確認**:
- Railway Dashboard で環境変数が正しく設定されていることを確認
- API サービスのログに「Server running on port」メッセージがあることを確認

---

### 7-1-4：Prisma Migration 実行

API サービスのデプロイ時に自動実行されます。

**デプロイログで確認する内容**:

```
> prisma migrate deploy
✓ Migrations applied successfully
```

**トラブル時の確認**:

- PostgreSQL が Running 状態であること
- `DB_URL` が正しい接続文字列であること
- firewall で PostgreSQL ポート (5432) が開いていること

---

## Step 7-2：Vercel（UI）構築

### 7-2-1：Vercel GitHub 連携

**実行手順**:

1. [Vercel Dashboard](https://vercel.com/dashboard) にログイン
2. 「Add New」→「Project」を選択
3. GitHub リポジトリを選択: `NekoyaJolly/Trader-Note-Build-Ai`
4. Vercel が自動検出した設定を確認:
   - **Framework**: Next.js
   - **Root Directory**: `src/frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`

---

### 7-2-2：Vercel 環境変数設定

UI サービスに以下の環境変数を設定:

| 変数名 | 値 | 説明 |
|--------|-----|------|
| `NEXT_PUBLIC_API_BASE_URL` | Railway API の URL | 例: `https://api-production-xxxx.railway.app` |

**Railway API URL の確認**:

1. Railway Dashboard で API サービスを選択
2. 「Settings」タブで「Domains」を確認
3. 「Public URL」をコピー

**設定方法**:

1. Vercel Project Settings → Environment Variables
2. 「Add new」で上記を追加
3. Deployment に反映させるため、再度デプロイするか「Redeploy」を選択

---

### 7-2-3：Vercel ビルド確認

**Deployment が成功していることを確認**:

1. Vercel Dashboard で Project を選択
2. 「Deployments」タブを開く
3. 最新の Deployment ステータスが「Ready」（緑）であること
4. ビルドログで「Build Completed Successfully」メッセージがあること

**トラブル時の確認**:

- 「Build Logs」タブでエラーメッセージを確認
- Node.js バージョンが Next.js 要件に合致していること
- 環境変数が正しく設定されていること

---

### 7-2-4：Production / Preview 環境の確認

**Production URL**:
```
https://[project-name].vercel.app
```

**Preview Environment**:
- GitHub PR を作成すると自動的に Preview URL が生成される

---

## Step 7-3：疎通確認

### 7-3-1：API → DB 接続確認

**方法 1: API ログで確認**

Railway Dashboard で API サービスを選択:
```
Logs タブでデプロイメッセージを確認
✓ "Prisma connected to database"
✓ "Database tables created/verified"
```

**方法 2: API エンドポイントで確認**

```bash
curl -X GET https://[railway-api-url]/health
```

**期待される応答**:
```json
{
  "status": "ok",
  "timestamp": "2025-12-27T...",
  "schedulerRunning": false
}
```

### 7-3-2：UI → API 疎通確認

**方法 1: Browser DevTools で確認**

1. Vercel Production URL をブラウザで開く
2. DevTools → Network タブを開く
3. API リクエストが `NEXT_PUBLIC_API_BASE_URL` に対して送信されていることを確認
4. ステータスコードが 200 番台であること

**方法 2: 直接 API 呼び出し**

```bash
curl -X GET https://[railway-api-url]/api/notifications
```

**期待される応答**:
```json
[]
```
（空配列 = データなし状態で OK）

### 7-3-3：UI 画面表示確認

1. Vercel Production URL をブラウザで開く
2. 以下を確認:
   - [ ] ページが正常に表示される
   - [ ] JavaScript エラーがコンソールに出力されていない
   - [ ] ローディング状態から正常にレンダリングされる
   - [ ] 空状態のメッセージが表示される（例: "通知がありません"）

**DevTools Console での確認**:
```
❌ エラー: "API connection failed"
✅ 期待: エラーなし、または API error logs の情報メッセージのみ
```

---

## チェックリスト（完了確認用）

### Railway

- [ ] PostgreSQL サービスが Running
- [ ] API サービスが Running
- [ ] `DB_URL` が正しく設定されている
- [ ] `NODE_ENV=production` が設定されている
- [ ] `CRON_ENABLED=false` が設定されている
- [ ] API ログに DB 接続成功メッセージがある
- [ ] `/health` エンドポイントが 200 を返す

### Vercel

- [ ] GitHub リポジトリが連携されている
- [ ] Production ビルドが「Ready」状態
- [ ] `NEXT_PUBLIC_API_BASE_URL` が正しく設定されている
- [ ] Production URL がブラウザで表示される
- [ ] Console にエラーがない

### 疎通確認

- [ ] `curl -X GET [API_URL]/health` が 200 を返す
- [ ] `curl -X GET [API_URL]/api/notifications` が空配列を返す
- [ ] UI ページが正常に表示される
- [ ] UI → API 通信が Network タブで確認できる

---

## トラブルシューティング

### Railway DB が接続できない

**原因**: `DB_URL` が正しくない、または PostgreSQL サービスが起動していない

**対処**:
1. Railway Dashboard で PostgreSQL サービスのステータスを確認
2. Connection String を再度コピーして確認
3. API サービスの環境変数を再度設定

### Vercel ビルドエラー

**原因**: Node.js バージョン不一致、環境変数不足

**対処**:
1. Vercel Build Logs を確認
2. `src/frontend/package.json` の依存関係を確認
3. 環境変数が漏れていないか確認

### UI が「API 接続エラー」を表示

**原因**: `NEXT_PUBLIC_API_BASE_URL` が正しくない

**対処**:
1. Railway API の Public URL を確認
2. Vercel 環境変数を修正
3. Vercel Dashboard で「Redeploy」を実行

---

## 完了報告フォーマット

すべてのチェックリスト項目を完了したら、以下のフォーマットで報告してください：

```
Phase 7 完了報告：

✅ Railway API: 起動成功
   - URL: https://[api-url]
   - /health レスポンス: 200 OK
   - ログ確認: DB 接続成功

✅ Railway DB: 接続確認済み
   - PostgreSQL サービス: Running
   - Migration 実行: 成功
   - テーブル生成: 確認済み

✅ Vercel Production: ビルド成功
   - URL: https://[ui-url]
   - ビルドログ: 成功
   - ステータス: Ready

✅ UI → API 疎通: OK
   - Network リクエスト: 200 系
   - API レスポンス: 正常
   - 空状態表示: 確認済み

✅ API → DB 疎通: OK
   - Connection String: 有効
   - Prisma Migration: 成功
   - ログエラー: なし

**Phase 7 本番インフラ構築完了**
次フェーズ（Phase 8）の実行準備完了
```

---

## 注意事項

### 禁止事項（Phase 7）

❌ DB へのデータ投入  
❌ CSV インポート実行  
❌ Cron / 自動処理の有効化  
❌ migrate reset / seed コマンド実行  
❌ 仕様変更・コード修正  

### 本番環境運用方針

- **append-only 運用**: データは追記のみ、削除は不可
- **ログ保持**: 最低限の要件のみ保持
- **バックアップ**: Railway のデフォルト自動バックアップを利用

---

## 参考資料

- [Railway Documentation](https://docs.railway.app/)
- [Vercel Documentation](https://vercel.com/docs)
- [Prisma Deployment Guide](https://www.prisma.io/docs/guides/deployment)
- AGENTS.md（本プロジェクト）
- Phase 6 仕様フリーズドキュメント

