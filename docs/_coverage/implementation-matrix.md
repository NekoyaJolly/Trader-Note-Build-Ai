# implementation-matrix.md（実装・テスト・ドキュメント整合マトリクス）

本ファイルは「実装漏れ」「テスト漏れ」「ドキュメント更新漏れ」を早期に検出するためのカバレッジ表です。
特に **縦割り（UI→API→DB/FS）** と **逆方向（DB/FS→API→UI）** の導通を、事実（根拠リンク）ベースで記録します。

- ✅: 完了（実装/Doc が整合し、導線として成立）
- ⚠️: 要確認（動くが Doc/導線/戻り値/副作用が不一致、または一部が未配線）
- ❌: 未対応/死んだ導線（UI/Route が存在しない、404 が確定、または重要な要件を満たさない）
- 💤: 対象外（現フェーズでは未実施でも問題なし）

最終確認日: 2025-12-31

---

## 0. 横断（環境変数/ポート/運用）

| 区分 | Requirement | 判定 | 根拠（実装） | 根拠（Docs） | メモ |
|---|---|:--:|---|---|---|
| Port | バックエンド既定ポートと Docs が一致 | ✅ | [src/config/index.ts](src/config/index.ts#L18) | [README.md](README.md#L91-L92), [docs/API.md](docs/API.md#L5) | Phase0 で更新。Docs は 3100 前提に修正済み。 |
| Port | フロントエンド既定ポートと Docs が一致 | ✅ | [src/app.ts](src/app.ts#L36) | [README.md](README.md#L91-L92), [src/frontend/README.md](src/frontend/README.md#L57) | Phase0 で更新。 |
| Scheduler | スケジューラーの起動条件が Docs と一致 | ✅ | [src/app.ts](src/app.ts#L132-L140) | [docs/API.md](docs/API.md) | Phase0 で API.md に CRON_ENABLED 説明追加。 |

---

## 1. トレード取込・ノート（UI→API→FS/DB）

| Requirement | 判定 | UI | API | 永続化 | Doc 整合 | 根拠（実装） | 根拠（Docs） | メモ |
|---|:--:|:--:|:--:|:--:|:--:|---|---|---|
| CSV取込（ファイル）: POST /api/trades/import/csv で取込→ノート生成 | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/controllers/tradeController.ts](src/controllers/tradeController.ts#L28-L105), [src/controllers/tradeController.ts](src/controllers/tradeController.ts#L98-L101) | [docs/API.md](docs/API.md#L33-L52), [README.md](README.md#L110-L121) | Phase0 で Docs を noteIds に修正済み。 |
| CSV取込（テキスト）: POST /api/trades/import/upload-text | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/routes/tradeRoutes.ts](src/routes/tradeRoutes.ts#L17), [src/controllers/tradeController.ts](src/controllers/tradeController.ts#L117-L176), [src/app.ts](src/app.ts#L118) | [docs/API.md](docs/API.md) | Phase0 で API.md に追記済み。 |
| ノート一覧: GET /api/trades/notes | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/controllers/tradeController.ts](src/controllers/tradeController.ts#L195-L199) | [docs/API.md](docs/API.md#L55-L56) | FS のノートを返す。 |
| ノート詳細: GET /api/trades/notes/:id | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/controllers/tradeController.ts](src/controllers/tradeController.ts#L201-L212) | [docs/API.md](docs/API.md#L58-L59) | 404 の仕様は実装済み。 |
| ノート承認: POST /api/trades/notes/:id/approve | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/routes/tradeRoutes.ts](src/routes/tradeRoutes.ts#L35), [src/controllers/tradeController.ts](src/controllers/tradeController.ts#L214-L247) | [docs/API.md](docs/API.md) | Phase0 で API.md に追記済み。 |

---

## 2. マッチング（UI/手動→API→DB/FS）

| Requirement | 判定 | UI | API | 永続化 | Doc 整合 | 根拠（実装） | 根拠（Docs） | メモ |
|---|:--:|:--:|:--:|:--:|:--:|---|---|---|
| 手動マッチ: POST /api/matching/check | ✅ | 💤 | ✅ | ✅(DB) | ✅ | [src/controllers/matchingController.ts](src/controllers/matchingController.ts#L25-L56), [src/controllers/matchingController.ts](src/controllers/matchingController.ts#L31) | [docs/API.md](docs/API.md#L65-L66) | 実装は通知生成も行う。 |
| 履歴: GET /api/matching/history | ✅ | ✅ | ✅ | ✅(DB想定) | ✅ | [src/controllers/matchingController.ts](src/controllers/matchingController.ts#L78-L111), [src/controllers/matchingController.ts](src/controllers/matchingController.ts#L91) | [docs/API.md](docs/API.md), [README.md](README.md#L154-L177) | Phase0 で Docs を success/count/matches 形式に修正済み。 |

---

## 3. 通知（UI→API→FS + ログDB）

| Requirement | 判定 | UI | API | 永続化 | Doc 整合 | 根拠（実装） | 根拠（Docs） | メモ |
|---|:--:|:--:|:--:|:--:|:--:|---|---|---|
| 一覧: GET /api/notifications（unreadOnly） | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/controllers/notificationController.ts](src/controllers/notificationController.ts#L29-L55), [src/routes/notificationRoutes.ts](src/routes/notificationRoutes.ts#L14) | [docs/API.md](docs/API.md#L74-L76) | 通知本体は FS（既読も FS）。 |
| 既読: PUT /api/notifications/:id/read | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/routes/notificationRoutes.ts](src/routes/notificationRoutes.ts#L27), [src/frontend/lib/api.ts](src/frontend/lib/api.ts#L73) | [src/frontend/README.md](src/frontend/README.md) | Phase0 でフロントREADMEをPUTに修正済み。 |
| 全既読: PUT /api/notifications/read-all | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/routes/notificationRoutes.ts](src/routes/notificationRoutes.ts#L33), [src/frontend/lib/api.ts](src/frontend/lib/api.ts#L89) | [src/frontend/README.md](src/frontend/README.md) | Phase0 で修正済み。 |
| トリガ: POST /api/notifications/check（再通知防止・ログ） | ✅ | 💤 | ✅ | ✅(DB+FS) | ✅ | [src/controllers/notificationController.ts](src/controllers/notificationController.ts#L163-L218), [src/controllers/notificationController.ts](src/controllers/notificationController.ts#L181-L187), [src/controllers/notificationController.ts](src/controllers/notificationController.ts#L213-L217) | [docs/API.md](docs/API.md), [README.md](README.md#L183-L199) | Phase0 で Docs を実装に寄せて修正済み（matchResultId未使用明記）。 |
| ログ: GET /api/notifications/logs | ✅ | 💤 | ✅ | ✅(DB) | ✅ | [src/controllers/notificationController.ts](src/controllers/notificationController.ts#L233-L267), [src/controllers/notificationController.ts](src/controllers/notificationController.ts#L259-L260) | [docs/API.md](docs/API.md#L171-L201) | Phase0 でデフォルト動作（失敗ログのみ）を Docs に明記済み。 |

---

## 4. 発注支援（UI→API）

| Requirement | 判定 | UI | API | 永続化 | Doc 整合 | 根拠（実装） | 根拠（Docs） | メモ |
|---|:--:|:--:|:--:|:--:|:--:|---|---|---|
| 発注画面（参照のみ）: /orders/preset | ✅ | ✅ | ✅ | 💤 | ✅ | [src/frontend/app/orders/preset/page.tsx](src/frontend/app/orders/preset/page.tsx), [src/routes/orderRoutes.ts](src/routes/orderRoutes.ts#L11-L21) | [docs/API.md](docs/API.md) | Phase0 で UI ページ追加、リンクを noteId ベースに統一済み。 |

---

## 5. 死んだ/未配線候補（検出ログ）

| 対象 | 判定 | 根拠 | メモ |
|---|:--:|---|---|
| フロントAPI: GET /api/daily-status | ❌ | [src/frontend/lib/api.ts](src/frontend/lib/api.ts#L206-L209), [src/app.ts](src/app.ts#L88-L92) | フロント側に API クライアントがあるが、バックエンドにルート登録が無い。現在 UI からの利用箇所は未検出（要整理）。 |

---

## 6. Phase 1 — トレード取込定義化パイプライン（2025-01-02 追加）

最終確認日: 2025-01-02

### 6.1 インジケーター定義拡張

| Requirement | 判定 | 実装 | テスト | Doc 整合 | 根拠（実装） | メモ |
|---|:--:|:--:|:--:|:--:|---|---|
| 20種類のインジケーター定義 | ✅ | ✅ | ✅ | ✅ | [src/models/indicatorConfig.ts](src/models/indicatorConfig.ts) | RSI, SMA, EMA, MACD, BB, ATR, Stochastic, OBV, VWAP（既存9種）+ Williams%R, CCI, Aroon, ROC, MFI, CMF, DEMA, TEMA, KC, PSAR, Ichimoku（新規11種）|
| 同一インジケーター複数期間対応 | ✅ | ✅ | ✅ | ✅ | [src/models/indicatorConfig.ts#IndicatorConfig](src/models/indicatorConfig.ts) | IndicatorConfig.configId でユニーク識別 |
| インジケーター計算サービス拡張 | ✅ | ✅ | ✅ | 💤 | [src/services/indicators/indicatorService.ts](src/services/indicators/indicatorService.ts) | indicatorts ライブラリをラップ |

### 6.2 トレード正規化

| Requirement | 判定 | 実装 | テスト | Doc 整合 | 根拠（実装） | メモ |
|---|:--:|:--:|:--:|:--:|---|---|
| タイムスタンプ UTC 正規化 | ✅ | ✅ | ✅ | 💤 | [src/services/tradeNormalizationService.ts#normalizeTimestamp](src/services/tradeNormalizationService.ts) | ISO8601, Unix秒/ミリ秒, 日本語形式（JST→UTC）対応 |
| シンボル正規化（BTCUSD→BTC/USD） | ✅ | ✅ | ✅ | 💤 | [src/services/tradeNormalizationService.ts#normalizeSymbol](src/services/tradeNormalizationService.ts) | 主要ペアのマッピングテーブル + パターン推測 |
| Side 正規化（buy/sell/long/short/日本語） | ✅ | ✅ | ✅ | 💤 | [src/services/tradeNormalizationService.ts#normalizeSide](src/services/tradeNormalizationService.ts) | 英語/日本語/数値対応 |
| ユーザーフレンドリーエラーメッセージ | ✅ | ✅ | ✅ | 💤 | [src/services/tradeNormalizationService.ts#normalizeTradeData](src/services/tradeNormalizationService.ts) | 行番号付きで修正方法を明示 |

### 6.3 TradeDefinition パイプライン

| Requirement | 判定 | 実装 | テスト | Doc 整合 | 根拠（実装） | メモ |
|---|:--:|:--:|:--:|:--:|---|---|
| TradeDefinition 型定義 | ✅ | ✅ | 💤 | 💤 | [src/models/tradeDefinition.ts](src/models/tradeDefinition.ts) | Trade + MarketSnapshot + IndicatorSnapshot + DerivedContext |
| 市場データ取得→インジケーター計算 | ✅ | ✅ | ✅ | 💤 | [src/services/tradeDefinitionService.ts](src/services/tradeDefinitionService.ts) | MarketDataService 連携、失敗時モックデータフォールバック |
| 派生コンテキスト導出（trend, volatility, momentum） | ✅ | ✅ | ✅ | 💤 | [src/services/tradeDefinitionService.ts#deriveContext](src/services/tradeDefinitionService.ts) | 複数インジケーターから総合判定 |
| 特徴量ベクトル生成（20次元） | ✅ | ✅ | ✅ | 💤 | [src/services/tradeDefinitionService.ts#generateFeatureVector](src/services/tradeDefinitionService.ts) | pgvector 対応用正規化ベクトル |
| バッチ処理対応 | ✅ | ✅ | ✅ | 💤 | [src/services/tradeDefinitionService.ts#generateDefinitionsBatch](src/services/tradeDefinitionService.ts) | 複数トレード一括変換 |

### 6.4 テストカバレッジ

| テストファイル | テスト数 | 根拠 |
|---|:--:|---|
| indicatorConfig.test.ts | 14 | [src/backend/tests/indicatorConfig.test.ts](src/backend/tests/indicatorConfig.test.ts) |
| tradeNormalizationService.test.ts | 27 | [src/backend/tests/tradeNormalizationService.test.ts](src/backend/tests/tradeNormalizationService.test.ts) |
| tradeDefinitionService.test.ts | 8 | [src/backend/tests/tradeDefinitionService.test.ts](src/backend/tests/tradeDefinitionService.test.ts) |
| indicatorService.test.ts（既存拡張） | 16 | [src/backend/tests/indicatorService.test.ts](src/backend/tests/indicatorService.test.ts) |

---

## 7. Phase 2 — ノート承認フロー（2025-12-31 追加）

最終確認日: 2025-12-31

### 7.1 データモデル拡張

| Requirement | 判定 | 実装 | テスト | Doc 整合 | 根拠（実装） | メモ |
|---|:--:|:--:|:--:|:--:|---|---|
| NoteStatus 型定義（draft/approved/rejected） | ✅ | ✅ | ✅ | ✅ | [src/models/types.ts#NoteStatus](src/models/types.ts) | 3ステータス対応、状態遷移可能 |
| TradeNote 拡張（rejectedAt, lastEditedAt, userNotes, tags） | ✅ | ✅ | ✅ | ✅ | [src/models/types.ts#TradeNote](src/models/types.ts) | 編集履歴・ユーザー追記対応 |

### 7.2 API エンドポイント

| Requirement | 判定 | UI | API | 永続化 | Doc 整合 | 根拠（実装） | 根拠（Docs） | メモ |
|---|:--:|:--:|:--:|:--:|:--:|---|---|---|
| ノート一覧（status フィルタ）: GET /api/trades/notes?status= | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/controllers/tradeController.ts#getAllNotes](src/controllers/tradeController.ts) | [docs/API.md](docs/API.md) | draft/approved/rejected でフィルタ可能 |
| ステータス集計: GET /api/trades/notes/status-counts | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/controllers/tradeController.ts#getStatusCounts](src/controllers/tradeController.ts), [src/routes/tradeRoutes.ts](src/routes/tradeRoutes.ts) | [docs/API.md](docs/API.md) | ダッシュボード用 |
| ノート承認: POST /api/trades/notes/:id/approve | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/services/tradeNoteService.ts#approveNote](src/services/tradeNoteService.ts), [src/controllers/tradeController.ts#approveNote](src/controllers/tradeController.ts) | [docs/API.md](docs/API.md) | 既存を拡張 |
| ノート非承認: POST /api/trades/notes/:id/reject | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/services/tradeNoteService.ts#rejectNote](src/services/tradeNoteService.ts), [src/controllers/tradeController.ts#rejectNote](src/controllers/tradeController.ts) | [docs/API.md](docs/API.md) | 新規追加 |
| 下書きに戻す: POST /api/trades/notes/:id/revert-to-draft | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/services/tradeNoteService.ts#revertToDraft](src/services/tradeNoteService.ts), [src/controllers/tradeController.ts#revertToDraft](src/controllers/tradeController.ts) | [docs/API.md](docs/API.md) | 新規追加（後戻り可能設計） |
| ノート更新: PUT /api/trades/notes/:id | ✅ | ✅ | ✅ | ✅(FS) | ✅ | [src/services/tradeNoteService.ts#updateNote](src/services/tradeNoteService.ts), [src/controllers/tradeController.ts#updateNote](src/controllers/tradeController.ts) | [docs/API.md](docs/API.md) | AI要約/ユーザーメモ/タグ編集 |

### 7.3 マッチング制御

| Requirement | 判定 | 実装 | テスト | Doc 整合 | 根拠（実装） | メモ |
|---|:--:|:--:|:--:|:--:|---|---|
| 承認済みノートのみマッチング対象 | ✅ | ✅ | ✅ | ✅ | [src/services/matchingService.ts#checkForMatches](src/services/matchingService.ts), [src/services/tradeNoteService.ts#loadApprovedNotes](src/services/tradeNoteService.ts) | Phase 2 Done条件達成 |

### 7.4 UI 実装

| Requirement | 判定 | 実装 | 根拠（実装） | メモ |
|---|:--:|:--:|---|---|
| ノート詳細: 承認/非承認/編集ボタン | ✅ | ✅ | [src/frontend/app/notes/[id]/page.tsx](src/frontend/app/notes/[id]/page.tsx) | ステータスに応じた動的ボタン表示 |
| ノート詳細: ステータスバッジ表示 | ✅ | ✅ | [src/frontend/app/notes/[id]/page.tsx](src/frontend/app/notes/[id]/page.tsx) | draft/approved/rejected を色分け |
| ノート詳細: 編集モード（AI要約/ユーザーメモ/タグ） | ✅ | ✅ | [src/frontend/app/notes/[id]/page.tsx](src/frontend/app/notes/[id]/page.tsx) | インライン編集UI |
| ノート一覧: ステータスフィルタタブ | ✅ | ✅ | [src/frontend/app/notes/page.tsx](src/frontend/app/notes/page.tsx) | 全件/下書き/承認済み/非承認 |
| ノート一覧: ステータス件数表示 | ✅ | ✅ | [src/frontend/app/notes/page.tsx](src/frontend/app/notes/page.tsx) | タブに件数を表示 |

### 7.5 テストカバレッジ

| テストファイル | テスト数 | 根拠 |
|---|:--:|---|
| noteApprovalFlow.test.ts | 16 | [src/backend/tests/noteApprovalFlow.test.ts](src/backend/tests/noteApprovalFlow.test.ts) |

