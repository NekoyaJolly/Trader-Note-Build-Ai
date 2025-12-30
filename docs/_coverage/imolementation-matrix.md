# implementation-matrix.md（実装・テスト・ドキュメント整合マトリクス）

本ファイルは「実装漏れ」「テスト漏れ」「ドキュメント更新漏れ」を早期に検出するためのカバレッジ表です。  
各行は **要件（Requirement）** を単位として、実装・テスト・ドキュメントの対応状況を記録します。

---

## ステータス定義

- ✅: 完了（実装/テスト/ドキュメントが揃っている）
- ⚠️: 一部不足・要確認（例: テスト不足、仕様が曖昧、Docと実装が乖離）
- ❌: 未対応
- 💤: 対象外（現フェーズでは不要/延期）

---

## 記入ルール（重要）

1. **「実装」だけの完了は認めない**（最低でも Doc か Test のどちらかをセットで進める）
2. API は **API.md** と整合していること（パス/メソッド/レスポンス例/パラメータ）
3. UI は **src/frontend/README.md** と整合していること（ページ、主要コンポーネント、API 連携）
4. アーキは **ARCHITECTURE.md** と整合していること（ストレージ方針・責務・データフロー）
5. スコアリングや通知条件は **MATCHING_ALGORITHM.md** と整合していること
6. インジケーターは **定義書（RSI/SMA 等）** と実装の Layer1/2/3 が一致していること
7. 変更が入った行は「最終確認日」「担当」「メモ」を更新する

---

## 0. 横断（環境変数・運用・規約）

| Phase | 区分 | Requirement | 実装 | テスト | Doc | 実装/参照ファイル | Doc 参照 | メモ | 最終確認日 | 担当 |
|---:|---|---|:--:|:--:|:--:|---|---|---|---|---|
| P0+ | Env | 環境変数一覧が docs と .env.example で一致 | ⚠️ | 💤 | ✅ | .env.example / Prisma / 起動コード | README / AGENTS | Doc 側は DATABASE_URL/NOTIFY_THRESHOLD に統一済み。実装は DB_URL fallback が残るため要確認。 | 2025-12-30 |  |
| P0+ | Policy | 日本語コメント/日本語ドキュメント規約が遵守されている | ⚠️ | 💤 | ✅ | 全体 | AGENTS.md | 英語が混在している doc の洗い出し |  |  |
| P6+ | Deploy | 本番前フロー（Phase6-11）が最新運用と一致 | ⚠️ | 💤 | ✅ |  | AGENTS.md | 実際のデプロイ先・実施手順が変わったら更新 |  |  |

---

## 1. Backend API（機能別）

### 1-1. Health

| Phase | 区分 | Requirement | 実装 | テスト | Doc | 実装/参照ファイル | Doc 参照 | メモ | 最終確認日 | 担当 |
|---:|---|---|:--:|:--:|:--:|---|---|---|---|---|
| P1 | API | GET /health が status/timestamp/schedulerRunning を返す | ✅ | ⚠️ | ✅ | backend health handler | API.md / README | UI 呼び出しを /health に揃え済み。自動テスト未整備。 | 2025-12-30 |  |

### 1-2. Trade Import & Notes

| Phase | 区分 | Requirement | 実装 | テスト | Doc | 実装/参照ファイル | Doc 参照 | メモ | 最終確認日 | 担当 |
|---:|---|---|:--:|:--:|:--:|---|---|---|---|---|
| P1 | API | POST /api/trades/import/csv で CSV 取込→ノート生成 | ✅ | ⚠️ | ✅ | TradeImportService / TradeNoteService | API.md / README / USER_GUIDE | ノートは FS 保存、Trade は Prisma DB 保存のハイブリッドで Doc に未記載。正常/異常CSVの自動テスト未整備。 | 2025-12-30 |  |
| P1 | API | GET /api/trades/notes 一覧取得 | ✅ | ❌ | ✅ | Notes controller | API.md / README | FS 上のノートのみ返却し、DB の TradeNote モデルとは非連動。ページング未定義。 | 2025-12-30 |  |
| P1 | API | GET /api/trades/notes/:id 詳細取得 | ✅ | ❌ | ✅ | Notes controller | API.md / README | FS ベースのため Prisma 定義と乖離。404/不正IDテスト未整備。 | 2025-12-30 |  |

### 1-3. Matching

| Phase | 区分 | Requirement | 実装 | テスト | Doc | 実装/参照ファイル | Doc 参照 | メモ | 最終確認日 | 担当 |
|---:|---|---|:--:|:--:|:--:|---|---|---|---|---|
| P3 | API | POST /api/matching/check 手動マッチング実行 | ✅ | ❌ | ✅ | MatchingController/Service | API.md / README | マッチ結果保存先（DB/FS）と整合要確認 |  |  |
| P3 | API | GET /api/matching/history マッチ履歴取得 | ⚠️ | ❌ | ⚠️ | MatchingController/Service | API.md / README | MatchResult を DB 保存しておらず、通知ファイルの内容のみ返すため Doc の履歴定義と乖離。 | 2025-12-30 |  |

### 1-4. Notifications（基本）

| Phase | 区分 | Requirement | 実装 | テスト | Doc | 実装/参照ファイル | Doc 参照 | メモ | 最終確認日 | 担当 |
|---:|---|---|:--:|:--:|:--:|---|---|---|---|---|
| P4 | API | GET /api/notifications（unreadOnly 対応） | ✅ | ❌ | ✅ | NotificationController | API.md / README / USER_GUIDE | 通知一覧をファイルストアに統一し、UI も PUT メソッドに揃えた。テスト未追加。 | 2025-12-30 |  |
| P4 | API | PUT /api/notifications/:id/read 既読化 | ✅ | ❌ | ✅ | NotificationController | API.md / README | ファイルストアと整合。PUT メソッドに統一。テスト未追加。 | 2025-12-30 |  |
| P4 | API | PUT /api/notifications/read-all 一括既読 | ✅ | ❌ | ✅ | NotificationController | API.md / README | ファイルストアで一括既読を反映。テスト未追加。 | 2025-12-30 |  |
| P4 | API | DELETE /api/notifications/:id 削除 | ✅ | ❌ | ✅ | NotificationController | API.md / README | ファイルストア基準で削除を統一。テスト未追加。 | 2025-12-30 |  |
| P4 | API | DELETE /api/notifications 全削除 | ✅ | ❌ | ✅ | NotificationController | API.md / USER_GUIDE | ファイルストアの通知を全削除。DB ログは別管理。テスト未追加。 | 2025-12-30 |  |

### 1-5. Notifications（Phase4: トリガ・ログ）

| Phase | 区分 | Requirement | 実装 | テスト | Doc | 実装/参照ファイル | Doc 参照 | メモ | 最終確認日 | 担当 |
|---:|---|---|:--:|:--:|:--:|---|---|---|---|---|
| P4 | API | POST /api/notifications/check（再通知防止適用） | ⚠️ | ⚠️ | ⚠️ | NotificationTriggerService | API.md / Runbook / MATCHING_ALGORITHM | MatchResult を DB に保存する経路がなく、API 呼び出し時に対象データが存在しない。閾値は NOTIFY_THRESHOLD だが Doc/README で未説明。 | 2025-12-30 |  |
| P4 | API | GET /api/notifications/logs（filter/limit） | ✅ | ❌ | ✅ | NotificationLog controller | API.md | パラメータのバリデーション方針を Doc に追記 |  |  |
| P4 | API | GET /api/notifications/logs/:id | ✅ | ❌ | ✅ | NotificationLog controller | API.md |  |  |  |
| P4 | API | DELETE /api/notifications/logs/:id | ✅ | ❌ | ✅ | NotificationLog controller | API.md |  |  |  |

### 1-6. Orders

| Phase | 区分 | Requirement | 実装 | テスト | Doc | 実装/参照ファイル | Doc 参照 | メモ | 最終確認日 | 担当 |
|---:|---|---|:--:|:--:|:--:|---|---|---|---|---|
| P5 | API | GET /api/orders/preset/:noteId 注文プリセット生成 | ✅ | ❌ | ✅ | OrderController/Service | API.md / README / USER_GUIDE | 「自動売買しない」制約が UI/Doc に一貫しているか再点検 |  |  |
| P5 | API | POST /api/orders/confirmation 事前確認情報 | ✅ | ❌ | ✅ | OrderController/Service | API.md / README / USER_GUIDE | 数値丸め、手数料推定の根拠を Doc に明記 |  |  |

---

## 2. フロントエンド（Phase5 UI）

| Phase | 区分 | Requirement | 実装 | テスト | Doc | 実装/参照ファイル | Doc 参照 | メモ | 最終確認日 | 担当 |
|---:|---|---|:--:|:--:|:--:|---|---|---|---|---|
| P5 | UI | トップページ（/）が主要導線を提供 | ✅ | ❌ | ✅ | src/frontend/app/page.tsx | src/frontend/README | 空状態UX（通知0件等）を明文化 |  |  |
| P5 | UI | 通知一覧（/notifications）表示・既読/未読 | ✅ | ❌ | ✅ | src/frontend/app/notifications | src/frontend/README | APIエラー時の表示（再試行/バナー）を仕様化 |  |  |
| P5 | UI | 通知詳細（/notifications/:id）理由・MarketSnapshot 表示 | ✅ | ❌ | ✅ | src/frontend/app/notifications/[id] | src/frontend/README |  |  |  |
| P5 | UI | ScoreGauge コンポーネント | ✅ | ❌ | ✅ | components/ScoreGauge.tsx | src/frontend/README |  |  |  |
| P5 | UI | MatchReasonVisualizer（理由可視化） | ✅ | ❌ | ✅ | components/MatchReasonVisualizer.tsx | src/frontend/README |  |  |  |
| P5 | UI | MarketSnapshotView（15m/60m） | ✅ | ❌ | ✅ | components/MarketSnapshotView.tsx | src/frontend/README |  |  |  |
| P5 | UI | API クライアントが /lib/api.ts に集約 | ✅ | ❌ | ✅ | lib/api.ts | src/frontend/README | fetch 直叩きが増えたら即修正 |  |  |

---

## 3. マッチング/スコアリング仕様（アルゴリズム整合）

| Phase | 区分 | Requirement | 実装 | テスト | Doc | 実装/参照ファイル | Doc 参照 | メモ | 最終確認日 | 担当 |
|---:|---|---|:--:|:--:|:--:|---|---|---|---|---|
| P3 | Algo | 特徴量ベクトル定義が実装と一致 | ✅ | ❌ | ✅ | MatchingService など | MATCHING_ALGORITHM.md | 実装は 7 次元（price, qty, rsi, macd, volume, trend, side）で Doc と一致。テスト未整備。 | 2025-12-30 |  |
| P3 | Algo | Cosine similarity 実装が仕様通り | ✅ | ❌ | ✅ | cosineSimilarity 実装 | MATCHING_ALGORITHM.md | 0除算・次元不一致の防御をテストで担保する必要あり。 | 2025-12-30 |  |
| P3 | Algo | trendMatch / priceRangeMatch の重み付けが仕様通り | ⚠️ | ❌ | ⚠️ | calculateMatchScore / NotificationTriggerService | MATCHING_ALGORITHM.md | スコア重みは 0.6/0.3/0.1 で一致するが通知閾値は NOTIFY_THRESHOLD、マッチ判定は MATCH_THRESHOLD と二重で Doc 未記載。 | 2025-12-30 |  |
| P4 | Notify | 再通知防止（冪等性/クールダウン/重複抑制） | ✅ | ⚠️ | ✅ | NotificationTriggerService | Runbook / MATCHING_ALGORITHM | Runbook記載の13ケースが現実に揃っているか点検 |  |  |

---

## 4. インジケーター（定義書 ↔ 実装整合）

| Phase | 区分 | Requirement | 実装 | テスト | Doc | 実装/参照ファイル | Doc 参照 | メモ | 最終確認日 | 担当 |
|---:|---|---|:--:|:--:|:--:|---|---|---|---|---|
| P2 | Indicator | RSI 定義（Layer1/2/3）が実装と一致 | ⚠️ | ⚠️ | ✅ | indicatorService 等 | RSI.md | 実装がどの平滑化（Wilder/EMA）かを明示して一致させる |  |  |
| P2 | Indicator | SMA 定義（Layer1/2/3）が実装と一致 | ⚠️ | ⚠️ | ✅ | indicatorService 等 | SMA.md | 乖離率/傾き閾値がコード定数と一致しているか点検 |  |  |
| P2 | Indicator | インジケーター雛形に従う（新規追加時） | ✅ | 💤 | ✅ | docs template | SMA.md / RSI.md | 新規指標追加の手順（チェック項目）を追加しても良い |  |  |

---

## 5. データ永続化（FS / DB）とドキュメント整合（要重点）

| Phase | 区分 | Requirement | 実装 | テスト | Doc | 実装/参照ファイル | Doc 参照 | メモ | 最終確認日 | 担当 |
|---:|---|---|:--:|:--:|:--:|---|---|---|---|---|
| P1+ | Storage | 永続化先（ファイル/DB）が Docs と一致 | ⚠️ | ❌ | ✅ | Prisma/Repository/FS | ARCHITECTURE.md / README | 現状は Trade/NotificationLog/MatchResult=DB、TradeNote/Notification=FS のハイブリッドである旨を明記。 | 2025-12-30 |  |
| P1+ | Storage | Notification / Log の保存先が一致 | ⚠️ | ❌ | ✅ | NotificationRepository | ARCHITECTURE.md / API.md | Notification は FS、Log は DB であることを記載。保存先の二系統は今後統合が必要。 | 2025-12-30 |  |

---

## 6. テスト（最低限の品質ゲート）

| Phase | 区分 | Requirement | 実装 | テスト | Doc | 実装/参照ファイル | Doc 参照 | メモ | 最終確認日 | 担当 |
|---:|---|---|:--:|:--:|:--:|---|---|---|---|---|
| P1+ | Test | Jest が動作し CI で回せる | ✅ | ⚠️ | ⚠️ | package.json scripts | README / AGENTS | jest スイートは多数存在するが health/notifications/endpoint 系の統合テストが欠如。実行手順を README に未記載。 | 2025-12-30 |  |
| P1+ | Test | CSV import 正常/異常の E2E スクリプト | ⚠️ | ⚠️ | ✅ | scripts/verify-e2e.sh 等 | テスト用CSV一覧 | verify-e2e.sh の導線が README から辿れず、CI 組み込みも未確認。 | 2025-12-30 |  |

---

## 更新履歴

- 2025-12-30: 初版作成（coverage 管理導入）
