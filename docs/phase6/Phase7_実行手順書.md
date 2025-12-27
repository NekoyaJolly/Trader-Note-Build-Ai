# Phase 7 Railway / Vercel デプロイ 実行手順書

**対象**: TradeAssist MVP 本番環境構築  
**実行期間**: 2025-12-27 以降  
**完了予定時間**: 30-60 分（初回のみ）

---

## 前提条件

- [ ] Railway アカウントが存在する（[https://railway.app](https://railway.app)）
- [ ] Vercel アカウントが存在する（[https://vercel.com](https://vercel.com)）
- [ ] GitHub アカウントが存在し、Repository `NekoyaJolly/Trader-Note-Build-Ai` が public
- [ ] 本コンピュータに `curl` または `Terminal` がインストール済み

---

## 【Step 7-1】Railway PostgreSQL + API 構築（所要時間: 15-20 分）

### 1-1：Railway で New Project を作成

1. [Railway Dashboard](https://railway.app/dashboard) にログイン
2. 右上の「+ New Project」をクリック
3. 「Provision PostgreSQL」を選択
4. 自動的に新規 Project が生成される

### 1-2：PostgreSQL サービスの確認

1. Dashboard に「PostgreSQL」サービスが表示される
2. ステータスが「Running」に変わるまで待機（約 1-2 分）

**確認内容**:
- Service name: `postgres`
- Status: 🟢 Running

### 1-3：API Service を GitHub リポジトリから作成

1. 同じ Project 内で「+ New」をクリック
2. 「GitHub Repo」を選択
3. GitHub 認可画面で「Authorize」をクリック
4. Repository リスト から `NekoyaJolly/Trader-Note-Build-Ai` を選択
5. 「Add」をクリック

### 1-4：API Service デプロイ設定

Railway が自動検出した設定を確認:

```
Framework: Node.js
Root Directory: /
Build Command: npm run build
Start Command: npm start
```

設定が正しい場合は「Deploy」をクリック。

**初回デプロイは自動的に開始されます。**

### 1-5：API Service に環境変数を設定

1. API Service を選択（「api」または「Trader-Note-Build-Ai」）
2. 「Variables」タブをクリック
3. 以下を追加:

#### PostgreSQL Connection String の取得

1. PostgreSQL Service を選択
2. 「Connect」タブをクリック
3. **CONNECTION_STRING** をコピー

#### 環境変数を設定

| 変数名 | 値 |
|--------|-----|
| `DB_URL` | コピーした CONNECTION_STRING |
| `NODE_ENV` | `production` |
| `CRON_ENABLED` | `false` |

4. 「Variables」タブで変数をペースト
5. **Save** をクリック

### 1-6：API Service を Redeploy

1. API Service を選択
2. 右上の「⋮」メニュで「Redeploy」をクリック
3. Deploy ログを監視

**成功の確認**:
```
✓ Build completed
✓ Deployment successful
✓ Service is running
```

### 1-7：API Service の Public URL を取得

1. API Service を選択
2. 「Settings」タブをクリック
3. 「Domains」セクションで **Public URL** をコピー
   - 例: `https://trader-assist-api-production-xxxx.railway.app`

**このURLは後で使用します。保存してください。**

---

## 【Step 7-2】Vercel UI デプロイ（所要時間: 10-15 分）

### 2-1：Vercel で Project を作成

1. [Vercel Dashboard](https://vercel.com/dashboard) にログイン
2. 「+ Add New」をクリック
3. 「Project」を選択
4. GitHub リポジトリリストから `NekoyaJolly/Trader-Note-Build-Ai` を選択
5. 「Import」をクリック

### 2-2：Vercel デプロイ設定を確認

Vercel が自動検出した設定:

```
Framework Preset: Next.js
Root Directory: src/frontend
Build Command: npm run build
Output Directory: .next
```

設定が正しい場合は、次に進みます。

### 2-3：Vercel に環境変数を設定

1. 「Environment Variables」セクションまでスクロール
2. 「Add」をクリック
3. 以下を追加:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_API_BASE_URL` | Step 7-1-7 でコピーした Railway API URL |

例: `https://trader-assist-api-production-xxxx.railway.app`

4. 「Deploy」をクリック

### 2-4：Vercel デプロイを監視

1. Deploy ログを監視
2. 以下のメッセージが表示されたら成功:
   ```
   ✓ Build Completed Successfully
   ✓ Deployment Ready
   ```

### 2-5：Vercel Production URL を確認

1. Vercel Dashboard で Project を選択
2. 「Domains」セクションで Production URL を確認
   - 例: `https://trader-assist-mvp.vercel.app`

---

## 【Step 7-3】疎通確認（所要時間: 5-10 分）

### 3-1：API ヘルスチェック

```bash
curl -X GET https://[RAILWAY_API_URL]/health
```

**期待される応答**:
```json
{
  "status": "ok",
  "timestamp": "2025-12-27T...",
  "schedulerRunning": false
}
```

✅ **成功**: HTTP 200 + 上記の JSON

❌ **失敗**: エラーが表示される場合は、[トラブルシューティング](Phase7_本番環境動作確認ガイド.md#トラブルシューティング)を参照

### 3-2：API 通知エンドポイント確認

```bash
curl -X GET https://[RAILWAY_API_URL]/api/notifications
```

**期待される応答**:
```json
[]
```

✅ **成功**: HTTP 200 + 空配列

### 3-3：UI ページを Browser で開く

1. Browser で Vercel Production URL を開く
   ```
   https://[VERCEL_UI_URL]
   ```

2. ページが正常に表示されることを確認

3. DevTools を開く（F12）

4. **Network** タブで以下を確認:
   - API リクエストが送信されている
   - レスポンスステータスが 200 系
   - `/api/notifications` へのリクエストが成功している

### 3-4：統合スクリプトで一括確認（オプション）

```bash
chmod +x scripts/phase7-verify.sh

./scripts/phase7-verify.sh \
  https://[RAILWAY_API_URL] \
  https://[VERCEL_UI_URL]
```

---

## チェックリスト（完了確認）

### Railway API

- [ ] PostgreSQL サービス: Running
- [ ] API サービス: Running
- [ ] DB_URL が設定されている
- [ ] NODE_ENV=production が設定されている
- [ ] CRON_ENABLED=false が設定されている
- [ ] `/health` が 200 OK を返す
- [ ] Public URL が取得できた

### Vercel UI

- [ ] GitHub リポジトリが連携された
- [ ] ビルドが成功した
- [ ] NEXT_PUBLIC_API_BASE_URL が設定された
- [ ] Production URL がアクセス可能
- [ ] ページが正常に表示される
- [ ] DevTools で API リクエストが確認できた

### 疎通確認

- [ ] API /health: 200 OK
- [ ] API /notifications: 200 OK + 空配列
- [ ] UI ページ: 正常表示
- [ ] API ↔ UI: 疎通確認済み

---

## よくあるエラーと対応

### エラー: API が起動しない（Railway で Failed）

**確認事項**:
1. PostgreSQL サービスが Running か確認
2. DB_URL が正しい接続文字列か確認
3. API のデプロイログでエラーメッセージを確認

**対応**:
```bash
# Railway Dashboard で API を Redeploy
```

### エラー: CORS エラーが表示される

**確認事項**:
1. Vercel の NEXT_PUBLIC_API_BASE_URL が正しいか確認
2. Railway API の Public URL が正しいか確認

**対応**:
```bash
# Vercel で環境変数を修正して Redeploy
```

### エラー: Vercel ビルドが失敗

**確認事項**:
1. ローカルでビルドを確認: `npm run build`
2. Vercel の Build Logs を確認

**対応**:
```bash
# ローカルでエラーを修正して Git Push
# Vercel が自動的に再デプロイする
```

---

## 完了報告

すべてのチェックが完了したら、[完了報告フォーマット](Phase7_本番インフラ構築ガイド.md#完了報告フォーマット)に従って報告してください。

---

## 参考資料

- [Railway Documentation](https://docs.railway.app/)
- [Vercel Documentation](https://vercel.com/docs)
- [Phase 7 本番インフラ構築ガイド](Phase7_本番インフラ構築ガイド.md)
- [Phase 7 環境変数テンプレート](Phase7_環境変数テンプレート.md)
- [Phase 7 本番環境動作確認ガイド](Phase7_本番環境動作確認ガイド.md)

