# 実装指示: PR #106 Multi-generation Evolution Run v1

## 位置づけ

この文書は **PR #106 専用の実装指示** である。

現在の正式ロードマップは以下である。

```text
#100 FailureReason → RepairHint        完了
#101 Promotion Gate / CandidateStage   完了
#102 RepairHint Outcome Telemetry      完了
#103 OOS / Walk-forward                完了
#104 別作業                            完了
#105 OOS-aware PromotionGate           完了
#106 Multi-generation Evolution Run    本PR
#107 Adaptive Repair / Mutation Budget 次
#108 Quality-Diversity Archive Lite    次々
```

PR #105 までで、単世代の進化ループには以下が入っている。

- parent pool
- surrogate rescue lane
- formal BT candidate selection
- FailureReason → RepairHint
- RepairHint Outcome Telemetry
- PromotionGate / EvolutionCandidateStage
- OOS / Walk-forward summary
- OOS-aware PromotionGate
- analysis-engine を評価正本とする責務分離
- Surrogate Rescue Lane 保護

PR #106 では、これらの単世代機能を **複数世代で安全に連続実行** できるようにする。

---

## PR #106 の目的

PR #106 の目的は、複数世代を連続実行し、世代間で以下が正しく引き継がれるかを観測できるようにすることである。

```text
Generation N
  ↓
GenerationReport
  ↓
RepairHint / RepairOutcome / PromotionGate / OOS-aware summary
  ↓
Generation N+1 の入力
  ↓
次世代の parent pool / mutation / repair に反映
```

このPRの目的は、進化方針を自動最適化することではない。

```text
やる:
  複数世代を安全に回す
  世代間summaryを集計する
  regression / stagnation / explosion を観測する

やらない:
  mutation budget を自動調整する
  repair target の重みを自動変更する
  parent pool 比率を自動変更する
  production_candidate へ自動昇格する
```

---

## このPRでやること

### 実装する

- Multi-generation runner v1
- `runOneGeneration` を複数回 sequential に呼ぶ orchestration
- 世代ごとの `GenerationReport` の収集
- 世代間の `lastRepairHints` / repair baseline / promotion / OOS summary の引き継ぎ
- Multi-generation summary の生成
- stop condition / safety guard の最小実装
- smoke script の `--generations` 対応
- 単体テスト / 統合テスト
- 既存 parentPool / surrogateRescue / formalBt / repairHint / repairOutcome / promotionGate / OOS-aware 経路の互換性維持

### 実装しない

- Adaptive Repair / Mutation Budget
- Quality-Diversity Archive
- parent pool 比率の自動変更
- mutation strategy の自動変更
- production_candidate 自動昇格
- production_ready 永続化
- DB migration
- EdgeStatus enum 変更
- StatusManager 変更
- Walk Forward / Monte Carlo / Backtest の再実装
- 新しいバックテストライブラリ導入
- UI / dashboard
- 並列世代実行

---

## 基本方針

### 1. まずは sequential 実行

PR #106 では、世代は必ず逐次実行する。

```text
Generation 1 完了
  ↓
Generation 2 開始
  ↓
Generation 3 開始
```

並列実行はしない。

理由は、repairHint / parent pool / promotion / OOS 結果の引き継ぎ順序を明確に保つためである。

### 2. 単世代ロジックを再実装しない

Multi-generation runner は `EvolutionLoop.runOneGeneration` など既存の単世代実行を呼び出す orchestration に限定する。

```text
MultiGenerationRunner:
  runOneGeneration を順番に呼ぶ
  reports を集計する
  世代間 state を渡す

非責務:
  mutation の中身
  formal BT の中身
  OOS評価の中身
  PromotionGate判定の中身
```

### 3. analysis-engine は評価正本のまま

PR #105 の方針を維持する。

Backtest / Walk Forward / Monte Carlo / robustness metrics は analysis-engine / Python 側の正本を使う。

Evolution layer では再計算しない。

### 4. OOS-aware result は観測・stage用途に留める

`validation_confirmed` は観測上の重要stageだが、このPRでは production candidate へ自動昇格しない。

```text
validation_confirmed != production_candidate
```

### 5. Adaptive制御はしない

PR #106 では、複数世代の結果を見ても、mutation budget や repairHint weight を自動変更しない。

それは PR #107 の責務である。

---

## 推奨ファイル構成

既存構成に合わせること。

候補:

```text
src/side-b/evolution/multiGenerationRunner.ts
src/side-b/tests/evolution/multiGenerationRunner.test.ts
```

必要に応じて summary 型を分けてもよい。

```text
src/side-b/evolution/multiGenerationSummary.ts
src/side-b/tests/evolution/multiGenerationSummary.test.ts
```

既存 smoke script を拡張する。

```text
scripts/evolution-pdca-smoke.ts
```

ただし、`EvolutionLoop.ts` に multi-generation 集計ロジック本体を大量に書かない。

---

## 型定義

### MultiGenerationRunOptions

```ts
// 複数世代実行の設定
export type MultiGenerationRunOptions = {
  generations: number;
  regime?: string;
  topK?: number;
  stopOnGenerationError?: boolean;
  stopOnNoFormalBtCandidates?: boolean;
  stopOnNoParentCandidates?: boolean;
  maxConsecutiveNoImprovement?: number;
  carryRepairHints?: boolean;
  carryPromotionState?: boolean;
  carryOosState?: boolean;
};
```

### MultiGenerationRunState

```ts
// 世代間で引き継ぐ状態
export type MultiGenerationRunState = {
  lastRepairHints: unknown[];
  lastPromotionGateDecisions: unknown[];
  lastOosValidationResults: unknown[];
  lastOosAwarePromotionSummary?: unknown;
  warnings: string[];
};
```

実コードでは `unknown[]` のままにせず、既存型に合わせること。

例:

```ts
// 実装時は既存型を import して使う
// lastRepairHints: RepairHint[];
// lastPromotionGateDecisions: PromotionGateDecision[];
// lastOosValidationResults: OosValidationResult[];
```

### MultiGenerationGenerationEntry

```ts
// 各世代の実行結果
export type MultiGenerationGenerationEntry = {
  generationIndex: number;
  startedAt: string;
  finishedAt: string;
  status: 'completed' | 'failed' | 'skipped';
  report: GenerationReport | null;
  errorMessage?: string;
  warnings: string[];
};
```

### MultiGenerationTrendSummary

```ts
// 世代間の傾向summary
export type MultiGenerationTrendSummary = {
  generationsRequested: number;
  generationsCompleted: number;
  generationsFailed: number;
  stoppedEarly: boolean;
  stopReason: string | null;
  formalBtCandidatesByGeneration: number[];
  formalBtPassedByGeneration: number[];
  repairHintsByGeneration: number[];
  repairOutcomeImprovedByGeneration: number[];
  validationCandidatesByGeneration: number[];
  validationConfirmedByGeneration: number[];
  oosPassedByGeneration: number[];
  oosFailedByGeneration: number[];
  productionEligibleByGeneration: number[];
  warnings: string[];
};
```

### MultiGenerationRunReport

```ts
// 複数世代実行全体のreport
export type MultiGenerationRunReport = {
  startedAt: string;
  finishedAt: string;
  options: MultiGenerationRunOptions;
  generations: MultiGenerationGenerationEntry[];
  trendSummary: MultiGenerationTrendSummary;
  finalState: MultiGenerationRunState;
  warnings: string[];
};
```

---

## MultiGenerationRunner

### runMultiGenerationEvolutionV1

```ts
export async function runMultiGenerationEvolutionV1(input: {
  options: MultiGenerationRunOptions;
  runOneGeneration: (args: {
    generationIndex: number;
    repairHintsForMutation?: RepairHint[];
    previousPromotionGateDecisions?: PromotionGateDecision[];
    previousOosValidationResults?: OosValidationResult[];
  }) => Promise<GenerationReport>;
}): Promise<MultiGenerationRunReport>;
```

実コードの `runOneGeneration` signature に合わせて調整すること。

ただし、MultiGenerationRunner 自体が mutation / BT / OOS / PromotionGate を再実装してはいけない。

---

## 世代間引き継ぎ

### RepairHint

PR #100 / #102 で `lastRepairHints` または `repairHintsForMutation` の経路が入っている。

PR #106 では、これを multi-generation runner から明示的に渡す。

```text
Generation N の repairHintSummary / repairHints
  ↓
Generation N+1 の mutation input
```

注意:

- fatal / repair_excluded は渡さない
- `shouldUseForRepairMutation=false` は渡さない
- `shouldExcludeFromParentPool=true` は親・repair素材から除外

### PromotionGate

PR #101 / #105 の結果を次世代summaryに使う。

```text
Generation N の promotionGateDecisions
  ↓
Generation N+1 の trend観測 / stage分布比較
```

PR #106 では、PromotionGate結果で parent pool 比率を変えない。

### OOS / OOS-aware Promotion

PR #103 / #105 の結果を trend summary に含める。

```text
Generation N の oosValidationSummary
Generation N の oosAwarePromotionSummary
  ↓
trendSummary.validationConfirmedByGeneration
```

PR #106 では、OOS passed を production に上げない。

---

## stop condition / safety guard

PR #106 では最小限の安全停止を入れる。

### generations limit

`generations` は default 2、上限 5 程度にする。

```text
デフォルト: 2
上限: 5
```

上限を超えた場合は warning を出して clamp する。

### generation error

`stopOnGenerationError=true` の場合、世代実行で例外が出たら停止する。

`false` の場合は該当世代を failed として記録し、次世代を続けるかは既存stateの安全性を見て判断する。

v1では `true` default でよい。

### no formal BT candidates

`stopOnNoFormalBtCandidates=true` の場合、ある世代で `formalBtCandidateSummary.totalSelected=0` 相当なら停止する。

ただし、フィールド名は実装に合わせて確認すること。

### no parent candidates

parent pool が空の場合、次世代を続行しても意味が薄い。

`parentPoolSummary.totalSelected=0` 相当なら停止候補にする。

### no improvement

`maxConsecutiveNoImprovement` は v1では optional。

使う場合は、以下のような保守的条件だけにする。

```text
repairOutcome improved = 0
validation_confirmed = 0
oos_passed = 0
```

ただし、これで mutation budget を変えない。

---

## trend summary の作り方

世代ごとの `GenerationReport` から、以下を抜き出す。

### formalBtCandidatesByGeneration

`formalBtCandidateSummary.totalSelected` などから取得。

### formalBtPassedByGeneration

正式BT通過候補数から取得。

### repairHintsByGeneration

`repairHintSummary.total` または同等フィールドから取得。

### repairOutcomeImprovedByGeneration

`repairOutcomeSummary.improved` から取得。

### validationCandidatesByGeneration

`promotionGateSummary.byStage.validation_candidate` から取得。

### validationConfirmedByGeneration

`promotionGateSummary.byStage.validation_confirmed` または `oosAwarePromotionSummary.validationConfirmed` から取得。

### oosPassedByGeneration / oosFailedByGeneration

`oosValidationSummary.byStatus` または `oosAwarePromotionSummary` から取得。

### productionEligibleByGeneration

`promotionGateSummary.productionEligible` / `oosAwarePromotionSummary.productionEligible` から取得。

PR #106 では原則 0 のままを期待する。

---

## GenerationReport への影響

PR #106 では、単世代 `GenerationReport` の意味を変えない。

Multi-generation は別reportとして持つ。

```text
GenerationReport:
  単世代のreport

MultiGenerationRunReport:
  複数世代全体のreport
```

単世代reportの型を無理に肥大化させない。

---

## smoke script 対応

`scripts/evolution-pdca-smoke.ts` に `--generations` を追加する。

### 例

```bash
# 実行場所: リポジトリルート
set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3 --generations 2
```

### 仕様

- `--generations` 未指定なら従来通り単世代
- `--generations 1` なら従来と同等
- `--generations 2以上` なら multi-generation runner を使う
- 上限超過時は clamp + warning

### smoke 出力

multi-generation時は以下を出す。

```text
--- multiGenerationTrendSummary ---
{
  "generationsRequested": 2,
  "generationsCompleted": 2,
  "generationsFailed": 0,
  "stoppedEarly": false,
  "stopReason": null,
  "formalBtCandidatesByGeneration": [3, 3],
  "formalBtPassedByGeneration": [1, 1],
  "repairHintsByGeneration": [2, 1],
  "repairOutcomeImprovedByGeneration": [0, 1],
  "validationCandidatesByGeneration": [1, 1],
  "validationConfirmedByGeneration": [0, 1],
  "oosPassedByGeneration": [0, 1],
  "oosFailedByGeneration": [1, 0],
  "productionEligibleByGeneration": [0, 0],
  "warnings": []
}
```

既存単世代summaryも各世代で観測できるようにする。

```text
=== Generation 1 ===
parentPoolSummary
formalBtCandidateSummary
repairHintSummary
promotionGateSummary
repairOutcomeSummary
oosValidationSummary
oosAwarePromotionSummary

=== Generation 2 ===
...

--- multiGenerationTrendSummary ---
...
```

---

## テスト要件

### multiGenerationRunner.test.ts

以下を追加する。

1. `generations=2` で `runOneGeneration` が2回呼ばれる
2. `generations=1` で単世代相当になる
3. `generations` 上限超過時に clamp + warning される
4. Generation 1 の repairHints が Generation 2 に渡される
5. fatal / repair_excluded の repairHint は次世代へ渡されない
6. GenerationReport が世代ごとに保存される
7. 世代1で error が出た場合、`stopOnGenerationError=true` なら停止する
8. `stopOnGenerationError=false` の場合、failed entry が記録される
9. formalBtCandidateSummary が 0 の場合、設定に応じて早期停止する
10. parentPoolSummary が 0 の場合、設定に応じて早期停止する
11. `trendSummary` が formalBtCandidatesByGeneration を集計する
12. `trendSummary` が repairOutcomeImprovedByGeneration を集計する
13. `trendSummary` が validationConfirmedByGeneration を集計する
14. `trendSummary` が productionEligibleByGeneration を集計する
15. productionEligible が 0 のままでも正常完了する

### smoke / integration test

必要なら最小限追加する。

1. `--generations 2` で multi-generation mode になる
2. `--generations` 未指定なら従来単世代 mode のまま
3. multi-generation mode でも `formalBtCandidateSummary` が消えない
4. multi-generation mode でも `oosAwarePromotionSummary` が消えない
5. `multiGenerationTrendSummary` が smoke に出る

---

## 既存機能の保護

PR #106 では、以下を壊さない。

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
analysisEngineRobustnessAdapter
oosValidationResultMapper
oosValidationSummary
```

特に `formalBtCandidateSummary` は、全件正式BTを避けるための軽量選抜層の観測点である。

multi-generation 化のついでに消さない。

---

## 実装制約

- `any` を使わない
- DB migration を追加しない
- EdgeStatus enum を変更しない
- StatusManager を変更しない
- production_candidate へ自動昇格しない
- productionEligible を true にしない
- Adaptive Repair / Mutation Budget を実装しない
- Quality-Diversity Archive を実装しない
- parent pool 比率を自動変更しない
- mutation budget を自動変更しない
- Walk Forward / Monte Carlo / Backtest を Evolution 側で再実装しない
- analysis-engine metrics を Evolution 側で再計算しない
- 並列世代実行しない
- UI / dashboard を作らない

---

## 禁止事項

- 複数世代で improved が出たから production_ready にする
- validation_confirmed を production_candidate と同義にする
- OOS failed を自動 rejected にする
- repairOutcome が悪いから mutation budget をこのPRで減らす
- repairOutcome が良いから mutation budget をこのPRで増やす
- parent pool 比率をこのPRで変える
- multi-generation runner 内に PromotionGate 判定を再実装する
- multi-generation runner 内に OOS 判定を再実装する
- multi-generation runner 内に BT logic を書く

---

## 完了条件

以下を満たしたら PR #106 完了。

- Multi-generation runner v1 が追加されている
- `runOneGeneration` を複数回 sequential に実行できる
- 世代ごとの `GenerationReport` を収集できる
- Generation N の repairHints を Generation N+1 に渡せる
- fatal / repair_excluded repairHint は引き継がれない
- `multiGenerationTrendSummary` が生成される
- `formalBtCandidatesByGeneration` が出る
- `repairOutcomeImprovedByGeneration` が出る
- `validationConfirmedByGeneration` が出る
- `productionEligibleByGeneration` が出る
- smoke で `--generations 2` が使える
- 単世代 smoke の既存挙動が壊れない
- `formalBtCandidateSummary` が multi-generation でも残る
- `oosAwarePromotionSummary` が multi-generation でも残る
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

---

## PR本文に記載すること

```md
## Summary
- Multi-generation Evolution Run v1 を追加
- runOneGeneration を sequential に複数世代実行できるようにした
- 世代ごとの GenerationReport を収集し、multiGenerationTrendSummary を出力可能にした
- Generation N の RepairHint を Generation N+1 に引き継げるようにした
- --generations smoke を追加した

## Roadmap Note
- 本PR #106 は Multi-generation Evolution Run v1
- Adaptive Repair / Mutation Budget は PR #107 へ繰り下げ
- Quality-Diversity Archive は PR #108 へ繰り下げ
- production_ready 昇格は本PRでは行わない

## Scope
- DB migration なし
- EdgeStatus enum 変更なし
- StatusManager 変更なし
- production_candidate 自動昇格なし
- mutation budget 自動調整なし
- parent pool 比率変更なし
- Walk Forward / Monte Carlo / Backtest 再実装なし
- UI / dashboard なし

## Verification
- npx tsc --noEmit -p tsconfig.json
- npx jest src/side-b/tests/evolution/ src/side-b/tests/strategy_dsl/ src/side-b/tests/agents/ --silent
- set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3
- set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3 --generations 2

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
```

---

## 最重要判断基準

PR #106 の目的は、進化制御を賢くすることではない。

目的は、既存の単世代ループを複数世代で安全に回し、世代間で何が改善・停滞・悪化しているかを観測できるようにすることである。

```text
#105:
  OOS-aware PromotionGate を作った

#106:
  それが複数世代で効くか観測する

#107:
  観測結果を使って mutation / repair budget を調整する
```

PR #106 で #107 の仕事を始めない。

実装判断に迷った場合は、以下を優先する。

1. sequential に回す
2. 単世代ロジックを再実装しない
3. repairHint を安全に次世代へ渡す
4. trend summary を出す
5. production へ進めない
6. adaptive制御をしない
7. analysis-engine を評価正本のままにする
8. Rescue Lane / formalBtCandidateSummary を壊さない

---

## エージェントへの最終指示

まず現在の `EvolutionLoop`、`runOneGeneration`、`GenerationReport`、`repairHintSummary`、`repairOutcomeSummary`、`promotionGateSummary`、`oosValidationSummary`、`oosAwarePromotionSummary`、`scripts/evolution-pdca-smoke.ts` を確認すること。

その上で、最小差分で Multi-generation runner v1 を実装すること。

このPRで目指すのは、自律進化の完成ではない。  
複数世