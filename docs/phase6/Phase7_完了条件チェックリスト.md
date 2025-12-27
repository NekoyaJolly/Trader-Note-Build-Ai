# Phase 7 完了条件チェックリスト & 報告書テンプレート

**プロジェクト**: Trader-Note-Build-Ai  
**フェーズ**: Phase 7（本番インフラ構築）  
**実行期限**: 2025-12-27  

---

## Phase 7 完了条件（MUST HAVE）

### Section A：Railway インフラ構築完了

#### A-1：PostgreSQL サービス

```
[ ] PostgreSQL サービスが Railway Dashboard に表示されている
[ ] ステータスが「Running」（緑）
[ ] Connection String が取得可能
[ ] ポート 5432 で応答している
```

#### A-2：API サービス

```
[ ] API サービスが Railway Dashboard に表示されている
[ ] ステータスが「Running」（緑）
[ ] GitHub リポジトリ NekoyaJolly/Trader-Note-Build-Ai が連携されている
[ ] デプロイログに以下が含まれている:
    - ビルド成功メッセージ
    - Prisma Migration 成功メッセージ
    - "Server running on port" メッセージ
```

#### A-3：Railway 環境変数設定

```
[ ] DB_URL が PostgreSQL 接続文字列で設定されている
[ ] NODE_ENV=production が設定されている
[ ] CRON_ENABLED=false が設定されている
[ ] API Service が環境変数を反映するため Redeploy されている
```

#### A-4：Railway デプロイ状態

```
[ ] API Service デプロイが最新で「Ready」または「Running」
[ ] PostgreSQL Service が「Running」
[ ] ネットワーク接続に異常がない
```

---

### Section B：Vercel インフラ構築完了

#### B-1：GitHub 連携

```
[ ] Vercel で GitHub リポジトリが連携されている
[ ] GitHub からの Deploy Trigger が有効
[ ] Pull Request Preview が設定されている
```

#### B-2：Vercel Production ビルド

```
[ ] Production Build のステータスが「Ready」（緑）
[ ] Build Log に以下が含まれている:
    - ビルド成功メッセージ
    - "Build Completed Successfully"
    - すべての Page Route が正常コンパイル
```

#### B-3：Vercel 環境変数設定

```
[ ] NEXT_PUBLIC_API_BASE_URL が設定されている
[ ] 値は Railway API の Public URL である
    例: https://api-production-xxx.railway.app
[ ] Environment Variables が Production 環境に反映されている
```

#### B-4：Vercel Production Domain

```
[ ] Production Domain が確認できる
    例: https://[project-name].vercel.app
[ ] Domain にアクセスできる（HTTPS 有効）
```

---

### Section C：API ↔ DB 疎通確認

#### C-1：API ヘルスチェック

```bash
curl -X GET https://[RAILWAY_API_URL]/health
```

成功条件:
```
[ ] HTTP ステータスコード: 200 OK
[ ] レスポンス JSON に以下が含まれている:
    - "status": "ok"
    - "timestamp": ISO 8601 形式
    - "schedulerRunning": false
```

#### C-2：API 通知エンドポイント

```bash
curl -X GET https://[RAILWAY_API_URL]/api/notifications
```

成功条件:
```
[ ] HTTP ステータスコード: 200 OK
[ ] レスポンス: [] （空配列）
[ ] Content-Type: application/json
```

#### C-3：データベース接続ログ

Railway API のログで確認:
```
[ ] "Prisma connecting to database..." メッセージがある
[ ] "✓ Database connected" または同等メッセージがある
[ ] Migration 関連のエラーがない
[ ] PostgreSQL タイムアウトエラーがない
```

---

### Section D：UI ↔ API 疎通確認

#### D-1：UI ページ表示

Browser で以下を確認:
```
https://[VERCEL_UI_URL]
```

成功条件:
```
[ ] ページが正常に読み込まれる
[ ] ステータスコード: 200
[ ] HTML が正常にレンダリングされている
[ ] JavaScript エラーがコンソールに出力されていない
```

#### D-2：API リクエスト送信

DevTools → Network タブで確認:
```
[ ] UI から API へのリクエストが送信されている
[ ] リクエスト URL: https://[RAILWAY_API_URL]/api/notifications
[ ] ステータスコード: 200 系（200, 201, 204 など）
[ ] CORS エラーがない
```

#### D-3：API レスポンス受信

Network タブで確認:
```
[ ] Response Status: 200 OK
[ ] Response Body: [] （空配列）
[ ] Response Headers に Content-Type: application/json
[ ] レスポンス時間: < 5000ms
```

#### D-4：UI の空状態表示

Browser で視覚的に確認:
```
[ ] /notifications ページが表示される
[ ] 「通知がありません」などの空状態メッセージが表示される
[ ] レイアウト / スタイルが正常に表示されている
```

---

### Section E：本番環境の完全性確認

#### E-1：データベーススキーマ

Prisma Migration が適用されていることを確認:
```
[ ] Trade テーブルが存在
[ ] TradeNote テーブルが存在
[ ] Notification テーブルが存在
[ ] NotificationLog テーブルが存在
[ ] MatchResult テーブルが存在
[ ] MarketSnapshot テーブルが存在
[ ] すべてのインデックスが作成されている
```

#### E-2：セキュリティチェック

```
[ ] API キーが Git に含まれていない
[ ] .env ファイルが .gitignore に含まれている
[ ] 本番環境の認証情報は Railway / Vercel Web UI で管理されている
[ ] HTTPS が有効（Railway API + Vercel UI 両方）
```

#### E-3：本番運用ルール理解

```
[ ] Cron は無効化されている（CRON_ENABLED=false）
[ ] データベースは append-only 運用予定であることを理解
[ ] DB reset / seed コマンドは実行禁止であることを理解
[ ] 本フェーズでデータ投入は行わない予定であることを理解
```

---

## Phase 7 完了チェックシート

### チェック実施者情報

```
実行者名: ________________
実行日時: ________________
所属 / チーム: ________________
```

### セクション別チェック結果

#### ✅ Section A：Railway インフラ構築

| 項目 | 状態 | 備考 |
|------|------|------|
| PostgreSQL Running | ⬜ | |
| API Running | ⬜ | |
| DB_URL 設定 | ⬜ | |
| NODE_ENV=production | ⬜ | |
| CRON_ENABLED=false | ⬜ | |

**セクション A 完了**: [ ] はい / [ ] いいえ

#### ✅ Section B：Vercel インフラ構築

| 項目 | 状態 | 備考 |
|------|------|------|
| GitHub 連携 | ⬜ | |
| Build Ready | ⬜ | |
| NEXT_PUBLIC_API_BASE_URL | ⬜ | |
| Production Domain | ⬜ | |

**セクション B 完了**: [ ] はい / [ ] いいえ

#### ✅ Section C：API ↔ DB 疎通

| 項目 | 状態 | 備考 |
|------|------|------|
| /health エンドポイント | ⬜ | |
| /notifications エンドポイント | ⬜ | |
| DB 接続ログ | ⬜ | |

**セクション C 完了**: [ ] はい / [ ] いいえ

#### ✅ Section D：UI ↔ API 疎通

| 項目 | 状態 | 備考 |
|------|------|------|
| UI ページ表示 | ⬜ | |
| API リクエスト送信 | ⬜ | |
| API レスポンス受信 | ⬜ | |
| 空状態メッセージ | ⬜ | |

**セクション D 完了**: [ ] はい / [ ] いいえ

#### ✅ Section E：完全性 / セキュリティ

| 項目 | 状態 | 備考 |
|------|------|------|
| DB スキーマ完成 | ⬜ | |
| セキュリティ確認 | ⬜ | |
| 本番ルール理解 | ⬜ | |

**セクション E 完了**: [ ] はい / [ ] いいえ

---

## Phase 7 完了報告フォーマット

すべてのチェックリストが ✅ 完了した場合、以下のフォーマットで報告してください：

```
═══════════════════════════════════════════════════
Phase 7 完了報告
═══════════════════════════════════════════════════

✅ Railway API: 起動成功
   ├─ Service Status: Running
   ├─ Public URL: https://[api-production-xxx].railway.app
   ├─ /health レスポンス: 200 OK
   └─ DB 接続確認: 成功

✅ Railway DB: 接続確認済み
   ├─ PostgreSQL Status: Running
   ├─ Migration 実行: 成功
   ├─ テーブル数: 6個
   └─ エラーログ: なし

✅ Vercel Production: ビルド成功
   ├─ Build Status: Ready
   ├─ Production URL: https://[project-name].vercel.app
   ├─ Environment Variables: 設定済み
   └─ Build Time: X分 Y秒

✅ UI → API 疎通: OK
   ├─ Network リクエスト: 送信確認
   ├─ API レスポンス: 200 OK
   ├─ CORS: エラーなし
   └─ 空状態表示: 確認済み

✅ API → DB 疎通: OK
   ├─ Connection String: 有効
   ├─ Prisma Migration: 成功
   ├─ テーブル検証: 成功
   └─ ログエラー: なし

═══════════════════════════════════════════════════
Phase 7 本番インフラ構築 ✅ COMPLETE
═══════════════════════════════════════════════════

次ステップ: Phase 8（本番向け API デプロイ & 検証）の実行準備完了

実行者: ________________
実行日時: ________________
```

---

## トラブル発生時の対応

### よくある問題と解決方法

#### 問題 1：API が起動しない

**原因**: 
- DB_URL が正しくない
- PostgreSQL サービスが Running していない
- Migration に失敗

**対応**:
```bash
# 1. Railway Dashboard で PostgreSQL を確認
# 2. DB_URL を再取得して設定
# 3. API Service を Redeploy
```

#### 問題 2：CORS エラーが表示される

**原因**:
- NEXT_PUBLIC_API_BASE_URL が正しくない
- API のホスト名が異なる

**対応**:
```bash
# 1. Railway API の Public URL を再確認
# 2. Vercel の環境変数を修正
# 3. Vercel で Redeploy を実行
```

#### 問題 3：ビルドエラー

**原因**:
- Node.js バージョン不一致
- 依存関係インストール失敗

**対応**:
```bash
# ローカルでビルド確認
npm install
npm run build

# エラーを修正して Git Push
```

---

## 次フェーズへの進行条件

✅ **Phase 7 完了条件**:

- [ ] Section A - D のすべてのチェック項目が完了
- [ ] セキュリティチェック完了
- [ ] 本番運用ルール理解完了
- [ ] 完了報告フォーマットで報告済み

✅ **Phase 8 実行準備**:

- [ ] Phase 7 完了報告が確認された
- [ ] 本番 API / DB が稼働している
- [ ] UI → API 疎通が確認されている
- [ ] 運用チームが待機状態

---

## 参考資料

- [Phase 7 本番インフラ構築ガイド](Phase7_本番インフラ構築ガイド.md)
- [Phase 7 実行手順書](Phase7_実行手順書.md)
- [Phase 7 環境変数テンプレート](Phase7_環境変数テンプレート.md)
- [Phase 7 本番環境動作確認ガイド](Phase7_本番環境動作確認ガイド.md)
- [AGENTS.md](../../AGENTS.md) - 公式指示書

---

