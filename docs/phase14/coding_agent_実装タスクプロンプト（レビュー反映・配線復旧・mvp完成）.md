# CodingAgent 実装タスクプロンプト（レビュー反映・配線復旧・MVP完成）

あなたは **Trader-Note-Build-Ai / TradeAssist MVP** のコーディング担当 Agent です。以下を **実装タスクとして順番に完遂**してください。

本プロンプトは、ユーザーが共有したレビュー結果（2025-12-30）と、本チャットで合意した方針（Layer設計・通知/ログ・インジケータ拡張性）を **実装へ落とす**ための完全版です。

---

## 0. 最重要方針（破ったらNG）

### A. レイヤー別の保存（確定）
- **Layer1（生データ・前提・パラメータ・市場スナップショット）**：File（JSON）
- **Layer2（特徴量・正規化・マッチング用数値）**：File（JSON）※ 類似検索用の最小限のみDBへインデックス可
- **Layer3（AIノート文章・通知文言・通知ログ/実行ログ・運用に必要な履歴）**：DB（Prisma）または File（ただし既存のログAPIがDB前提ならDBに寄せる）

### B. 依存方向（確定）
- Service / Domain 層で `@prisma/client` 型を import しない。
- Prisma 型は Repository（Infrastructure）に閉じ込める。
- Domain DTO（例：MatchResultDTO）を導入し、Controller/Service は DTO で完結させる。

### C. Layer2で「意味の推定」をしない（確定）
- period などのパラメータから「短期/長期」等のラベル付けや推定を **Layer2で行わない**。
- Layer2は **観測された状態量**（傾き、乖離、クロス、経過本数、正規化距離など）のみ。
- 解釈は Layer3（AI）/UI で可逆に行う。

---

## 1. 優先度 High: レビュー指摘の修正（仕様と実装の同期）

### 1-1. CSV取込APIの縮退修正（notesGenerated: 0 問題）
**現状**：`POST /api/trades/import/csv` が DB取込のみで `notesGenerated: 0` 固定。Docs（API.md/README/USER_GUIDE）では「import/csvでノート生成まで行う」前提。

**対応（採用）**：`import/csv` でノート生成まで行い、返却値を実態に合わせる。

#### 実装要件
- `TradeImportService` が取込完了後に `TradeNoteService` を呼び、
  - 取込されたトレード単位（または定義済みのノート単位）で TradeNote（Layer1/2/3のうち、現時点で生成できる範囲）を生成。
- レスポンスの `notesGenerated` を **実数**で返す。
- 失敗系：
  - CSVが存在しない
  - CSVフォーマット不正
  - 取込はできるがノート生成に必要なデータが不足
  を明確に扱い、HTTPステータス/エラー本文を定義。

#### テスト
- 正常CSVで `notesGenerated > 0`
- 異常CSVで 4xx
- 最小CSVで成功（ただし欠損フィールドがある場合の扱いを仕様化）

---

### 1-2. 通知トリガ `/api/notifications/check` のログ・クールダウン・重複抑止
**現状**：NOTIFY_THRESHOLD 判定のみで、NotificationLog/クールダウン/冪等性が未実装。

#### 実装要件（Runbook準拠）
- `NotificationTriggerService` に以下を実装：
  1. **冪等性**：同一条件（noteId × marketSnapshotId × channel 等）を一意に扱う（DBにユニーク制約 or ロジック）
  2. **クールダウン**：同一 noteId（または noteId+symbol）について1時間以内の再通知を抑止
  3. **重複抑制**：直近5秒以内の同一条件を抑止
- `POST /api/notifications/check` は
  - マッチ評価
  - 抑止判定
  - 通知生成（In-app通知＝Fileストア）
  - **NotificationLog を永続化（DB推奨）**
  を一連で実行し、`skipReason` を返せるようにする。

#### 保存戦略（確定運用）
- In-app 通知一覧/既読/削除：**Fileストア継続**（既存仕様を壊さない）
- NotificationLog：既存ログAPIがあるため **DB（Prisma）** を優先

#### テスト
- Runbookにある再通知防止の主要ケースを unit test 化（最低 13 ケース相当）
- `/api/notifications/check` を叩いて
  - 通知が作られる
  - ログが作られる
  - 連続実行で抑止される

---

### 1-3. マッチ履歴 `/api/matching/history` が通知ファイル依存で欠落する問題
**現状**：通知ファイルから type=match を抽出して履歴扱い。通知されていないマッチは履歴に残らない。

#### 対応方針（採用）
- **MatchResult をDBに永続化**し、`/api/matching/history` は MatchResult を参照する。
- ただし Domain/Service から Prisma 型を追放し、Repositoryで変換。

#### 実装要件
- `MatchResultDTO` を Domain に追加し、Service/Controller は DTO で扱う。
- `MatchResultRepository`（Prisma 実装）を追加。
- `POST /api/matching/check` 実行時に MatchResult を保存（score/reasons/marketSnapshotId等）。
- `/api/matching/history` は DB から取得し、必要ならページング。

---

### 1-4. 環境変数の揺れ（DATABASE_URL/DB_URL）を実装側で統一
**現状**：コードが `DATABASE_URL ?? DB_URL` のフォールバックを許容。

#### 対応（必須）
- 実装側から `DB_URL` を完全削除。
- 起動時に `DATABASE_URL` が無ければ即時エラー。
- `.env.example` / Docs が `DATABASE_URL` 前提なら、実装も完全追従。

---

### 1-5. フロント README のAPIメソッド誤記（POST→PUT）
- `src/frontend/README.md` の該当箇所を **PUT** に修正。
- API一覧のベースパスや例が古い場合は更新。

---

## 2. 優先度 High: インジケーター計算「未配線」問題の解消（定数埋め込み撤廃）

### 2-1. 現状
- `indicatorService.ts` にRSI/SMA等の計算が存在しても、
  - `MarketDataService` は RSI=50, MACD=0 など固定値
  - `MatchingService` は固定値を特徴量へ
  - `TradeNoteService` も未利用
という **通電していない状態**。

### 2-2. ゴール
- MarketData取得→OHLCV配列→indicator計算→MarketSnapshot（Layer1）→FeatureBuilder（Layer2）→
  - TradeNote生成
  - Matching特徴量
へ、最低限の配線を通す。

### 2-3. インジケーター拡張（20種・ユーザー選択・同一指標の複数period対応）

#### 必須要件
- **IndicatorDefinition**（共通定義）と **IndicatorInstance**（ユーザー使用）を分離。
- 同一指標の別params（例：SMA(3), SMA(15), SMA(60)）は **別インスタンス**として扱う。
- インスタンス識別子：`instanceId = indicatorKey + '|' + 正規化params`（例：`sma|period=15`）
- Layer1/2の保存は `instanceId` をキーに持つ。

#### 禁止
- period から短期/長期などの推定を Layer2で行う。

### 2-4. 実装タスク（最小配線：3箇所）

#### (A) MarketDataService
- OHLCV 配列を取得（足数不足時は安全に扱う）
- `indicatorService.generateIndicators(ohlcv, indicatorInstances)` を呼び、
  - Layer1用の `indicators`（instanceId→values/params）を生成して MarketSnapshot に載せる

#### (B) TradeNoteService
- ノート生成時に MarketSnapshot.indicators を取り込み、
  - Layer1（生データ+params）
  - Layer2（特徴量：傾き、乖離、クロス、経過本数、正規化距離など）
  をファイルに保存。
- Layer3（AI文章）は既存方針に従い、生成/保存戦略を壊さない。

#### (C) MatchingService
- currentFeatures を MarketSnapshot.indicators / Layer2特徴量から生成。
- cosine の次元整合（不足は0埋め等）と 0除算防御。

### 2-5. テスト
- 指標計算：
  - 足数不足（N未満）
  - NaN/undefined
  - 正常ケース
- マッチング：
  - 次元不一致/欠損
  - 0除算防御

---

## 3. 優先度 Medium: 実装とドキュメント・カバレッジ表の同期

### 3-1. ドキュメント更新
- `API.md` / `USER_GUIDE.md` / `README.md` / `src/frontend/README.md` を実装に追従させる。
  - import/csv の挙動
  - notifications/check の返却（skipReason/log）
  - matching/history の参照先（DB）

### 3-2. docs/_coverage/implementation-matrix.md
- 該当行（import/csv、notifications/check、matching/history、RSI/SMA等）を更新し、
  - 実装✅/⚠️/❌
  - テスト状況
  - 参照ファイル
  を現状に合わせる。

---

## 4. 実装の進め方（手順の強制）

1. **ブランチ作成**
2. High 優先度（1章 + 2章）を上から順に実装
3. テスト追加（unit + E2E）
4. Doc/Matrix 更新
5. `npm test` / `npm run lint` / `npm run typecheck` / E2E が全て通ること

---

## 5. 完了条件（これを満たしたら終了）

### API動作
- `POST /api/trades/import/csv` がノートを生成し `notesGenerated > 0`
- `POST /api/notifications/check` が
  - しきい値判定
  - ログ永続化
  - クールダウン/重複抑止
  を実行し、結果が確認できる
- `GET /api/matching/history` が DB の MatchResult を返す

### 指標
- `MarketDataService` が固定値ではなく indicatorService を使用
- SMA(3/15/60) のような同一指標の複数paramsを扱える
- Layer2での period 推定が存在しない

### 環境
- `DB_URL` がコードから消え、`DATABASE_URL` 未設定なら起動時に落ちる

### 品質
- unit tests が追加され、既存テストと合わせて全て pass
- 主要E2E（import→note→match→notify）が最低1本は通る

---

## 6. 追加の技術メモ（実装時の注意）

- 既存のファイルストア（通知/ノート）を壊さない。保存パスや形式変更は最小化。
- Prisma migration は必要最小限で行う（MatchResult/NotificationLog のユニーク制約等）。
- 既存の Controller のルーティング・レスポンス互換を優先。

---

## 7. 最終成果物（PRに含める）

- コード修正（上記すべて）
- 追加テスト（unit + 可能ならE2E）
- Doc更新（API/Guide/README）
- docs/_coverage/implementation-matrix.md 更新

以上を満たす実装を行い、差分をコミットしてください。

