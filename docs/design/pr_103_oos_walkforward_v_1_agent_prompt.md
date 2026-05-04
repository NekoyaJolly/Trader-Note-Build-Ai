# 実装指示: PR #103 OOS / Walk-forward v1

## 位置づけ

この文書は **PR #103 専用の実装指示** である。

現在の正式ロードマップは以下である。

```text
#100 FailureReason → RepairHint        完了
#101 Promotion Gate / CandidateStage   完了
#102 RepairHint Outcome Telemetry      完了
#103 OOS / Walk-forward v1             本PR
```

PR #100 では、正式BTやsurrogateで失敗した候補から `RepairHint` を生成できるようになった。

PR #101 では、`PromotionGate / EvolutionCandidateStage` により、候補の状態を整理できるようになった。

PR #102 では、`RepairHint` を使って生成された child が baseline より改善したかを `RepairOutcomeTelemetry` として観測できるようになった。

PR #103 では、次の問題を扱う。

> in-sample / formal BT / repair outcome 上では改善して見える候補が、未知期間でも耐えるかがまだ分からない。

本PRの目的は、`validation_candidate` になった候補に対して、OOS または Walk-forward の評価結果を観測可能にすることである。

---

## 目的

PR #103 の目的は、進化候補の汎化性能を観測することである。

```text
formal BT passed
  ↓
validation_candidate
  ↓
OOS / Walk-forward 評価
  ↓
OOSでも耐えるかを観測
  ↓
OOSValidationSummary として report / smoke に出す
```

このPRでは、OOS結果による production 昇格は行わない。

OOSはあくまで観測であり、将来PRで PromotionGate に接続するための材料である。

---

## このPRでやること

### 実装する

- OOS / Walk-forward 評価用の型定義
- chronological split の v1 実装
- `validation_candidate` 候補の OOS 評価
- Walk-forward fold summary の生成
- `oosValidationSummary` の GenerationReport / smoke 出力
- in-sample metrics と OOS metrics の差分観測
- OOS failure reason の簡易分類
- 単体テスト
- 既存 parentPool / rescue lane / promotionGate / repairHint / repairOutcome 経路の互換性維持

### 実装しない

- DB migration
- EdgeStatus enum の変更
- StatusManager の変更
- production_ready 昇格
- production_candidate 自動昇格
- PromotionGatePolicy の本格変更
- mutation budget 自動調整
- parent pool 比率の自動調整
- QualityDiversityArchive
- UI / dashboard
- analysis-engine の大改修
- LLMによるOOS判定

---

## 基本方針

### 1. OOSは昇格ではない

OOS評価に通ったとしても、このPRでは `productionEligible=true` にしない。

```text
OOS passed != production ready
OOS failed != rejected
```

OOS結果は観測値として扱う。

### 2. PromotionGate と分離する

PR #101 の `PromotionGate` は候補のstageを整理する。

PR #103 の `OOS / Walk-forward` は、`validation_candidate` の汎化性能を観測する。

このPRで `PromotionGatePolicy` を大きく変更しない。

### 3. 時系列順を守る

OOS / Walk-forward は必ず時系列順で評価する。

未来データを train / validation に混ぜない。

```text
train期間 < validation期間 < OOS期間
```

ランダム分割は禁止。

### 4. baseline 不明なら unknown

比較元の in-sample / formal BT metrics がない場合、0補完しない。

```text
baseline missing → unknown
```

0はデータではなく、雑な捏造になる。

### 5. v1は観測優先

完璧なWalk-forward最適化を作らない。

PR #103では、まず以下が見えればよい。

```text
OOSでPFが維持されたか
OOSでtradeCountが足りるか
OOSでdrawdownが悪化したか
foldごとの安定性はどうか
in-sampleだけ良かった候補を検出できるか
```

---

## 推奨ファイル構成

既存構成に合わせること。候補としては以下。

```text
src/side-b/evolution/oosWalkForwardPolicy.ts
src/side-b/tests/evolution/oosWalkForwardPolicy.test.ts
```

必要に応じて、formal BT 実行サービスへの薄い adapter を追加してよい。

```text
src/side-b/evolution/oosEvaluationRunner.ts
src/side-b/tests/evolution/oosEvaluationRunner.test.ts
```

ただし、`EvolutionLoop.ts` に OOS 判定ロジック本体を書かない。  
`EvolutionLoop.ts` は orchestration に留める。

---

## 型定義

### OosValidationStatus

```ts
// OOS / Walk-forward の観測結果
export type OosValidationStatus =
  | 'oos_passed'
  | 'oos_failed'
  | 'walk_forward_passed'
  | 'walk_forward_failed'
  | 'insufficient_oos_data'
  | 'not_evaluated'
  | 'unknown';
```

### OosFailureReason

```ts
// OOS評価で落ちた理由
export type OosFailureReason =
  | 'low_oos_pf'
  | 'insufficient_oos_trades'
  | 'high_oos_drawdown'
  | 'oos_expectancy_degraded'
  | 'fold_instability'
  | 'insample_oos_divergence'
  | 'oos_engine_error'
  | 'oos_timeout'
  | 'insufficient_oos_data'
  | 'unknown';
```

### OosMetrics

```ts
// OOSまたはfold単位の評価metrics
export type OosMetrics = {
  pf: number | null;
  tradeCount: number | null;
  maxDrawdown: number | null;
  expectancy: number | null;
  winRate?: number | null;
};
```

### OosMetricDelta

```ts
// in-sample / formal BT と OOS の差分
export type OosMetricDelta = {
  pfDelta: number | null;
  tradeCountDelta: number | null;
  maxDrawdownDelta: number | null;
  expectancyDelta: number | null;
};
```

### OosSplitWindow

```ts
// 時系列評価の期間
export type OosSplitWindow = {
  trainStart: string;
  trainEnd: string;
  validationStart?: string;
  validationEnd?: string;
  oosStart: string;
  oosEnd: string;
};
```

### WalkForwardFold

```ts
// Walk-forward の1 fold
export type WalkForwardFold = {
  foldIndex: number;
  trainStart: string;
  trainEnd: string;
  oosStart: string;
  oosEnd: string;
  metrics: OosMetrics;
  status: OosValidationStatus;
  failureReasons: OosFailureReason[];
};
```

### OosValidationResult

```ts
// 候補ごとの OOS / Walk-forward 結果
export type OosValidationResult = {
  candidateId: string;
  dslId: string;
  sourceStage?: string;
  route?: string;
  baselineMetrics: OosMetrics | null;
  oosMetrics: OosMetrics | null;
  deltas: OosMetricDelta;
  status: OosValidationStatus;
  failureReasons: OosFailureReason[];
  folds: WalkForwardFold[];
  warnings: string[];
};
```

### OosValidationSummaryBucket

```ts
// status / reason / route ごとの集計
export type OosValidationSummaryBucket = {
  attempted: number;
  passed: number;
  failed: number;
  unknown: number;
};
```

### OosValidationSummary

```ts
// GenerationReport / smoke に出す summary
export type OosValidationSummary = {
  attempted: number;
  passed: number;
  failed: number;
  notEvaluated: number;
  unknown: number;
  byStatus: Record<OosValidationStatus, number>;
  byFailureReason: Record<OosFailureReason, number>;
  byRoute: Record<string, OosValidationSummaryBucket>;
  bySourceStage: Record<string, OosValidationSummaryBucket>;
  warnings: string[];
};
```

---

## 対象候補の選び方

### OOS評価対象

PR #103では、原則として以下を対象にする。

```text
PromotionGateDecision.toStage === 'validation_candidate'
```

つまり、formal BT passed になった候補を OOS / Walk-forward の対象にする。

### 対象外

以下は OOS対象外。

- `formal_bt_candidate` のままの候補
- `formal_bt_failed`
- `repairable`
- `repair_excluded`
- `rejected`
- `parent_eligible` のみの候補
- rescue されたが formal BT 未通過の候補
- DSL missing
- schema validation failed

### repairOutcome との関係

PR #102 の `RepairOutcome` が `improved` であっても、それだけで OOS対象にしない。

OOS対象はあくまで `validation_candidate` になった候補を基本とする。

ただし、repairHint を受けた child が formal BT passed となり、PromotionGate 上 `validation_candidate` になった場合は OOS対象にしてよい。

---

## split方針

### buildOosSplitWindowV1

```ts
export function buildOosSplitWindowV1(input: {
  startDate: string;
  endDate: string;
  oosRatio?: number;
  validationRatio?: number;
}): OosSplitWindow;
```

### 仕様

- 日付は時系列順に扱う
- `oosRatio` の default は `0.2`
- `validationRatio` の default は `0.0` または既存評価設計に合わせる
- `trainEnd < oosStart` を必ず満たす
- `oosStart >= trainEnd` にならないようにする
- データ期間が短すぎる場合は `insufficient_oos_data`

### 禁止

- ランダム分割
- future data leakage
- OOS結果を使ったパラメータ再調整
- OOS期間で最適化した値をin-sample結果として扱う

---

## Walk-forward 方針

### buildWalkForwardFoldsV1

```ts
export function buildWalkForwardFoldsV1(input: {
  startDate: string;
  endDate: string;
  trainWindowDays: number;
  oosWindowDays: number;
  stepDays: number;
  maxFolds?: number;
}): Array<{
  foldIndex: number;
  trainStart: string;
  trainEnd: string;
  oosStart: string;
  oosEnd: string;
}>;
```

### 仕様

- fold は時系列順
- 各foldで `trainEnd < oosStart`
- `maxFolds` default は `3` 程度でよい
- データが足りない場合は空配列を返す
- 空配列でも例外を投げない

### PR #103 の範囲

PR #103 では Walk-forward を本格最適化にしない。

各foldで同じ StrategyDSL を OOS期間に当てるだけでよい。

```text
やる:
  同一DSLを複数OOS期間で評価する

やらない:
  foldごとにパラメータ再最適化する
```

---

## OOS評価 runner

### evaluateOosCandidateV1

```ts
export async function evaluateOosCandidateV1(input: {
  candidateId: string;
  dslId: string;
  dsl: StrategyDSL;
  baselineMetrics: OosMetrics | null;
  route?: string;
  sourceStage?: string;
  oosWindow: OosSplitWindow;
  runBacktest: (args: {
    dsl: StrategyDSL;
    startDate: string;
    endDate: string;
  }) => Promise<OosMetrics>;
}): Promise<OosValidationResult>;
```

既存の formal BT / analysis engine runner が date range を受け取れる場合は、それを使う。

date range を受け取れない場合、このPRで analysis-engine を大改修しない。

その場合は以下のいずれかにする。

1. 既存runnerに最小の optional date range を追加する
2. OOS評価を `not_evaluated` として summary に出す
3. adapter層だけ作り、実実行は後続PRへ回す

ただし、OOSが完全に不可視になる実装は禁止。

---

## OOS pass / fail 判定

### classifyOosValidationV1

```ts
export function classifyOosValidationV1(input: {
  baselineMetrics: OosMetrics | null;
  oosMetrics: OosMetrics | null;
  minOosTrades?: number;
  minOosPf?: number;
  maxOosDrawdown?: number;
}): {
  status: OosValidationStatus;
  failureReasons: OosFailureReason[];
  deltas: OosMetricDelta;
  warnings: string[];
};
```

### default threshold

```ts
export const oosValidationThresholdsV1 = {
  minOosTrades: 20,
  minOosPf: 1.05,
  maxOosDrawdown: 0.25,
  maxPfDegradation: 0.25,
  maxExpectancyDegradation: 0.0001,
} as const;
```

実コードの metrics scale に合わせて調整すること。

### 判定ルール

#### insufficient_oos_data

以下の場合。

```text
oosMetrics が null
oos tradeCount が null
OOS期間が短すぎる
```

#### insufficient_oos_trades

```text
oos.tradeCount < minOosTrades
```

#### low_oos_pf

```text
oos.pf < minOosPf
```

#### high_oos_drawdown

```text
oos.maxDrawdown > maxOosDrawdown
```

#### insample_oos_divergence

baseline があり、OOSで大きく劣化した場合。

例:

```text
baseline.pf - oos.pf > maxPfDegradation
```

#### oos_passed

以下を満たす場合。

```text
oos.tradeCount >= minOosTrades
oos.pf >= minOosPf
oos.maxDrawdown <= maxOosDrawdown
```

ただし、baseline metrics がない場合は warning を出す。

---

## Walk-forward判定

### summarizeWalkForwardFoldsV1

```ts
export function summarizeWalkForwardFoldsV1(
  folds: WalkForwardFold[],
): {
  status: OosValidationStatus;
  failureReasons: OosFailureReason[];
  warnings: string[];
};
```

### 仕様

- folds が空なら `not_evaluated` または `insufficient_oos_data`
- fold の半数以上が pass なら `walk_forward_passed`
- fold の半数未満が pass なら `walk_forward_failed`
- foldごとのPFやtradeCountが大きくブレる場合は `fold_instability`

PR #103ではこの程度の軽量判定でよい。

---

## GenerationReport への統合

`GenerationReport` に以下を optional で追加する。

```ts
oosValidationSummary?: OosValidationSummary;
oosValidationResults?: OosValidationResult[];
```

大きな型変更が重い場合、まずは `oosValidationSummary` のみでもよい。

ただし、最低限 `oosValidationSummary` は smoke で観測できるようにする。

---

## smoke 出力

`scripts/evolution-pdca-smoke.ts` に以下を出す。

```text
--- oosValidationSummary ---
{
  "attempted": 1,
  "passed": 0,
  "failed": 1,
  "notEvaluated": 0,
  "unknown": 0,
  "byStatus": {
    "oos_failed": 1
  },
  "byFailureReason": {
    "low_oos_pf": 1
  },
  "byRoute": {
    "novelty_rescue": {
      "attempted": 1,
      "passed": 0,
      "failed": 1,
      "unknown": 0
    }
  },
  "bySourceStage": {
    "validation_candidate": {
      "attempted": 1,
      "passed": 0,
      "failed": 1,
      "unknown": 0
    }
  },
  "warnings": []
}
```

既存の smoke 出力順は以下を目安にする。

```text
parentPoolSummary
formalBtCandidateSummary
repairHintSummary
promotionGateSummary
repairOutcomeSummary
oosValidationSummary
```

---

## テスト要件

### oosWalkForwardPolicy.test.ts

以下を追加する。

1. `buildOosSplitWindowV1` が時系列順の split を作る
2. `buildOosSplitWindowV1` が短すぎる期間で insufficient 扱いになる
3. `buildWalkForwardFoldsV1` が時系列順の folds を作る
4. fold で `trainEnd < oosStart` が守られる
5. データ不足時に folds が空でも例外を投げない
6. OOS tradeCount不足で `insufficient_oos_trades`
7. OOS PF不足で `low_oos_pf`
8. OOS drawdown過大で `high_oos_drawdown`
9. baseline から大きく劣化した場合 `insample_oos_divergence`
10. 条件を満たす場合 `oos_passed`
11. baseline missing でも0補完せず warning を出す
12. fold の半数以上passなら `walk_forward_passed`
13. fold の半数未満passなら `walk_forward_failed`
14. fold が不安定なら `fold_instability`
15. `summarizeOosValidationResults` が status / reason / route / sourceStage ごとに集計する

### evolutionLoop test

必要なら最小限追加する。

1. `validation_candidate` が OOS対象になる
2. `repairable` は OOS対象外になる
3. rescue route でも formal BT passed で `validation_candidate` なら OOS対象になる
4. `oosValidationSummary` が GenerationReport に入る
5. OOS evaluator が not_evaluated を返しても runOneGeneration は落ちない
6. `promotionGateSummary` / `repairOutcomeSummary` が壊れない

---

## 実装制約

- `any` を使わない
- DB migration を追加しない
- EdgeStatus enum を変更しない
- StatusManager を変更しない
- PromotionGatePolicy を大きく変更しない
- production_ready 昇格を追加しない
- OOS結果で productionEligible を true にしない
- OOS結果で parentPool 比率を変更しない
- OOS結果で mutation budget を変更しない
- OOS期間でパラメータ最適化しない
- ランダム分割しない
- future data leakage を起こさない
- LLMにOOS判定を任せない
- 既存 parentPool / rescue lane / novelty / EdgeHypothesis / repairHint / repairOutcome 経路を壊さない

---

## 禁止事項

- OOS passed を confirmed / production_ready と同義にしない
- OOS failed を即 rejected にしない
- OOS metrics がない候補を0補完で評価しない
- Walk-forward で foldごとに最適化しない
- OOS結果を使って同じPR内でthreshold調整しない
- UI / dashboard をこのPRで作らない
- DB schema をこのPRで変更しない

---

## 完了条件

以下を満たしたら PR #103 完了。

- OOS / Walk-forward 用の型が定義されている
- chronological split が実装されている
- Walk-forward fold 生成が実装されている
- `validation_candidate` をOOS評価対象にできる
- OOS metrics と baseline metrics の差分を観測できる
- OOS pass / fail / insufficient / unknown が判定できる
- `oosValidationSummary` が GenerationReport または smoke で観測できる
- `byStatus / byFailureReason / byRoute / bySourceStage` が出る
- OOSが未実行でも `not_evaluated` として観測できる
- production昇格なし
- DB migration なし
- EdgeStatus 変更なし
- 対象テストが通る
- smoke 実行で以下が確認できる
  - `parentPoolSummary`
  - `formalBtCandidateSummary`
  - `repairHintSummary`
  - `promotionGateSummary`
  - `repairOutcomeSummary`
  - `oosValidationSummary`

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

可能ならmulti-generation smokeも実行する。

```bash
# 実行場所: リポジトリルート
set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3 --generations 2
```

`--generations` が未実装の場合、このPRで無理に追加しなくてよい。

---

## PR本文に記載すること

```md
## Summary
- OOS / Walk-forward v1 を追加
- validation_candidate に対する OOS 評価を観測可能にした
- chronological split / walk-forward folds を追加
- oosValidationSummary を GenerationReport / smoke で確認可能にした

## Roadmap Note
- PR #100: FailureReason → RepairHint 完了
- PR #101: Promotion Gate / EvolutionCandidateStage 完了
- PR #102: RepairHint Outcome Telemetry 完了
- 本PR #103 は OOS / Walk-forward v1 に限定
- production_ready 昇格は後続PRへ繰り下げ

## Scope
- DB migration なし
- EdgeStatus enum 変更なし
- StatusManager 変更なし
- PromotionGatePolicy の大改修なし
- production_ready 自動昇格なし
- mutation budget 自動調整なし
- UI / dashboard なし

## Verification
- npx tsc --noEmit -p tsconfig.json
- npx jest src/side-b/tests/evolution/ src/side-b/tests/strategy_dsl/ src/side-b/tests/agents/ --silent
- set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3

## Smoke Observations
- parentPoolSummary:
- formalBtCandidateSummary:
- repairHintSummary:
- promotionGateSummary:
- repairOutcomeSummary:
- oosValidationSummary:
```

---

## 最重要判断基準

PR #103 の目的は、候補を本番昇格させることではない。

目的は、in-sample / formal BT / repair outcome で良く見える候補が、未知期間でも壊れないかを観測することである。

```text
#101:
  候補のstageを整理する

#102:
  repairHint の効果を測る

#103:
  改善や正式BT通過が OOS でも耐えるか測る
```

PR #103で production 判定を始めない。  
PR #103で OOS結果による自動制御を始めない。  
PR #103では、OOS / Walk-forward の観測可能性を作るだけでよい。

実装判断に迷った場合は、以下を優先する。

1. 時系列順を守る
2. future data leakage を防ぐ
3. validation_candidate のみを基本対象にする
4. OOS結果を昇格に使わない
5. baseline missing は unknown にする
6. OOS未実行でも not_evaluated として観測する
7. DB / status / production に触らない
8. PR #103 のスコープを小さく保つ

---

## エージェントへの最終指示

まず現在の `PromotionGateDecision`、`GenerationReport`、`repairOutcomeSummary`、formal BT runner、analysis engine の date range 対応状況を確認すること。

その上で、最小差分で `oosWalkForwardPolicy.ts` を追加し、`validation_candidate` に対する OOS / Walk-forward の観測を実装すること。

このPRで目指すのは、自律進化の完成ではない。  
正式BTやrepair outcomeで良く見える候補が、未知期間でも耐えるかを測れる状態にすることである。

実装後は、型チェック、対象テスト、smoke を実行し、PR本文に `oosValidationSummary` の実測ログを貼ること。

