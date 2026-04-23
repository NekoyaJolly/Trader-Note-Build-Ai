# Phase 6.7b — 即時バックテスト層 + StrategyDSL 拡張

> 親: `phase_6_7_overview.md`
> 範囲: DSLBacktestAdapter のラップ、Side-A 独立経路、StrategyDSL 拡張
> 依存: `phase_6_7a_infrastructure.md` 完了
> 次: `phase_6_7c_prompts.md`

---

## 0. このサブフェーズのゴール

Strategy Thinker が出した戦略を**その場でバックテストし、結果をオーケストレーターに返す層**を新設する。既存資産 `DSLBacktestAdapter` (Phase 5A) を再利用し、Phase 4c の既存3ツール(WalkForward / MonteCarlo / BuyAndHold)を戦略BTにも流す。

### 主要タスク

1. **調査**: StrategyDSL の現仕様把握(Claude Code タスク)
2. **StrategyDSL 拡張仕様決定**(parameters スイープ / wait_for_trigger)
3. **DSLBacktestAdapter のラッパー実装**(ValidationTool 互換)
4. **戦略BT独立経路の実装**(Side-A 非依存)
5. **Orchestrator への組み込み**

---

## 1. 前提(Phase 4c 既存資産の把握)

### 1.1 既存資産(利用するもの)

- `src/side-b/strategy_dsl/DSLBacktestAdapter.ts` (Phase 5A)
  - **既存の進化ループ内で使われており、動作実績あり**
  - OHLCV を受け取って DSL を評価、学習70%/検証30% 分割 + パラメータスイープ内蔵
- `src/side-b/validation/tools/WalkForwardTool.ts`
- `src/side-b/validation/tools/MonteCarloTool.ts`
- `src/side-b/validation/tools/BuyAndHoldTool.ts`
- 共通インターフェース `ValidationTool`(`src/side-b/validation/tools/types.ts`)

### 1.2 既存資産(触らない)

- **Side-A `BacktestService`**: 戦略BT経路は Side-A を経由しない(独立経路方針)
- **`services/backtest/monteCarloService.ts`**: Side-A UI 用、本フェーズで触らない
- **`python/walk_forward/`**: WalkForwardTool が呼び出す既存 Python。そのまま利用
- **`analysis-engine/`**: 指標計算専用 FastAPI。無関係

### 1.3 独立経路の意味

現状の ValidationTool は `backtestRunId`(Side-A BacktestService の runId)を前提としている。

**戦略BTでは別の入力源として `DSLBacktestResult` を使う**:

```
(仮説評価経路、既存)
EdgeHypothesis → Side-A BacktestService → runId → ValidationTool.execute({ hypothesis, backtestRunId })

(戦略BT経路、新設)
StrategyDSL → DSLBacktestAdapter → DSLBacktestResult → ValidationTool.execute({ strategy, dslResult })
```

---

## 2. 調査タスク(Claude Code 向け、実装前に必須)

### 2.1 タスク StrategyDSL 現仕様調査

**目的**: `StrategyDSL` の現在の型定義・表現力・制約を把握。`parameters スイープ` / `wait_for_trigger` 実装のためのベースライン確認。

**調査範囲**: `src/side-b/strategy_dsl/`

**出力**: `docs/design/phase_6_7b_strategy_dsl_audit.md`

**必要な情報**:
- `StrategyDSL` の完全な TypeScript 型定義(interface/type 全て)
- `entry.type` の union 値すべて
- `parameters` フィールドがあるか、どういう形か
- `DSLBacktestAdapter` の入力型と出力型(完全な型定義)
- `DSLBacktestAdapter` 内部で呼んでいるパラメータスイープロジック
- 現在のテストで使われている StrategyDSL の具体例(3個ほど)

### 2.2 タスク MonteCarlo 2系統の呼び出し元確認

**目的**: `services/backtest/monteCarloService.ts` が UI 等から呼ばれているか確認(Phase 6.7 で触らないが、混同を避けるため)

**コマンド**:
```bash
grep -rn "monteCarloService\|MonteCarloService" src/ --include="*.ts" --exclude-dir=__tests__
grep -rn "from.*backtest/monteCarlo" src/ --include="*.ts" --exclude-dir=__tests__
```

**出力**: overview 付録に追記(新規ファイル不要)

---

## 3. StrategyDSL 拡張仕様(確定事項 + 設計案)

### 3.1 確定事項(Nekoさん承認済み)

1. **parameters スイープに対応**: 固定値だけでなく探索範囲を指定可能に
2. **wait_for_trigger エントリー形式を追加**: 複合条件でのエントリー待機を表現
3. **scenarios は最低1つ必須**: プロンプト側の制約(Phase 6.7c で対応)だが、DSL側も空配列をエラーとする

### 3.2 parameters スイープ案

既存フィールド `parameters` の型を拡張(現状は固定値想定):

```typescript
// 既存(想定)
interface Parameters {
    [key: string]: number | string | boolean;
}

// 拡張後
type ParameterValue =
    | number | string | boolean               // 固定値(既存互換)
    | ParameterRange;                           // 範囲指定(新規)

interface ParameterRange {
    kind: 'range';
    min: number;
    max: number;
    step: number;
    default: number;   // BT時のデフォルト値(スイープしない場合に使う)
}

interface Parameters {
    [key: string]: ParameterValue;
}
```

**例**:
```json
{
  "parameters": {
    "rsi_period": { "kind": "range", "min": 9, "max": 21, "step": 2, "default": 14 },
    "bb_stdev": 2.0
  }
}
```

**DSLBacktestAdapter の挙動**:
- `ParameterRange` が含まれる戦略 → 全組み合わせでBT実行、最適値を特定
- 全て固定値 → 1回だけBT

**上限**: パラメータ数 × 刻みの組み合わせが多すぎるとBT時間が爆発する。上限を**例: 500組み合わせ**に設定、超過時はエラー。

### 3.3 wait_for_trigger 案

`entry.type` に `wait_for_trigger` を追加:

```typescript
type EntryType =
    | 'market'
    | 'limit'
    | 'stop'
    | 'wait_for_trigger';  // 新規

interface WaitForTriggerEntry {
    type: 'wait_for_trigger';
    direction: 'long' | 'short';
    /** エントリーを発動させる条件グループ(全て true でエントリー) */
    triggerConditions: ConditionGroup;
    /** トリガー有効期限(バー数)。超えたら scenario キャンセル */
    maxWaitBars: number;
    /** 発動後のエントリー方式(通常は 'market'、条件充足時の次バー始値でエントリー) */
    executionType: 'market' | 'limit';
    /** executionType='limit' 時の限値条件 */
    limitPrice?: number | PriceExpression;
}
```

**`ConditionGroup` は既存型を流用**(調査タスク 2.1 で確認)。

**例**:
```json
{
  "entry": {
    "type": "wait_for_trigger",
    "direction": "long",
    "triggerConditions": {
      "op": "AND",
      "conditions": [
        { "lens": "current_analysis", "feature": "rsi", "op": "<", "value": 30 },
        { "lens": "current_analysis", "feature": "bb_touch_lower", "op": "==", "value": true }
      ]
    },
    "maxWaitBars": 48,
    "executionType": "market"
  },
  "stopLoss": { "type": "atr_multiple", "value": 1.5 },
  "takeProfit": { "type": "rr_ratio", "value": 2.0 }
}
```

### 3.4 BT 層での wait_for_trigger 評価ロジック

`DSLBacktestAdapter` 内で:

```
各バー bar_t ごとに:
  if scenario の状態 == 'waiting':
    if triggerConditions が bar_t で全て true:
      エントリー実行(bar_{t+1} の open で)
      状態 → 'open'
    elif (bar_t - 開始バー) > maxWaitBars:
      状態 → 'expired'(トレード発生しなかった)
  if scenario の状態 == 'open':
    SL/TP/時間決済 の通常判定
```

**重要**: `triggerConditions` の評価に使える特徴量は、**BT時点で計算可能なもの** に限る。将来情報の漏洩を避ける。

### 3.5 実装タスク

| # | タスク | 所在 |
|---|---|---|
| 3-1 | StrategyDSL 型定義拡張(`ParameterRange`, `WaitForTriggerEntry`) | `src/side-b/strategy_dsl/types.ts` |
| 3-2 | `DSLBacktestAdapter` パラメータスイープ対応(既存実装があれば拡張) | `src/side-b/strategy_dsl/DSLBacktestAdapter.ts` |
| 3-3 | `DSLBacktestAdapter` wait_for_trigger 処理追加 | 同上 |
| 3-4 | 組み合わせ上限チェック(500超過でエラー) | 同上 |
| 3-5 | 単体テスト: ParameterRange を含む DSL が正しくスイープされること | 新規テスト |
| 3-6 | 単体テスト: wait_for_trigger が maxWaitBars を超えたら expired になること | 新規テスト |
| 3-7 | 単体テスト: triggerConditions に未来情報を使った場合はバリデーションエラー(可能なら) | 新規テスト |

---

## 4. ValidationTool ラッパー実装

### 4.1 設計

Phase 4c の既存3ツールは `backtestRunId` 前提のため、戦略BT用に**入力型を union 化** する:

```typescript
// src/side-b/validation/tools/types.ts

export type ValidationToolInput =
    | HypothesisValidationInput   // 既存(Phase 4c)
    | StrategyValidationInput;    // 新規(Phase 6.7b)

export interface HypothesisValidationInput {
    kind: 'hypothesis';
    hypothesis: EdgeHypothesis;
    tradeNoteId: string;
    period: { start: string; end: string };
    backtestRunId: string;
    additionalParams?: Record<string, unknown>;
}

export interface StrategyValidationInput {
    kind: 'strategy';
    strategy: StrategyDSL;
    dslResult: DSLBacktestResult;  // DSLBacktestAdapter の出力
    period: { start: string; end: string };
    additionalParams?: Record<string, unknown>;
}
```

各ツールは `input.kind` で分岐:

```typescript
// 例: MonteCarloTool
async execute(input: ValidationToolInput): Promise<ValidationToolResult> {
    if (input.kind === 'hypothesis') {
        return this.executeHypothesis(input);  // 既存ロジック
    } else {
        return this.executeStrategy(input);    // 新規ロジック
    }
}
```

### 4.2 MonteCarloTool の戦略版ロジック

既存は `backtestService.getResult(runId).pnls` からPnL列を取得。戦略版は `dslResult.pnls` から取得:

```typescript
async executeStrategy(input: StrategyValidationInput) {
    const pnls = input.dslResult.pnls;  // DSLBacktestAdapter が出すPnL列
    // 以降、既存の TS リサンプル処理を流用
    const metrics = runMonteCarloSimulation(pnls, { simulationCount: 3000 });
    return { toolName: 'monte_carlo', success: true, passed: ..., metrics, ... };
}
```

### 4.3 WalkForwardTool の戦略版ロジック

既存は `backtestService.getResult(runId).events` から events[] を取り Python に渡す。戦略版は `dslResult.events` を同じ形式で渡せれば OK(DSL結果から events に変換する薄いアダプタが必要かも、調査で確認)。

**ただし戦略版では「真のWalk-Forward(各windowでパラメータ再学習)」も視野に入る**。これは既存 `walk_forward.py` の責務外のため、Phase 6.7b では **固定パラメータでの時間的安定性テスト**のみ実装し、パラメータ再学習WFは将来フェーズとする。

### 4.4 BuyAndHoldTool の戦略版ロジック

既存は `OHLCVRepository` から価格を取って B&H リターンを計算、`backtestService.getResult(runId)` から戦略リターンを取る。戦略版は `dslResult.finalReturn` から戦略リターンを取るだけで良い:

```typescript
async executeStrategy(input: StrategyValidationInput) {
    const bhReturn = await this.calculateBuyAndHold(input.period, input.strategy.symbol);
    const strategyReturn = input.dslResult.finalReturn;
    const outperformance = strategyReturn - bhReturn;
    return { ..., metrics: { buyAndHoldReturn: bhReturn, strategyReturn, outperformance }, passed: outperformance > 0 };
}
```

### 4.5 実装タスク

| # | タスク | 所在 |
|---|---|---|
| 4-1 | `ValidationToolInput` を union 化 | `src/side-b/validation/tools/types.ts` |
| 4-2 | `DSLBacktestResult` 型を `DSLBacktestAdapter` から export | `src/side-b/strategy_dsl/DSLBacktestAdapter.ts` |
| 4-3 | `MonteCarloTool.executeStrategy` 実装 | `src/side-b/validation/tools/MonteCarloTool.ts` |
| 4-4 | `WalkForwardTool.executeStrategy` 実装 | `src/side-b/validation/tools/WalkForwardTool.ts` |
| 4-5 | `BuyAndHoldTool.executeStrategy` 実装 | `src/side-b/validation/tools/BuyAndHoldTool.ts` |
| 4-6 | 既存 hypothesis 経路の回帰テスト(壊れていないこと) | 既存テスト |
| 4-7 | 新規 strategy 経路の単体テスト(3ツールそれぞれ) | 新規テスト |

---

## 5. StrategyBacktesterAgent(オーケストレーター新設)

### 5.1 役割

Strategy Thinker が出した `scenarios[]` を受け取り、各 scenario を StrategyDSL に変換 → DSLBacktestAdapter → ValidationTools を経由 → 結果を集約して返す。

### 5.2 処理フロー

```
入力: Strategy Thinker の出力(scenarios[], marketAnalysis, overallConfidence 等)
     + OHLCV(過去1年分を想定、期間は設定可能)

処理:
  for each scenario in scenarios:
    1. scenario → StrategyDSL に変換
    2. DSLBacktestAdapter.backtest(dsl, ohlcv, period)
       → DSLBacktestResult(pnls, events, finalReturn, optimizedParams)
    3. Promise.allSettled で 3 ツール並列実行:
       - MonteCarloTool.executeStrategy({ strategy: dsl, dslResult })
       - WalkForwardTool.executeStrategy(同上)
       - BuyAndHoldTool.executeStrategy(同上)
    4. 4 ツール結果を ValidationToolResult[] として集約
    5. StrategistAgent に解釈させる(既存経路を流用)

出力:
  {
    scenarioResults: Array<{
      scenario,
      dslResult,
      toolResults: ValidationToolResult[],
      strategistInterpretation: string,
      passed: boolean  // 全ツール通過で true
    }>,
    overallPassed: boolean
  }
```

### 5.3 scenario → StrategyDSL 変換

Strategy Thinker の scenarios は人間可読に近い形式(entry.price, stopLoss.pips 等)。これを厳密な StrategyDSL に変換するマッパーが必要。

既存の `dslEdgeMapper.ts` が Phase 5B 用に残置されているが活用停止中 → **Phase 6.7b で活用再開、必要なら拡張**。

### 5.4 期間設定

Nekoさんの BT 標準フロー: **1年間のBT**。以下を既定値に:

```typescript
const DEFAULT_BT_PERIOD_DAYS = 365;
const DEFAULT_BT_END_DATE = new Date();  // 現在時刻
const DEFAULT_BT_START_DATE = subDays(DEFAULT_BT_END_DATE, DEFAULT_BT_PERIOD_DAYS);
```

将来は設定で上書き可能に(例: Discovery の週次分析は 3ヶ月のみ、等)。

### 5.5 実装タスク

| # | タスク | 所在 |
|---|---|---|
| 5-1 | `StrategyBacktesterAgent` 新設 | `src/side-b/agents/StrategyBacktesterAgent.ts`(新規) |
| 5-2 | `scenarioToStrategyDSL` マッパー(`dslEdgeMapper.ts` 拡張 or 新設) | `src/side-b/strategy_dsl/` |
| 5-3 | `aiOrchestrator.ts` に StrategyBacktesterAgent 呼び出しを組み込み | `src/side-b/orchestrator/aiOrchestrator.ts` |
| 5-4 | StrategistAgent(解釈者)が `StrategyBacktesterAgent` の出力も解釈できるよう入力型を拡張 | `src/side-b/agents/StrategistAgent.ts` |
| 5-5 | 統合テスト: Strategy Thinker 出力 → BT → 結果解釈 まで end-to-end | 新規テスト |

---

## 6. Orchestrator 統合

### 6.1 既存フロー(Phase 6 まで)

```
aiOrchestrator:
  1. Market Analyst / Lens / Specialist 分析
  2. HG → 仮説候補
  3. Strategy Thinker → scenarios
  4. for each scenario: DevilsAdvocate.critique
  5. 最終判断
```

### 6.2 新フロー(Phase 6.7b 後)

```
aiOrchestrator:
  1. Market Analyst / Lens / Specialist 分析
  2. HG → 仮説候補
  3. Strategy Thinker → scenarios
  4. StrategyBacktesterAgent.run(scenarios) → BT結果  ← 新規
  5. Strategist.interpret(BT結果) → 解釈 + actionableInsights  ← 既存、入力拡張
  6. for each scenario: DevilsAdvocate.critique(scenario, BT結果)  ← 入力にBT結果追加(Phase 6.7c で検討)
  7. 最終判断
```

### 6.3 失敗時の扱い

- `DSLBacktestAdapter` がエラー → そのシナリオは `passed: false, error` で記録、他シナリオは続行
- 3ツール中1つだけエラー → 他2ツールの結果で passed 判定(ツール全落ちなら passed: false)
- OHLCV データ不足 → シナリオを `skipped` として記録、ログ出力

### 6.4 実装タスク

| # | タスク | 所在 |
|---|---|---|
| 6-1 | `aiOrchestrator` に StrategyBacktesterAgent 呼び出しを追加 | `src/side-b/orchestrator/aiOrchestrator.ts` |
| 6-2 | エラーハンドリング(シナリオ単位で失敗を隔離) | 同上 |
| 6-3 | ログ出力強化(BT所要時間、最適化パラメータ、パス率) | 同上 |
| 6-4 | 運用モニタリング: Prisma に `StrategyBacktestResult` テーブル追加(将来の分析用) | `prisma/schema.prisma` |

---

## 7. スコープ外(明示)

以下は Phase 6.7b では**やらない**:

- **Python vectorbt 導入**(Nekoさん承認済み: Python 新規なし)
- **経済指標カレンダー・スプレッド情報**の導入
- **真のWalk-Forward(各windowでパラメータ再学習)**
- **Side-A `BacktestService` との統合**(独立経路維持)
- **MonteCarlo 2系統の統合**(Side-A services 版はそのまま)
- **複数銘柄・複数時間足の同時BT**(単一銘柄・時間足のみ、将来Phase)

---

## 8. Phase 6.7b の完了判定

- [ ] StrategyDSL 拡張(parameters range / wait_for_trigger)が実装済み、単体テスト通過
- [ ] DSLBacktestAdapter がパラメータスイープと wait_for_trigger を処理できる
- [ ] 3 ValidationTools が戦略入力(kind='strategy')を受け付ける
- [ ] StrategyBacktesterAgent が動作、aiOrchestrator から呼ばれている
- [ ] end-to-end 統合テスト(Strategy Thinker 出力 → BT → Strategist 解釈)が通る
- [ ] 既存の仮説評価パイプライン(hypothesis 経路)が壊れていない(回帰テスト通過)
- [ ] 本番デプロイ後、最低1日の稼働で BT 結果がちゃんと返ること

---

## 9. 人間承認ゲート

| # | 承認ポイント | タイミング |
|---|---|---|
| B1 | StrategyDSL 拡張の最終仕様(ParameterRange / WaitForTriggerEntry の型定義) | 調査後、実装前 |
| B2 | wait_for_trigger のBT評価ロジック(将来情報漏洩チェックの具体) | 実装前 |
| B3 | BT 期間のデフォルト値(1年で OK か) | 実装前 |
| B4 | パラメータ組み合わせ上限(500で OK か) | 実装前 |
| B5 | scenario → StrategyDSL マッパーの変換仕様 | 実装中 |

---

## 10. 推定作業量

- 調査タスク: 0.5 日
- StrategyDSL 拡張 + DSLBacktestAdapter 対応: 2 日
- ValidationTool ラッパー: 1.5 日
- StrategyBacktesterAgent + Orchestrator 統合: 1.5 日
- 統合テスト + デバッグ: 1 日

**合計: 約 6.5 日**(Claude Code 主体、Nekoさんレビュー+承認を挟む)
