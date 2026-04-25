# Phase 6.7b 前提調査 — StrategyDSL 現仕様 + 関連調査

> 親: [phase_6_7b_bt_layer.md](phase_6_7b_bt_layer.md) §2.1, §2.2  
> 作成日: 2026-04-25

---

## 0. 6.7a 運用・DB 確認（プラン照合）

### 0.1 土日バー SQL 検証

- **スクリプト**: リポジトリ直下で  
  `npx tsx scripts/verify-ohlcv-weekend-bars.ts`  
  実装: [scripts/verify-ohlcv-weekend-bars.ts](../../scripts/verify-ohlcv-weekend-bars.ts)
- **2026-04-25 実行結果（接続先ローカル DB）**: 土日(UTC)バー **1288 本**（シンボル・時間足別に複数行）。**exit code 1**（0 行でない）
- **解釈**: 書き込み時フィルタ（[ohlcvRepository.ts](../../src/backend/repositories/ohlcvRepository.ts) `shouldPersistBar`）は実装済みだが、**6.7a 文書の「再収集後 土日=0」は、既存行の truncate + 再取り込みまで完了していない**可能性が高い。6.7b の BT 品質のため、本番/検証 DB では **truncate 方針（phase_6_7a §2.3）の完了**を推奨。

### 0.2 本番疎通

- コードからは判定不可。デプロイ後の Side-B オーケストレーション1往復、または既知のスモーク手順で **「エージェント実行が壊れていない」** を人間が確認する（[phase_6_7a_infrastructure.md](phase_6_7a_infrastructure.md) §6 最終項）。

### 0.3 Monte Carlo 2 系統の呼び出し元

`grep` 調査（テスト除く、実装の要約）:

| 系統 | 主な呼び出し元 |
|------|----------------|
| **Side-A** [monteCarloService.ts](../../src/services/backtest/monteCarloService.ts) | [strategyRoutes.ts](../../src/backend/api/strategyRoutes.ts) 経由で `monteCarloService.runSimulation`（UI/API 用と推定） |
| **Side-B** [MonteCarloTool.ts](../../src/side-b/validation/tools/MonteCarloTool.ts) | 仮説検証（Phase 4c） |

6.7b では Side-A サービスは**触らない**方針（[phase_6_7b_bt_layer.md](phase_6_7b_bt_layer.md) §1.2）。混同回避のため、戦略 BT は **ValidationTool 系 + `dslResult`** 経路に寄せる。

---

## 1. StrategyDSL の型（現行ソース）

- **定義元**: [src/side-b/strategy_dsl/schema.ts](../../src/side-b/strategy_dsl/schema.ts)（Zod + `z.infer`）
- **再エクスポート**: [src/side-b/strategy_dsl/index.ts](../../src/side-b/strategy_dsl/index.ts) を参照

### 1.1 ルート: `StrategyDSL`

| フィールド | 型（要約） |
|------------|------------|
| `id` | `string` |
| `generation` | `number`（default 0） |
| `parentIds` | `string[]` |
| `regimeTarget` | `string` |
| `symbol` | `string` |
| `timeframe` | `string` |
| `entry` | 下記 Entry |
| `stopLoss` | ATR 倍率 / 固定 pips / swing_point |
| `takeProfit` | rr_ratio / fixed_pips / atr_multiple |
| `parameters` | `Record<string, ParameterDef>` |
| `metadata` | `createdAt`, `createdBy`, `description?` |

### 1.2 エントリー: `EntrySchema`（**phase_6_7b 案の `entry.type` とは表現が異なる**）

現行は **discriminated union ではなく** 単一オブジェクト:

- `direction`: `'long' | 'short'`
- `trigger`: `ConditionGroup`（`logic: 'AND' | 'OR'`、`conditions` に `Condition` またはネスト `ConditionGroup`）
- `orderType`: `'market' | 'limit' | 'stop'`（default `'market'`）

**6.7b 設計案**の `entry.type: 'wait_for_trigger'` および `maxWaitBars` / `executionType` 等は **未実装**。拡張時は Zod スキーマの union 化、または `entry` 隣接フィールドの追加を [phase_6_7b_approval_b1b3.md](phase_6_7b_approval_b1b3.md) の B1/B2 と整合させる。

### 1.3 条件: `Condition` / `ConditionGroup`

- **Condition**: `lens`, `feature`, `op` (`<` `<=` `>` `>=` `==` `!=` `between` `in`), `value`（数値・文字列・真偽・`$param` ・タプル・配列）
- **ConditionGroup**: 再帰的 AND/OR

**注意（B2 関連）**: BT 時に利用可能な `lens` はシミュレーションが構築するスナップショットに依存。[dslBacktestSimulation.ts](../../src/side-b/strategy_dsl/dslBacktestSimulation.ts) では主に `ohlcv` レンズ + 事前計算指標。`current_analysis` 等は **未注入なら偽** になり、将来情報は DSLEvaluator 上は「当バー特徴のみ」に抑える必要がある（設計で明示）。

### 1.4 パラメータ: `ParameterDef`（現行）

```typescript
{ range: [number, number]; default: number; type: 'int' | 'float' }
```

**6.7b 案**の `ParameterRange { kind: 'range', min, max, step, default }` や固定値 `number | string | boolean` との **二重表現**になるため、6.7b 実装時は `schema.ts` の拡張方針（discriminate / 正規化）を B1 で固定する。

---

## 2. DSLBacktestAdapter 入出力

- **実装**: [DSLBacktestAdapter.ts](../../src/side-b/strategy_dsl/DSLBacktestAdapter.ts)

### 2.1 主要メソッド

| メソッド | 入出力（要約） |
|----------|----------------|
| `runBacktest(dsl, paramValues, period)` | DB/サービスから OHLCV 取得 → `runBacktestOnBars` |
| `runBacktestOnBars(dsl, paramValues, period, bars)` | `DslBacktestAggregate`（学習70%・検証30%、`train`/`validation` の summary + trades、過学習指標 `overfitScore`） |
| `runWithParameterSweep(dsl, period, strategy, sampleCount?)` | `grid` / `random` / `default`。グリッドは **最大2パラメータ**、サンプル数に上限。 |

### 2.2 出力型 `DslBacktestAggregate`

- `dslId`, `period`, `train`/`validation`（`BacktestResultSummary` + `BacktestTradeEvent[]`）, `overfitScore`, `trainPf`, `validationPf`
- 6.7b 設計の `DSLBacktestResult`（`pnls`, `events`, `finalReturn` 等）とは **名称・形状が未一致**。ValidationTool ラッパーでは **型エイリアス or アダプタ**で 6.7b 文書の `StrategyValidationInput` に合わせる必要あり。

### 2.3 パラメータスイープの実態

- 既存: `ParameterDef.range` 上の **grid**（1〜2 次元）/ **random** / **default のみ**。
- 6.7b: 「500 組み合わせ上限」・明示 `step` は **新規ロジック**（[phase_6_7b_bt_layer.md](phase_6_7b_bt_layer.md) §3.2, 3.4）。

---

## 3. テストで使われている StrategyDSL 例

1. [dslBacktestAdapter.test.ts](../../src/side-b/tests/strategy_dsl/dslBacktestAdapter.test.ts) — 最小エントリー（`ohlcv.close > 0`）、`parameters: {}`
2. [evolutionLoop.test.ts](../../src/side-b/tests/evolution/evolutionLoop.test.ts) — 進化ループ用の複数パターン
3. [diversityEnforcer.test.ts](../../src/side-b/tests/evolution/diversityEnforcer.test.ts) — 同様

---

## 4. 6.7b 実装前の示唆（調査者メモ）

- **型と設計ドキュメントの差**: 6.7b 文書の `entry.type` / `wait_for_trigger` / `scenarios` は **現行 `StrategyDSL` には存在しない**（`scenarios` は Thinker 出力側の話）。B1 でスキーマを固定すること。
- **DslBacktestAggregate → 3 ツール**: `BacktestTradeEvent` から PnL 列・Python WF 用イベント形式への **変換層**が必要か、WalkForwardTool 実装時に要確認。
- **OHLCV 品質**: 土日バー残存は BT 汚染要因。6.7b 着手前に **可能な限り 6.7a データ整備**を揃えると再現性が上がる。

---

## 5. 参考パス

| パス | 内容 |
|------|------|
| [DSLEvaluator.ts](../../src/side-b/strategy_dsl/DSLEvaluator.ts) | 条件評価 |
| [dslBacktestSimulation.ts](../../src/side-b/strategy_dsl/dslBacktestSimulation.ts) | バー走査・約定 |
| [dslParameterUtils.ts](../../src/side-b/strategy_dsl/dslParameterUtils.ts) | `defaultParameterValues` |

---

## 6. 履歴

| 日付 | 内容 |
|------|------|
| 2026-04-25 | 初版（6.7b §2.1, §2.2 調査、土日 SQL スクリプト実行結果を記録） |
