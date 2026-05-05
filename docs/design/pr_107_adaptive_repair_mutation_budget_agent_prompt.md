# 実装指示: PR #107 Adaptive Repair / Mutation Budget v1

## 位置づけ

この文書は **PR #107 専用の実装指示** である。

現在の正式ロードマップは以下である。

```text
#100 FailureReason → RepairHint        完了
#101 Promotion Gate / CandidateStage   完了
#102 RepairHint Outcome Telemetry      完了
#103 OOS / Walk-forward                完了
#104 別作業                            完了
#105 OOS-aware PromotionGate           完了
#106 Multi-generation Evolution Run    完了
#107 Adaptive Repair / Mutation Budget 本PR
#108 Quality-Diversity Archive Lite    次
```

PR #106 までで、複数世代を sequential に回し、世代ごとの `GenerationReport` と `multiGenerationTrendSummary` を観測できるようになった。

PR #107 では、PR #102 / #106 で観測できるようになった RepairHint outcome と multi-generation trend を使い、**次世代の repair / mutation 配分を控えめに調整する**。

---

## PR #107 の目的

PR #107 の目的は、観測結果を使って、次世代の探索配分を少しだけ適応させることである。

```text
Generation N
  ↓
repairOutcomeSummary
promotionGateSummary
oosAwarePromotionSummary
multiGenerationTrendSummary
  ↓
AdaptiveRepairBudgetPolicy
  ↓
Generation N+1 の mutation / repair 配分へ反映
```

ただし、このPRでは **強い自動最適化は行わない**。

```text
やる:
  - 効いた RepairHint 系統を少し優遇する
  - 効かない RepairHint 系統を少し弱める
  - repair / exploration / novelty の比率を bounded に調整する
  - 連続停滞を検出して軽い探索増加を行う
  - summary と trace を出す

やらない:
  - production_candidate 自動昇格
  - parent pool 比率の大幅変更
  - Quality-Diversity Archive
  - 新しい評価エンジン実装
  - Walk Forward / Monte Carlo / Backtest の再実装
  - LLMによるbudget判断
```

---

## 基本方針

### 1. v1 は conservative にする

1世代だけの改善・悪化で大きく配分を変えない。

```text
単発改善:
  小さく優遇

連続改善:
  もう少し優遇

単発悪化:
  小さく抑制

連続悪化:
  抑制。ただしゼロにはしない
```

探索の多様性を維持するため、どの route も簡単に 0 にしない。

### 2. 使う入力は既存summaryに限定する

PR #107 では、新しい評価指標を作らない。

利用する入力は以下を基本とする。

- `repairOutcomeSummary`
- `repairOutcomes`
- `repairHintSummary`
- `promotionGateSummary`
- `oosValidationSummary`
- `oosAwarePromotionSummary`
- `multiGenerationTrendSummary`
- `GenerationReport[]`

### 3. analysis-engine を評価正本のまま維持する

Backtest / Walk Forward / Monte Carlo / metrics計算は analysis-engine / Python 側を正本とする。

Evolution layer では再計算しない。

### 4. Quality-Diversity はまだ実装しない

PR #108 が `Quality-Diversity Archive Lite` である。

PR #107 では、多様性維持は最低限の floor / cap だけに留める。

```text
PR #107:
  budgetの安全な微調整

PR #108:
  類似戦略の重複抑制 / archive / diversity score
```

### 5. production には絶対に進めない

Adaptive により improved / validation_confirmed が増えても、本PRでは production には進めない。

```text
adaptive success != production ready
validation_confirmed != production_candidate
```

---

## このPRでやること

### 実装する

- `AdaptiveRepairBudgetPolicy v1`
- `MutationBudgetAllocation` 型
- `AdaptiveRepairBudgetDecision` 型
- RepairHint outcome から repair target / action target ごとの効果集計
- 改善した repair target の軽い優遇
- 悪化した repair target の軽い抑制
- stagnation 時の探索比率増加
- budget clamp / floor / cap
- multi-generation runner への optional 接続
- `adaptiveRepairBudgetSummary` の出力
- smoke 出力
- 単体テスト / 統合テスト

### 実装しない

- DB migration
- EdgeStatus enum 変更
- StatusManager 変更
- production_candidate 自動昇格
- parent pool 比率の大幅変更
- Quality-Diversity Archive
- Walk Forward / Monte Carlo / Backtest 再実装
- 新しいバックテストライブラリ導入
- UI / dashboard
- LLM判断によるbudget調整
- 並列世代実行

---

## 推奨ファイル構成

既存構成に合わせること。

候補:

```text
src/side-b/evolution/adaptiveRepairBudgetPolicy.ts
src/side-b/tests/evolution/adaptiveRepairBudgetPolicy.test.ts
```

必要に応じて summary を分けてもよい。

```text
src/side-b/evolution/adaptiveRepairBudgetSummary.ts
src/side-b/tests/evolution/adaptiveRepairBudgetSummary.test.ts
```

Multi-generation runner との接続は最小差分で行う。

```text
src/side-b/evolution/multiGenerationRunner.ts
scripts/evolution-pdca-smoke.ts
```

`EvolutionLoop.ts` に adaptive 判定ロジック本体を大量に書かない。

---

## 型定義

### MutationRoute

既存の route 型がある場合はそれを使う。

新規定義が必要な場合は、以下のように最小限にする。

```ts
// mutation / generation の配分対象
export type MutationRoute =
  | 'repair_guided_mutation'
  | 'standard_mutation'
  | 'crossover'
  | 'novelty_seed'
  | 'indicator_augmentation'
  | 'random_exploration';
```

実コードに既存 route 名がある場合、既存名に合わせること。

### AdaptiveRepairSignal

```ts
// RepairHint / RepairOutcome から抽出した効果シグナル
export type AdaptiveRepairSignal = {
  actionTarget: string;
  failureReason?: string | null;
  attempted: number;
  improved: number;
  worsened: number;
  unchanged: number;
  unknown: number;
  improvementRate: number | null;
  worseningRate: number | null;
};
```

### MutationBudgetAllocation

```ts
// 次世代に渡す mutation / repair 配分
export type MutationBudgetAllocation = {
  totalBudget: number;
  byRoute: Record<MutationRoute, number>;
  repairTargetWeights: Record<string, number>;
  explorationFloor: number;
  noveltyFloor: number;
  repairMaxShare: number;
  warnings: string[];
};
```

### AdaptiveRepairBudgetDecisionReason

```ts
// adaptive budget の判断理由
export type AdaptiveRepairBudgetDecisionReason =
  | 'repair_outcome_improved'
  | 'repair_outcome_worsened'
  | 'repair_outcome_unknown'
  | 'stagnation_detected'
  | 'oos_validation_confirmed'
  | 'oos_failed_or_held'
  | 'insufficient_signal'
  | 'bounded_by_floor'
  | 'bounded_by_cap'
  | 'no_adaptive_change'
  | 'unknown';
```

### AdaptiveRepairBudgetDecision

```ts
// 世代ごとの adaptive budget 判定
export type AdaptiveRepairBudgetDecision = {
  generationIndex: number;
  previousGenerationIndex: number | null;
  enabled: boolean;
  baselineAllocation: MutationBudgetAllocation;
  nextAllocation: MutationBudgetAllocation;
  repairSignals: AdaptiveRepairSignal[];
  reasons: AdaptiveRepairBudgetDecisionReason[];
  warnings: string[];
};
```

### AdaptiveRepairBudgetSummary

```ts
// GenerationReport / MultiGenerationRunReport / smoke に出す summary
export type AdaptiveRepairBudgetSummary = {
  enabled: boolean;
  decisions: number;
  latestAllocation: MutationBudgetAllocation | null;
  byReason: Record<AdaptiveRepairBudgetDecisionReason, number>;
  boostedRepairTargets: string[];
  suppressedRepairTargets: string[];
  explorationIncreased: boolean;
  repairShare: number;
  noveltyShare: number;
  productionEligibleChanged: false;
  warnings: string[];
};
```

---

## デフォルトbudget

v1では、まず保守的な default を置く。

実コードの既存候補生成数 / topK / mutation count に合わせて調整すること。

```ts
export const defaultMutationBudgetAllocationV1: MutationBudgetAllocation = {
  totalBudget: 100,
  byRoute: {
    repair_guided_mutation: 20,
    standard_mutation: 35,
    crossover: 20,
    novelty_seed: 15,
    indicator_augmentation: 5,
    random_exploration: 5,
  },
  repairTargetWeights: {},
  explorationFloor: 10,
  noveltyFloor: 10,
  repairMaxShare: 40,
  warnings: [],
};
```

### 注意

既存コードに実際の mutation count / topK / route quota がある場合は、`100` を実数として使わず、割合として扱う。

```text
100 = percentage budget
```

候補数への変換は、既存 generation logic 側に合わせる。

---

## Adaptive 判定ルール

### repair target の優遇

条件:

```text
attempted >= 2
improvementRate >= 0.5
worseningRate <= 0.25
```

結果:

```text
repairTargetWeights[actionTarget] += 0.1〜0.2
reason = repair_outcome_improved
```

v1では最大でも `+0.2` 程度に留める。

### repair target の抑制

条件:

```text
attempted >= 2
worseningRate >= 0.5
improvementRate <= 0.25
```

結果:

```text
repairTargetWeights[actionTarget] -= 0.1〜0.2
reason = repair_outcome_worsened
```

ただし、weight を 0 未満にしない。

### unknown が多い場合

条件:

```text
unknown / attempted >= 0.7
```

結果:

```text
大きな変更をしない
reason = repair_outcome_unknown または insufficient_signal
```

unknown を失敗扱いしない。

### stagnation 検出

以下のような状態が複数世代続く場合、探索比率を少し増やす。

```text
repairOutcomeImprovedByGeneration が連続 0
validationConfirmedByGeneration が連続 0
oosPassedByGeneration が連続 0
```

結果:

```text
novelty_seed / random_exploration を小さく増やす
repair_guided_mutation を小さく下げる
reason = stagnation_detected
```

ただし、探索増加は最大でも +10% 程度に留める。

### OOS confirmed が増えている場合

条件:

```text
validationConfirmedByGeneration が前世代より増加
または oosPassedByGeneration が増加
```

結果:

```text
大きな変更はしない
現在の配分を維持、または repair_guided_mutation を小さく優遇
reason = oos_validation_confirmed
```

OOS confirmed を理由に production へ進めない。

---

## budget clamp / floor / cap

v1では必ず以下を守る。

```text
repair_guided_mutation <= repairMaxShare
novelty_seed >= noveltyFloor
random_exploration + novelty_seed >= explorationFloor
standard_mutation >= 20% 相当
どの route も原則 0 にしない
合計は totalBudget に正規化する
```

### 禁止

```text
repair_guided_mutation = 100%
novelty_seed = 0%
random_exploration = 0%
standard_mutation = 0%
```

一見うまくいった repair に全振りしない。  
それは進化ではなく、過去の成功体験にすがるだけである。

---

## Multi-generation runner への接続

PR #106 の `runMultiGenerationEvolutionV1` に optional で adaptive を接続する。

候補:

```ts
export type MultiGenerationRunOptions = {
  generations: number;
  adaptiveRepairBudget?: boolean;
  initialMutationBudgetAllocation?: MutationBudgetAllocation;
  // 既存 option...
};
```

世代ごとに以下を行う。

```text
Generation N 完了
  ↓
GenerationReport を取得
  ↓
AdaptiveRepairBudgetDecision を計算
  ↓
Generation N+1 の runOneGeneration に nextAllocation を渡す
```

`runOneGeneration` の signature に大きな変更が必要な場合は、optional input として追加する。

```ts
runOneGeneration({
  generationIndex,
  repairHintsForMutation,
  previousPromotionGateDecisions,
  previousOosValidationResults,
  mutationBudgetAllocation,
})
```

既存呼び出しを壊さない。

---

## EvolutionLoop / mutation 側への接続

既存 mutation / candidate generation が budget を受け取れる場合のみ反映する。

もし現時点で mutation route quota を受け取る設計がない場合は、PR #107 v1 では以下のどちらかにする。

### 推奨

```text
1. MutationBudgetAllocation を受け取る optional input を追加
2. 既存 mutation count / route selection に最小限反映
3. 反映できない route は warning に出す
```

### 代替

```text
1. AdaptiveRepairBudgetDecision / Summary だけ作る
2. 実配分反映は後続PRへ回す
3. smoke で enabled=false または applied=false を明示する
```

ただし、PR #107 の主目的は「観測から制御への第一歩」であるため、可能な範囲で実配分に反映すること。

---

## GenerationReport / MultiGenerationRunReport への統合

単世代 `GenerationReport` に以下を optional で追加してよい。

```ts
adaptiveRepairBudgetDecision?: AdaptiveRepairBudgetDecision;
adaptiveRepairBudgetSummary?: AdaptiveRepairBudgetSummary;
```

Multi-generation report には以下を追加する。

```ts
adaptiveRepairBudgetSummary?: AdaptiveRepairBudgetSummary;
adaptiveRepairBudgetDecisions?: AdaptiveRepairBudgetDecision[];
```

型肥大化が大きい場合、まずは Multi-generation report 側のみでもよい。

ただし、smoke で `adaptiveRepairBudgetSummary` を観測できるようにする。

---

## smoke script 対応

`scripts/evolution-pdca-smoke.ts` に adaptive option を追加する。

### 例

```bash
# 実行場所: リポジトリルート
set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3 --generations 2 --adaptive-repair-budget
```

### 仕様

- `--adaptive-repair-budget` 未指定なら従来通り adaptive disabled
- 指定時のみ adaptive policy を使う
- 単世代では adaptive summary は出してもよいが、基本は multi-generation で意味を持つ
- adaptive disabled 時も既存 smoke は壊れない

### smoke 出力

```text
--- adaptiveRepairBudgetSummary ---
{
  "enabled": true,
  "decisions": 1,
  "latestAllocation": {
    "totalBudget": 100,
    "byRoute": {
      "repair_guided_mutation": 22,
      "standard_mutation": 33,
      "crossover": 20,
      "novelty_seed": 15,
      "indicator_augmentation": 5,
      "random_exploration": 5
    },
    "repairTargetWeights": {
      "raise_trade_count": 1.1
    },
    "explorationFloor": 10,
    "noveltyFloor": 10,
    "repairMaxShare": 40,
    "warnings": []
  },
  "byReason": {
    "repair_outcome_improved": 1
  },
  "boostedRepairTargets": ["raise_trade_count"],
  "suppressedRepairTargets": [],
  "explorationIncreased": false,
  "repairShare": 22,
  "noveltyShare": 15,
  "productionEligibleChanged": false,
  "warnings": []
}
```

既存 summary も消さない。

```text
parentPoolSummary
formalBtCandidateSummary
repairHintSummary
promotionGateSummary
repairOutcomeSummary
oosValidationSummary
oosAwarePromotionSummary
multiGenerationTrendSummary
adaptiveRepairBudgetSummary
```

---

## テスト要件

### adaptiveRepairBudgetPolicy.test.ts

以下を追加する。

1. improved rate が高い repair target は weight が上がる
2. worsened rate が高い repair target は weight が下がる
3. attempted が少ない target は大きく変更しない
4. unknown が多い target は失敗扱いしない
5. repair_guided_mutation が repairMaxShare を超えない
6. novelty_seed が noveltyFloor を下回らない
7. explorationFloor が守られる
8. standard_mutation が 0 にならない
9. 合計 budget が totalBudget に正規化される
10. stagnation 時に novelty / exploration が小さく増える
11. OOS confirmed 増加時に productionEligible は変わらない
12. productionEligibleChanged は常に false
13. adaptive disabled 時は baseline allocation を維持する
14. warnings が必要な場合に出る
15. LLM入力なしで deterministic に同じ decision が返る

### multiGenerationRunner.test.ts 追加

以下を追加する。

1. `adaptiveRepairBudget=true` のとき、Generation N の report から decision が作られる
2. Generation N+1 に `mutationBudgetAllocation` が渡される
3. `adaptiveRepairBudget=false` のとき、既存挙動が変わらない
4. adaptive decision が trendSummary を壊さない
5. adaptive decision が productionEligibleByGeneration を変更しない
6. adaptive disabled でも `repairHintsForMutation` の carry が壊れない
7. route 反映できない場合 warning が残る

### smoke / integration test

必要なら最小限追加する。

1. `--generations 2 --adaptive-repair-budget` で adaptive mode になる
2. adaptive mode でも `formalBtCandidateSummary` が消えない
3. adaptive mode でも `multiGenerationTrendSummary` が消えない
4. `adaptiveRepairBudgetSummary` が smoke に出る
5. productionEligible が 0 のまま

---

## 既存機能の保護

PR #107 では、以下を壊さない。

```text
src/side-b/evolution/surrogateRescuePolicy.ts
selectFormalBtCandidatesWithRescue
formalBtCandidateSummary
parentPoolSummary
repairHintSummary
repairOutcomeSummary
promotionGateSummary
oosValidationSummary
oosAwarePromotionSummary
multiGenerationTrendSummary
analysisEngineRobustnessAdapter
oosValidationResultMapper
oosValidationSummary
```

特に `formalBtCandidateSummary` は、全件正式BTを避けるための軽量選抜層の観測点である。

adaptive budget 化のついでに消さない。

---

## 実装制約

- `any` を使わない
- DB migration を追加しない
- EdgeStatus enum を変更しない
- StatusManager を変更しない
- production_candidate へ自動昇格しない
- productionEligible を true にしない
- Quality-Diversity Archive を実装しない
- parent pool 比率を大幅変更しない
- Walk Forward / Monte Carlo / Backtest を Evolution 側で再実装しない
- analysis-engine metrics を Evolution 側で再計算しない
- LLMにbudget判断を任せない
- 並列世代実行しない
- UI / dashboard を作らない

---

## 禁止事項

- repairOutcome improved を理由に production_ready にする
- validation_confirmed を production_candidate と同義にする
- OOS failed を自動 rejected にする
- 1世代の improved だけで repair に全振りする
- 1世代の worsened だけで route を 0 にする
- novelty / exploration を 0 にする
- standard_mutation を 0 にする
- adaptive policy 内に PromotionGate 判定を再実装する
- adaptive policy 内に OOS 判定を再実装する
- adaptive policy 内に BT logic を書く
- Quality-Diversity をこのPRで始める

---

## 完了条件

以下を満たしたら PR #107 完了。

- AdaptiveRepairBudgetPolicy v1 が追加されている
- RepairOutcome から repair target ごとの signal を作れる
- improved target を bounded に優遇できる
- worsened target を bounded に抑制できる
- unknown / insufficient signal では大きく変更しない
- stagnation 時に exploration / novelty を軽く増やせる
- budget floor / cap / normalization が守られる
- Multi-generation runner に optional 接続されている
- `--adaptive-repair-budget` smoke が使える
- `adaptiveRepairBudgetSummary` が出る
- 既存 `multiGenerationTrendSummary` が壊れない
- `formalBtCandidateSummary` が消えない
- production 自動昇格なし
- DB migration なし
- EdgeStatus 変更なし
- 対象テストが通る

---

## 実行確認コマンド

```bash
# 実行場所: リポジトリルート
npx tsc --noEmit -p tsconfig.json
```

```bash
# 実行場所: リポジトリルート
npx jest src/side-b/tests/evolution/ src/side-b/tests/strategy_dsl/ src/side-b/tests/agents/ --silent
```

```bash
# 実行場所: リポジトリルート
set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3
```

```bash
# 実行場所: リポジトリルート
set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3 --generations 2
```

```bash
# 実行場所: リポジトリルート
set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3 --generations 2 --adaptive-repair-budget
```

---

## PR本文に記載すること

```md
## Summary
- Adaptive Repair / Mutation Budget v1 を追加
- RepairOutcome から repair target ごとの効果シグナルを集計可能にした
- improved / worsened / unknown に応じて mutation budget を bounded に調整可能にした
- Multi-generation runner に optional adaptive budget を接続した
- --adaptive-repair-budget smoke を追加した

## Roadmap Note
- 本PR #107 は Adaptive Repair / Mutation Budget v1
- Quality-Diversity Archive Lite は PR #108 へ繰り下げ
- production_ready 昇格は本PRでは行わない

## Scope
- DB migration なし
- EdgeStatus enum 変更なし
- StatusManager 変更なし
- production_candidate 自動昇格なし
- Quality-Diversity Archive なし
- parent pool 比率の大幅変更なし
- Walk Forward / Monte Carlo / Backtest 再実装なし
- UI / dashboard なし

## Verification
- npx tsc --noEmit -p tsconfig.json
- npx jest src/side-b/tests/evolution/ src/side-b/tests/strategy_dsl/ src/side-b/tests/agents/ --silent
- set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3
- set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3 --generations 2
- set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3 --generations 2 --adaptive-repair-budget

## Smoke Observations
### Single Generation
- parentPoolSummary:
- formalBtCandidateSummary:
- repairHintSummary:
- promotionGateSummary:
- repairOutcomeSummary:
- oosValidationSummary:
- oosAwarePromotionSummary:

### Multi Generation
- multiGenerationTrendSummary:

### Adaptive Repair Budget
- adaptiveRepairBudgetSummary:
```

---

## 最重要判断基準

PR #107 の目的は、進化ループを急に賢くすることではない。

目的は、RepairHint / RepairOutcome / OOS-aware summary / multi-generation trend を使い、次世代の mutation / repair 配分を **控えめ・安全・可観測** に調整できるようにすることである。

```text
#106:
  複数世代で観測した

#107:
  観測結果を使って小さく配分調整する

#108:
  類似戦略の量産を防ぐ Quality-Diversity Archive を作る
```

PR #107 で #108 の仕事を始めない。

実装判断に迷った場合は、以下を優先する。

1. conservative に調整する
2. floor / cap を必ず守る
3. unknown を失敗扱いしない
4. どの route も簡単に 0 にしない
5. production へ進めない
6. analysis-engine を評価正本のままにする
7. multi-generation trend を壊さない
8. Rescue Lane / formalBtCandidateSummary を壊さない
9. Quality-Diversity は #108 へ残す

---

## エージェントへの最終指示

まず現在の `multiGenerationRunner.ts`、`GenerationReport`、`repairOutcomeSummary`、`repairOutcomes`、`repairHintSummary`、`promotionGateSummary`、`oosAwarePromotionSummary`、`multiGenerationTrendSummary`、`scripts/evolution-pdca-smoke.ts` を確認すること。

その上で、最小差分で Adaptive Repair / Mutation Budget v1 を実装すること。

このPRで目指すのは、自律進化の完成ではない。  
複数世代で観測した RepairOutcome と OOS-aware trend を使い、次世代の探索配分を小さく安全に変えられる状態にすることである。

実装後は、型チェック、対象テスト、単世代smoke、multi-generation smoke、adaptive smoke を実行し、PR本文に `adaptiveRepairBudgetSummary` の実測ログを貼ること。

