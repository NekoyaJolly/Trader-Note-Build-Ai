# Agent 実行順オーケストレーション（Runbook）

## 目的

この Runbook は **TradeAssist MVP を AI Agent 主導で安全かつ再現性高く実装するための実行順制御書** です。

* どの Agent を
* どの順番で
* どの成果物を確認してから

次に進めるかを明確に定義します。

---

## 全体原則（最重要）

1. **並列実行は禁止**
2. 各 Phase は完了判定を満たしてから次へ進む
3. 人間レビューを必ず挟む
4. レビューは `Agent_Review_Checklist` に従う

---

## 実行フロー概要

```
Phase0 Agent
   ↓（人間レビュー）
Phase1 Agent
   ↓（人間レビュー）
Phase2 Agent
   ↓（人間レビュー）
Phase3 Agent
   ↓
Phase4 Agent
   ↓
Phase5 Agent
```

※ Phase3 以降は MVP 検証状況に応じて中断可

---

## Phase0

### 使用プロンプト

* `Phase0_Agent_Prompt`

### 生成物

* docs/phase0/scope.md
* docs/phase0/data-model.md
* docs/phase0/api-contract.md
* docs/phase0/architecture.md
* docs/phase0/decisions.md

### 完了判定

* 成果物がすべて存在
* 日本語で記述されている
* Phase1 が質問無しで着手可能

---

## Phase1

### 使用プロンプト

* `Phase1_Agent_Prompt`

### 生成物

* API 実装
* DB マイグレーション
* Realtime ingest 実装
* 単体テスト

### 完了判定

* API 起動
* DB 永続化確認
* 15m/60m データ取得確認

---

## Phase2

### 使用プロンプト

* `Phase2_Agent_Prompt`

### 生成物

* 特徴量計算ロジック
* ノート生成処理
* AI 要約連携

### 完了判定

* ノートが DB に保存される
* 要約が日本語で生成される

---

## Phase3

### 使用プロンプト

* `Phase3_Agent_Prompt`（MatchEvaluationService 実装）

### 生成物

* MatchEvaluationService
* RuleBasedMatchEvaluator
* MatchResult テーブル・Repository
* 単体テスト

### 完了判定

* MatchResult が DB に保存される
* score / reasons が記録される
* テスト全数成功

---

## Phase4

### 使用プロンプト

* `Phase4_Agent_Prompt`（通知ロジック実装）

### 生成物

* NotificationLog テーブル・Repository
* NotificationSender インターフェース
* InAppNotificationSender 実装
* NotificationTriggerService（再通知防止ロジック）
* NotificationController 統合
* 単体テスト（13 ケース）
* API ドキュメント更新
* ドキュメント（Phase4 completion-report.md、MATCHING_ALGORITHM.md 更新）

### 主な実装内容

#### 再通知防止機構
1. **冪等性チェック**: noteId × marketSnapshotId × channel で一意性保証
2. **クールダウン**: 同一 noteId について 1 時間内の再通知を防止
3. **重複抑制**: 直近 5 秒以内の同一条件通知を検査

#### 新規エンドポイント
* POST /api/notifications/check
* GET /api/notifications/logs
* GET /api/notifications/logs/:id
* DELETE /api/notifications/logs/:id

### 完了判定

* 通知トリガが正しく動作（テスト 13/13 成功）
* 再通知事故が起きない（冪等性確認）
* ログが DB に保存される
* NotificationLog テーブルが migration 完了

---

1. `Agent_Review_Checklist` を開く
2. 前提チェック（即 NG 項目）確認
3. Phase 適合性確認
4. GO / NG 判定

---

## 例外対応

* NG の場合は **同一 Phase Agent に差し戻し**
* フェーズを飛ばしての修正は禁止
* 人間判断で Phase を中止することは可

---

## ゴール

* 各 Phase が独立して再実行可能
* 途中停止しても再開できる
* 将来、別の Agent に置き換えても同じ結果になる

この Runbook は、
**AI をチームメンバーとして安全に使うための中核ドキュメント**です。
必ず遵守してください。