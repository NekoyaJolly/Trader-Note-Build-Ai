# カバレッジ・整合性レビュー（2025-12-30）

本レポートは「実装・Doc・導線」の整合性を、事実（根拠リンク）ベースで点検した結果です。

## 1. サマリー（重要度別件数）
- Critical: 0
- High: 2
- Medium: 6
- Low: 2

## 2. 変更点（implementation-matrix 更新概要）
- 正式ファイルとして docs/_coverage/implementation-matrix.md を新規作成し、誤綴りファイルは誘導メモを追記。
- 「縦割り導線（UI→API→DB/FS）」と「逆方向（DB/FS→API→UI）」で、死んだ UI / Doc と不一致の API を優先的に ⚠️/❌ 化。

## 3. 検出事項一覧（重要度順）

### High-1: 発注支援 UI の導線が切れている（/orders/preset が存在しない）
- 事実（根拠）:
	- 通知詳細画面が `/orders/preset?...` へ遷移するリンクを持つ: [src/frontend/app/notifications/[id]/page.tsx](src/frontend/app/notifications/[id]/page.tsx#L218)
	- バックエンドは `GET /api/orders/preset/:noteId` を提供している: [src/routes/orderRoutes.ts](src/routes/orderRoutes.ts#L11-L21)
- 影響:
	- ユーザーが「通知→発注支援」へ進む主要導線で 404 が確定し、MVP の価値提供（発注支援 UI）が成立しない。
- 推奨修正（最小手数）:
	- 実装修正案（どちらかに統一）
		- A案: フロントに `src/frontend/app/orders/preset/page.tsx` を追加し、クエリ（symbol/side）から `POST /api/orders/confirmation` を呼ぶ形へ寄せる
		- B案: UI リンクを noteId ベースに変更し、`GET /api/orders/preset/:noteId` へ統一

```diff
*** a/src/frontend/app/notifications/[id]/page.tsx
--- b/src/frontend/app/notifications/[id]/page.tsx
@@
-                href={`/orders/preset?symbol=${notification.tradeNote.symbol}&side=${notification.tradeNote.side}`}
+                // 提案: noteId を使う場合は API と揃える（例）
+                href={`/orders/preset?noteId=${notification.tradeNote.id}`}
```

（注）上記は方針提示のみです。実際のキー（noteId の取得元）は型/レスポンスに合わせて調整が必要です。

### High-2: /api/notifications/check の仕様が Docs と一致しない（matchResultId が無視される）
- 事実（根拠）:
	- Docs は `matchResultId` と `channel` を受け取る仕様: [docs/API.md](docs/API.md#L115-L127), [README.md](README.md#L155-L156)
	- 実装は `req.body` を参照せず、毎回 `checkForMatches()` を実行し `channel: 'in_app'` を固定: [src/controllers/notificationController.ts](src/controllers/notificationController.ts#L163-L187)
	- 実装レスポンスは `processed/notified/skipped/results` 形式: [src/controllers/notificationController.ts](src/controllers/notificationController.ts#L213-L217)
- 影響:
	- Doc 通りに叩くと「特定 matchResultId を評価する」ユースケースが成立せず、統合側が誤実装しやすい。
- 推奨修正（最小手数）:
	- Doc を実装に合わせて修正（matchResultId を廃止/未使用と明記し、レスポンス例も更新）
	- もしくは実装を Doc に寄せて `matchResultId` 指定評価に変更

```diff
*** a/docs/API.md
--- b/docs/API.md
@@
-  "matchResultId": "uuid",
-  "channel": "in_app"  // 省略可（デフォルト: in_app）
+  // 注意: 現実装は matchResultId を参照せず、サーバー側で最新のマッチングを再実行します。
+  // channel も現状は in_app 固定です。
```

### Medium-1: /api/matching/history のレスポンス形が README と不一致
- 事実（根拠）:
	- README は `{ matches: [...], total: 100 }` 例: [README.md](README.md#L139-L142)
	- 実装は `{ success, count, matches }`: [src/controllers/matchingController.ts](src/controllers/matchingController.ts#L78-L111), [src/controllers/matchingController.ts](src/controllers/matchingController.ts#L91)
- 影響:
	- UI/外部クライアントが README を参照して実装するとパースに失敗する。
- 推奨修正:
	- README と API.md でレスポンス例を現実装に合わせる、または実装を total/cursor 形式に揃える。

### Medium-2: /api/trades/import/csv のレスポンスが API.md と不一致（notes vs noteIds）
- 事実（根拠）:
	- API.md は `notes: [...]` 例: [docs/API.md](docs/API.md#L48-L52)
	- 実装は `noteIds: [...]` を返す: [src/controllers/tradeController.ts](src/controllers/tradeController.ts#L98-L101)
- 影響:
	- Docs に従うとレスポンス整形がズレる。E2E/導通確認の手順が曖昧になる。
- 推奨修正:
	- Doc を `noteIds` に合わせる（または実装を `notes` に合わせる）。

### Medium-3: /api/trades/import/upload-text が Docs に存在しない
- 事実（根拠）:
	- ルートが存在: [src/routes/tradeRoutes.ts](src/routes/tradeRoutes.ts#L17)
	- サーバ起動ログでも公開を明示: [src/app.ts](src/app.ts#L118)
- 影響:
	- UI はこの導線を使うため、外部利用者・運用者が API を特定できない。
- 推奨修正:
	- docs/API.md と README に upload-text を追記。

### Medium-4: ノート承認 API が Docs に存在しない
- 事実（根拠）:
	- ルートが存在: [src/routes/tradeRoutes.ts](src/routes/tradeRoutes.ts#L35)
- 影響:
	- UI の「承認フロー」を API として説明できず、運用手順の合意が困難。
- 推奨修正:
	- docs/API.md に `POST /api/trades/notes/:id/approve` を追記。

### Medium-5: マッチング手動実行が通知生成まで行うが、通知抑止・ログとは分離されている
- 事実（根拠）:
	- `/api/matching/check` は通知生成を実行: [src/controllers/matchingController.ts](src/controllers/matchingController.ts#L31)
	- 通知生成は `evaluateWithPersistence` ではなく `evaluate` を利用: [src/services/notificationService.ts](src/services/notificationService.ts#L55)
- 影響:
	- 「通知抑止の一貫性」がエンドポイントにより揺れる可能性がある（運用事故の温床）。
- 推奨修正:
	- 少なくとも Doc に副作用と差分（抑止/ログの有無）を明記。

### Medium-6: /api/notifications/logs のデフォルト動作が Docs と異なる（失敗ログのみ）
- 事実（根拠）:
	- 実装はフィルタ無しの場合 `getFailedLogs` を返す: [src/controllers/notificationController.ts](src/controllers/notificationController.ts#L259-L260)
- 影響:
	- 運用で「直近の全ログ」を取りたい際に取り漏れが起きる。
- 推奨修正:
	- Doc に「フィルタ無しは失敗ログのみ」と明記、またはデフォルトを全件へ変更。

### Low-1: フロント README が通知既読のメソッドを誤記（POST→PUT）
- 事実（根拠）:
	- フロント README は POST と記載: [src/frontend/README.md](src/frontend/README.md#L86-L87)
	- 実装ルートは PUT: [src/routes/notificationRoutes.ts](src/routes/notificationRoutes.ts#L27), [src/routes/notificationRoutes.ts](src/routes/notificationRoutes.ts#L33)
- 影響:
	- 開発者が誤って POST を叩く可能性がある。
- 推奨修正:
	- README を PUT に修正。

### Low-2: ドキュメント内の英語テンプレ文が混在
- 事実（根拠）:
	- README 冒頭に英語文が混在: [README.md](README.md#L3)
	- フロント README に Next.js テンプレ文章が残置: [src/frontend/README.md](src/frontend/README.md#L123-L152)
- 影響:
	- AGENTS.md の「日本語記述」ルールに抵触しやすい（ただし動作には直接影響しない）。

## 4. 代表的な矛盾（Docs ↔ 実装）
- ポート/ベースURL: Docs は 3000/3001、実装既定は 3100/3102（CORS も 3102 を許可）: [src/config/index.ts](src/config/index.ts#L18), [src/app.ts](src/app.ts#L36), [README.md](README.md#L91-L92)
- 通知check: `matchResultId` 指定型の Docs に対し、実装は「サーバ側で再マッチング」: [docs/API.md](docs/API.md#L115-L127), [src/controllers/notificationController.ts](src/controllers/notificationController.ts#L163-L187)
- 発注支援: UI が `/orders/preset` へ遷移するがページ不在、API は :noteId 前提: [src/frontend/app/notifications/[id]/page.tsx](src/frontend/app/notifications/[id]/page.tsx#L218), [src/routes/orderRoutes.ts](src/routes/orderRoutes.ts#L11-L21)

## 5. 次アクション（最小手数で埋める順番）
1. 発注支援導線を 1 つに統一（UI ページ追加 or UI リンク修正）
2. /api/notifications/check の仕様を「Doc か 実装」のどちらかに寄せて固定
3. README / docs/API.md のレスポンス形（matching/history、import/csv）を実装に同期
4. Docs に upload-text / approve エンドポイントを追記
5. ポート/CRON_ENABLED の説明を README と API.md に反映
