# カバレッジ・整合性レビュー（2025-12-30）

## 1. サマリー（重要度別件数）
- Critical: 1
- High: 2
- Medium: 2
- Low: 0

## 2. 変更点（implementation-matrix 更新概要）
- 環境変数行に DB_URL / DATABASE_URL 混在を明記し、最終確認日を追加。
- トレード取込・ノート取得行を FS/DB ハイブリッド運用である旨に更新。
- マッチ履歴行を ⚠️/⚠️ に変更（MatchResult 未永続化で履歴が空）。
- 通知 API 行を ⚠️/⚠️ に変更（一覧は Prisma 依存、既読化は FS のみ等の乖離を追記）。
- アルゴリズム行で特徴量定義を ✅ に、閾値二重管理の注意を追記。Storage/Test 行のメモと日付を追加。

## 3. 検出事項一覧（重要度順）

### Critical-1: /api/notifications/check が実質機能しない
- 事実: 通知トリガは DB 上の MatchResult を前提に [src/services/notification/notificationTriggerService.ts](src/services/notification/notificationTriggerService.ts) で評価するが、マッチ生成側は [src/services/matchingService.ts](src/services/matchingService.ts) でメモリ上の結果を返すだけで DB 保存を行わず、Controller も保存せずに In-App 通知へ流しているため、API 呼び出し時に対象レコードが存在しない。
- 影響: `/api/notifications/check` が常に 404 もしくはスキップとなり、再通知防止ロジック・NotificationLog が一切機能しない。Phase4 要件の根幹が未達。
- 推奨修正: MatchResult/MarketSnapshot を Prisma に保存する処理を追加するか、API ドキュメントを「未実装/スタブ」と明記する。パッチ案（保存を行う場合の例）:
```diff
*** a/src/controllers/matchingController.ts
--- b/src/controllers/matchingController.ts
@@
-      const matches = await this.matchingService.checkForMatches();
-
-      // マッチに対して通知を送信
-      for (const match of matches) {
-        await this.notificationService.notifyMatch(match);
-      }
+      const matches = await this.matchingService.checkForMatches();
+      // TODO: MatchResult を Prisma に永続化し、NotificationTriggerService に委譲する
+      // await matchResultRepository.saveMany(matches)
+      // await notificationTriggerService.evaluateAndNotify(...)
 
       res.json({
         success: true,
         matchesFound: matches.length,
         matches: matches.map(m => ({
```

### High-1: 通知一覧取得と既読化でストレージが分断
- 事実: 一覧取得は Prisma Notification を参照する ([src/controllers/notificationController.ts](src/controllers/notificationController.ts)) が、既読化/削除は [src/services/notificationService.ts](src/services/notificationService.ts) で data/notifications.json を書き換えるのみ。Notification を生成する経路もファイル側（MatchingController 経由）しかなく、DB には作成されない。
- 影響: GET で取得できる通知と PUT/DELETE で操作される通知が一致せず、UI から既読操作しても一覧結果に反映されない。データ整合性を欠き、UX が破綻。
- 推奨修正: Notification の単一ストアを決めて Controller/Service を統合するか、片方を廃止する。ドキュメントにも保存先を明記する。パッチ案（Doc 追記例）:
```diff
*** a/docs/API.md
--- b/docs/API.md
@@
-#### GET /api/notifications
-すべての通知を取得します（クエリパラメータ: 未読のみの場合 `unreadOnly=true`）。
+#### GET /api/notifications
+すべての通知を取得します（クエリパラメータ: 未読のみの場合 `unreadOnly=true`）。
+保存先は Prisma の Notification テーブルに統一し、既読化・削除も同テーブルに対して行うこと。
```

### High-2: フロントエンドの API パス/メソッドがバックエンドと不一致
- 事実: [src/frontend/lib/api.ts](src/frontend/lib/api.ts) は `/api/health` を呼び出すがバックエンドは `/health` のみ。通知既読化は POST `/api/notifications/:id/read` を使用するが、サーバーは PUT を期待している ([src/routes/notificationRoutes.ts](src/routes/notificationRoutes.ts))。
- 影響: フロントからのヘルスチェックが 404、通知既読化は 405/404 となり UI が動作しない。
- 推奨修正: フロントのパス/メソッドをバックエンド実装に合わせるか、バックエンド側に互換エンドポイントを追加。パッチ案（フロント修正例）:
```diff
*** a/src/frontend/lib/api.ts
--- b/src/frontend/lib/api.ts
@@
-export async function fetchHealth(): Promise<{ status: string }> {
-  const response = await fetch(`${API_BASE_URL}/api/health`, { cache: "no-store" });
+export async function fetchHealth(): Promise<{ status: string }> {
+  const response = await fetch(`${API_BASE_URL}/health`, { cache: "no-store" });
@@
-export async function markNotificationAsRead(id: string): Promise<void> {
-  const response = await fetch(`${API_BASE_URL}/api/notifications/${id}/read`, {
-    method: "POST",
-  });
+export async function markNotificationAsRead(id: string): Promise<void> {
+  const response = await fetch(`${API_BASE_URL}/api/notifications/${id}/read`, {
+    method: "PUT",
+  });
 }
@@
-export async function markAllNotificationsAsRead(): Promise<void> {
-  const response = await fetch(`${API_BASE_URL}/api/notifications/read-all`, {
-    method: "POST",
-  });
+export async function markAllNotificationsAsRead(): Promise<void> {
+  const response = await fetch(`${API_BASE_URL}/api/notifications/read-all`, {
+    method: "PUT",
+  });
 }
```

### Medium-1: 永続化方式のドキュメントと実装が矛盾
- 事実: ARCHITECTURE は FS 保存（data/notes, data/notifications.json）を明記している一方、README は PostgreSQL/Prisma を前提としている。実装は Trade/NotificationLog/MatchResult を Prisma、TradeNote/Notification は FS に保存するハイブリッド ([src/services/tradeNoteService.ts](src/services/tradeNoteService.ts), [src/services/notificationService.ts](src/services/notificationService.ts), [prisma/schema.prisma](prisma/schema.prisma))。
- 影響: セットアップ・運用設計が混乱し、どのデータが DB にあるのか把握できない。バックアップや移行計画が立てられない。
- 推奨修正: 現状の保存先を README/ARCHITECTURE に明記し、将来の移行方針を分離。パッチ案（ARCHITECTURE 追記例）:
```diff
*** a/docs/ARCHITECTURE.md
--- b/docs/ARCHITECTURE.md
@@
-**Storage Layer**
-- File System (JSON)
-- data/notes/*.json
-- data/notifications.json
+**Storage Layer (現状)**
+- Trade / MatchResult / NotificationLog: PostgreSQL (Prisma)
+- TradeNote / Notification (一覧・既読状態): File System (data/notes/*.json, data/notifications.json)
+現状ハイブリッドであることを明記し、将来は DB へ統合予定。
```

### Medium-2: 環境変数と閾値名が文書と実装で揺れている
- 事実: .env.example は DATABASE_URL を採用するが README は DB_URL を記載。config は両方を許容 ([src/config/index.ts](src/config/index.ts))。マッチ判定は MATCH_THRESHOLD、通知判定は NOTIFY_THRESHOLD（デフォルト 0.75）を参照するが後者は README/API に未記載。
- 影響: 環境変数設定ミスや閾値設定漏れが起きやすい。デプロイ時に意図しない値で動作するリスク。
- 推奨修正: README に DATABASE_URL/NOTIFY_THRESHOLD を追記し、不要な DB_URL 記載を削除。パッチ案（README 抜粋修正例）:
```diff
*** a/README.md
--- b/README.md
@@
-# - DB_URL: PostgreSQL 接続文字列（例: postgresql://postgres:postgres@localhost:5432/tradeassist）
+# - DATABASE_URL: PostgreSQL 接続文字列（例: postgresql://postgres:postgres@localhost:5432/tradeassist）
@@
-- MATCH_THRESHOLD: Match score threshold (0-1, default: 0.75)
+- MATCH_THRESHOLD: Match score threshold (0-1, default: 0.75)
+- NOTIFY_THRESHOLD: Notification trigger threshold (0-1, default: 0.75)
```

## 4. 代表的な矛盾
- 通知: 一覧取得は Prisma、既読/削除は FS。生成経路も FS のみで API 仕様と不整合。
- マッチング: MatchResult を DB に保存せず、通知トリガ API が実データを参照できない。
- 永続化ドキュメント: README は DB 前提、ARCHITECTURE は FS 前提で現在のハイブリッド実装を説明できていない。
- フロント API 呼び出し: /api/health と POST 既読化などバックエンドと乖離。

## 5. 次アクション
1. MatchResult/Notification の保存戦略を決定し、NotificationController/Service を単一ストアに統合（その後 Doc 更新）。
2. フロント API パス・メソッドをバックエンドに合わせて修正し、簡易 E2E を追加。
3. README/ARCHITECTURE に現状の保存先と環境変数名（DATABASE_URL, NOTIFY_THRESHOLD）を追記。
4. `/api/notifications/check` を実際に動作させるための永続化とテストケース（閾値・クールダウン）を追加。
