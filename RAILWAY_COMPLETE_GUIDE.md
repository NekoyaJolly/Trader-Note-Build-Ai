# Railway 502 エラー完全診断ガイド

**最終更新**: 2026-01-14 13:36 UTC  
**ステータス**: 🚨 **アプリケーションが起動していない**

---

## 問題の特徴

```
GET /api/notifications/unread-count → 502
GET / → 502

PostgreSQL ログ:
"could not receive data from client: Connection reset by peer"

Container Status: Stopping
```

### 原因の可能性（優先度順）

| 優先度 | 原因 | 確認方法 |
|--------|------|---------|
| **🔴 1番** | Railway の環境変数が不足している | Railway ダッシュボール → Variables |
| **🟠 2番** | NODE_ENV が production に設定されていない | Railway Variables を確認 |
| **🟡 3番** | ビルド時にエラーが起きている | Deploy Logs → Build Logs を確認 |
| **🟢 4番** | メモリ不足でプロセスが殺されている | Railway メトリクスを確認 |

---

## 🔴 優先度1: Railway 環境変数確認（最優先）

### 手順

1. **Railway ダッシュボールを開く**
   - https://railway.app にアクセス
   - プロジェクトを選択

2. **Node.js サービスを選択**

3. **Settings → Variables をクリック**

4. **以下の環境変数が全て設定されているか確認**

```bash
# 🔴 絶対必須（これがないと起動しない）
DATABASE_URL=postgresql://postgres:YJtRQLNgBFxGopFxRHMCZURURdxIwWrN@switchyard.proxy.rlwy.net:32154/railway?sslmode=require
NODE_ENV=production

# 🟠 重要（これがないと機能しない）
JWT_SECRET=4OqCYL8AHR/9jGFrV/YPNyNw6R4xFdQZUYod5ZigbY4=
JWT_REFRESH_SECRET=CzxjTBRlDUgQf+DXhnF2/FyUGSUZhRR+e69ikgH5CH4=
AI_API_KEY=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
AI_MODEL=gpt-5-mini
MARKET_API_URL=https://api.twelvedata.com
MARKET_API_KEY=29bcf8b5b4a347ca9b7024796af7cd3e
VAPID_PUBLIC_KEY=BLu1-CLYTs3lQusgFRphvfDdpikHindH17HAFgjXH-xHgS14HonP9XOTrC1AmCb1gr-SChxnW4XqUq6saHrsqI4
VAPID_PRIVATE_KEY=EFZs_-q5Df_RgOm6lCqOpPe7jBnJZC6ch0z_wx4r_MI
VAPID_SUBJECT=mailto:admin@tradeassist.local
CTRADER_CLIENT_ID=20178_vRM8hQu39iKOkBe8MMcYhS1KZQPRLbf3yRYU9BDY3gSuU9m92C
CTRADER_CLIENT_SECRET=5sd8gT5lt125qh7JZbxd6ccdSVTf91bzvkkVRiu7orbOiZAK5F
```

### ⚠️ よくあるミス

#### ❌ DATABASE_URL が参照形式のままになっている

```bash
# ❌ これはダメ（参照変数）
DATABASE_URL=${{Postgres.DATABASE_URL}}

# ✅ これが正しい（実値）
DATABASE_URL=postgresql://postgres:YJtRQLNgBFxGopFxRHMCZURURdxIwWrN@switchyard.proxy.rlwy.net:32154/railway?sslmode=require
```

**修正方法:**
1. PostgreSQL サービスの Variables タブを開く
2. DATABASE_URL の値をコピー
3. Node.js サービスの Variables で DATABASE_URL を削除
4. 新しく DATABASE_URL を作成して、コピーした値を貼り付け（**参照ではなく実値**）

#### ❌ NODE_ENV が development のままになっている

**修正方法:**
```
NODE_ENV = production
```

#### ❌ 必須変数が1つでも欠けている

**修正方法:**
- `.env` ファイルから全ての環境変数をコピー
- Railroad Variables に追加

---

## 🟠 優先度2: ビルドログ確認

Railway ダッシュボールで **Deploy Logs** を確認

### Build Logs に以下のエラーが出ていないか

```bash
# ❌ Prisma generate エラー
error: cannot find module '@prisma/client'

# ❌ TypeScript エラー
src/config/index.ts:123:45 - error TS1234: Property 'xxx' not found

# ❌ npm install エラー
npm ERR! code ERESOLVE

# ❌ メモリ不足
FATAL ERROR: CALL_AND_RETRY_LAST
```

**もしエラーが出ていた場合:**
1. ローカルで `npm run build:backend` を実行
2. エラーを修正
3. `git push` で再デプロイ

---

## 🟡 優先度3: Deploy Logs 詳細確認

Railway ダッシュボール → Deployments → 最新 → View Logs

### 以下の行が出ているか確認

```
✅ 出ているべき行（起動成功の場合）:
TradeAssist Starting...
App インスタンスを作成中...
App インスタンス作成完了、サーバーを起動中...
TradeAssist Server Starting
TradeAssist Server STARTED

❌ 出ている場合はエラー:
DATABASE_URL が見つかりません
DATABASE_URL が参照変数形式のまま
環境変数が全く設定されていません
```

---

## 🟢 優先度4: Railway メトリクス確認

1. Railway ダッシュボール → プロジェクト → Metrics タブ
2. 以下を確認:
   - **Memory**: メモリ使用率が 100% になっていないか
   - **CPU**: CPU 使用率が異常に高くないか
   - **Restarts**: コンテナが繰り返し再起動していないか

---

## 次のステップ

### ステップ 1: 環境変数チェック（5分）

```bash
# ローカルで全変数が設定されているか確認
npx tsx scripts/check-railway-env.ts
```

出力が全て ✅ なら、Railway にも同じ変数を設定

### ステップ 2: Railway 環境変数を設定（10分）

Railway ダッシュボールで:
1. 全ての環境変数が設定されているか確認
2. 見つからないものがあれば追加
3. **Redeploy ボタンをクリック**

### ステップ 3: デプロイログを確認（5分）

```bash
# 或いは Railway CLI で
railway logs --service=<node-service-id>
```

### ステップ 4: テスト（2分）

```bash
curl https://trader-note-build-ai-production.up.railway.app/health
```

200 OK が返ってくれば成功

---

## チェックリスト

### Railway ダッシュボール

- [ ] Node.js サービスが存在する
- [ ] Settings → Build Command: `npm install && npm run build:backend`
- [ ] Settings → Start Command: `node dist/index.js`
- [ ] Variables タブで DATABASE_URL が設定されている（参照ではなく実値）
- [ ] Variables タブで NODE_ENV が `production` に設定されている
- [ ] 全ての必須変数が設定されている
- [ ] Redeploy ボタンをクリック済み

### ローカル環境

- [ ] `npm run build:backend` が成功している（0 エラー）
- [ ] `npm run build:backend` でビルド出力に エラーがない
- [ ] `.env` ファイルに全ての必須変数が設定されている
- [ ] `npx tsx scripts/check-railway-env.ts` で全て ✅ が出ている

### デプロイ後

- [ ] Railway Deploy Logs に `TradeAssist Server STARTED` が出ている
- [ ] `curl /health` で 200 OK が返ってくる
- [ ] ブラウザで https://trader-note-build-ai.vercel.app にアクセスできる
- [ ] cTrader ログイン画面で認証ボタンが反応する

---

## よくあるエラーと対応

### エラー: "could not receive data from client: Connection reset by peer"

**原因**: Node.js アプリケーションが起動していない/すぐにクラッシュしている

**対応**:
1. Deploy Logs で起動メッセージを確認
2. 環境変数が不足していないか確認
3. ビルドエラーがないか確認

### エラー: "502 Bad Gateway"

**原因**: アプリケーションが起動しているが、リクエストに応答していない

**対応**:
1. Railway メトリクスを確認（メモリ/CPU）
2. Prisma が PostgreSQL に接続できているか確認
3. アプリケーションログで詳細エラーを探す

### エラー: "Cannot find module '@prisma/client'"

**原因**: Prisma Client が生成されていない

**対応**:
1. Build Command を確認: `npm install && npx prisma generate && tsc`
2. ローカルで `npm run build:backend` を実行
3. `git push` で再デプロイ

---

## 質問されたことへの回答例

**Q: "Railway ダッシュボールで何を確認すればいい？"**

A:
1. プロジェクト → Node.js サービス → Settings
2. Build Command と Start Command を確認
3. Variables → DATABASE_URL、NODE_ENV、その他必須変数を確認
4. Deployments → 最新デプロイ → View Logs でエラーを確認

---

## サポート

Deploy Logs のエラーメッセージをコピーして共有していただければ、対応可能です。

以下の形式で共有してください:

```
【発生していたエラー】
（logs をコピペ）

【現在の環境変数設定】
DATABASE_URL: ✅/❌
NODE_ENV: ✅/❌
その他: ✅/❌

【ローカルビルド状態】
npm run build:backend: ✅/❌
```
