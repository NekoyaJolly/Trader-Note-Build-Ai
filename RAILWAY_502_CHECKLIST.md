# 🚨 Railway 502 エラー - 最終チェックリスト

## 現状

- ✅ ローカルビルド成功
- ✅ ローカルサーバー起動成功
- ✅ Prisma 6.19.2 アップグレード完了
- ✅ Express 4.21.2 ダウングレード完了
- ✅ DATABASE_URL 接続テスト成功（ローカル→Railway PostgreSQL）
- ✅ railway.json 追加
- ✅ Procfile 追加
- ❌ **Railway 502 Bad Gateway（継続中）**

## Railway ダッシュボードで確認すべき項目

### 1. デプロイログ確認（最優先）

https://railway.app → プロジェクト → **Deployments** → 最新デプロイ → **View Logs**

**Build Logs で確認:**
```
✅ npm install が成功しているか
✅ npx prisma generate が成功しているか  
✅ tsc (TypeScript) が成功しているか
```

**Deploy Logs で確認:**
```
❌ node dist/index.js でエラーが出ていないか
❌ DATABASE_URL エラーが出ていないか
❌ 環境変数エラーが出ていないか
❌ モジュールが見つからないエラーが出ていないか
```

### 2. 環境変数設定確認

**Settings** → **Variables**

以下の環境変数が **全て** 設定されているか確認：

**必須環境変数リスト**（実際の値は `.env` ファイルから取得）：

- [ ] `DATABASE_URL` （PostgreSQL 接続文字列）
- [ ] `NODE_ENV` = `production`
- [ ] `JWT_SECRET` （JWT 署名鍵）
- [ ] `JWT_REFRESH_SECRET` （JWT リフレッシュ鍵）
- [ ] `AI_API_KEY` （OpenAI API キー）
- [ ] `AI_MODEL` = `gpt-5-mini`
- [ ] `MARKET_API_URL` = `https://api.twelvedata.com`
- [ ] `MARKET_API_KEY` （Twelve Data API キー）
- [ ] `TWELVE_DATA_API_KEY` （Twelve Data API キー）
- [ ] `VAPID_PUBLIC_KEY` （Web Push 公開鍵）
- [ ] `VAPID_PRIVATE_KEY` （Web Push 秘密鍵）
- [ ] `VAPID_SUBJECT` = `mailto:admin@tradeassist.local`
- [ ] `CTRADER_CLIENT_ID` （cTrader クライアント ID）
- [ ] `CTRADER_CLIENT_SECRET` （cTrader クライアント秘密鍵）

**⚠️ セキュリティ注意**: 
- パスワードやキーを公開リポジトリに記載しないこと
- `.env` ファイルから取得した実際の値を Railway に設定
- Git コミット前に `git log` でシークレットが含まれていないか確認

### 3. ビルド設定確認

**Settings** → **Build**

- **Build Command**: `npm install && npm run build:backend`
- **Start Command**: `node dist/index.js`

### 4. Railway サービス設定

**Settings** → **Service**

- **Root Directory**: `/` (デフォルト)
- **Watch Paths**: (空欄でOK)

## よくあるエラーパターン

### パターン 1: DATABASE_URL が参照変数のまま

**症状**: ログに `${{Postgres.DATABASE_URL}}` が表示される

**解決方法**:
1. PostgreSQL サービスの **Variables** タブを開く
2. `DATABASE_URL` の値をコピー
3. Node.js サービスの **Variables** で `DATABASE_URL` を新規作成
4. コピーした値を貼り付け（参照ではなく実値）

### パターン 2: Prisma Client が生成されていない

**症状**: `Cannot find module '@prisma/client'`

**解決方法**:
Build Command を確認:
```bash
npm install && npx prisma generate && tsc
```

または `railway.json` が正しく配置されているか確認

### パターン 3: TypeScript コンパイルエラー

**症状**: Build Logs で `tsc` がエラー

**解決方法**:
ローカルで `npm run build:backend` を実行してエラーがないか確認

### パターン 4: 起動後すぐクラッシュ

**症状**: Deploy Logs に起動ログが出るが、すぐに終了

**確認ポイント**:
- `src/config/index.ts` で環境変数が見つからずエラー
- `PORT` が設定されていない（Railway は自動設定）
- データベース接続失敗

## 次のステップ

### ステップ 1: ログ確認
Railway ダッシュボードで **Deploy Logs** を開き、エラーメッセージを確認

### ステップ 2: エラー特定
上記のパターンに該当するか確認

### ステップ 3: 修正
該当するパターンに従って修正

### ステップ 4: 再デプロイ
- 環境変数変更の場合 → **Redeploy** ボタンをクリック
- コード変更の場合 → `git push` で自動デプロイ

### ステップ 5: テスト
```bash
curl https://trader-note-build-ai-production.up.railway.app/health
```

## サポートが必要な場合

以下の情報を共有してください：

1. **Deploy Logs のエラー部分**（コピペ、シークレット除外）
2. **環境変数リスト**（キー名のみ、値は非表示）
3. **Build Command と Start Command**

---

**最終コミット**: 確認中
**現在の状態**: Railway 502 エラー（原因調査中）
**次の作業**: Railway ダッシュボードでデプロイログ確認
