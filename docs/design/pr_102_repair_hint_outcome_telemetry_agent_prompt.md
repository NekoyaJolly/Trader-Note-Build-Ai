# 実装指示: PR #102 RepairHint Outcome Telemetry v1

## 位置づけ

この文書は **PR #102 専用の実装指示** である。

PR #100 では `FailureReason → RepairHint v1` を実装し、正式BT・surrogate・validation の失敗理由から deterministic に `RepairHint` を生成できるようになった。

また、mutation agent に `repairHints` を optional に渡せるようになり、直前世代の `RepairHint` を次世代 mutation に利用できる経路も入った。

PR #101 で `Promotion Gate / EvolutionCandidateStage v1` が実装され、候補状態の整理と `promotionGateSummary` の観測が可能になった。

PR #102 では、次の問題を扱う。

> RepairHint を mutation に渡せるようになったが、その RepairHint が実際に改善へ寄与したかはまだ測れていない。

本PRの目的は、RepairHint の利用結果を観測し、次世代の進化制御に使える telemetry を作ることである。

---

## Roadmap Note

当初ロードマップ通り、本PRは以下の位置づけ。

```text
#100 FailureReason → RepairHint        (merged)
#101 Promotion Gate / CandidateStage   (merged)
#102 RepairHint Outcome Telemetry      ← 本PR
#103 OOS / Walk-forward
```

---

## 目的

RepairHint を使って生成された子候補について、親・失敗元・修復対象・正式BT結果を比較し、以下を観測可能にする。

```text
RepairHint を使った候補は改善したのか
どの failureReason の repair が効いたのか
どの repair target が効いたのか
どの route 由来の候補が改善しやすいのか
逆に悪化した repair はどれか
```

最終的には、将来PRで mutation budget / repairHint priority / 親選抜重みを調整する材料にする。

---

## このPRでやること

### 実装する

- RepairHint が適用された mutation child の trace 記録
- 親または失敗元 metrics と子 formal BT metrics の比較
- `RepairOutcome` の判定
- `repairOutcomeSummary` の GenerationReport / smoke 出力
- `byFailureReason` / `byActionTarget` / `byRoute` の集計
- 単体テスト
- 既存 mutation / crossover / parentPool / rescue lane / repairHint 経路の互換性維持

### 実装しない

- DB migration
- EdgeStatus enum の変更
- Promotion Gate
- EvolutionCandidateStage
- mutation budget の自動調整
- repairHint priority の自動変更
- LLMによる outcome 判定
- OOS / walk-forward
- QualityDiversityArchive
- UI / dashboard
- formal BT 合格条件の変更

---

## 基本方針

### 1. Telemetry に限定する

PR #102 では、観測・集計のみ行う。  
outcome に基づいて mutation budget や親選抜比率を変える処理は入れない。

### 2. Deterministic に判定する

RepairHint の効果判定は LLM に任せない。  
metrics の差分からコードで判定する。

### 3. 改善・悪化・不明を分ける

すべてを無理に改善 / 悪化へ分類しない。  
比較元 metrics がない場合、正式BT結果がない場合、同一指標で比較できない場合は `unknown` とする。

### 4. RepairHint は評価条件ではない

RepairHint を使ったからといって、候補を高評価したり formal BT 条件を緩めたりしない。

---

## 推奨ファイル構成

既存構成に合わせること。候補としては以下。

```text
src/side-b/evolution/repairOutcomeTelemetry.ts
src/side-b/tests/evolution/repairOutcomeTelemetry.test.ts
```

既存の mutation / repairHint / formal BT 関連の型が別ファイルにある場合は、そこに最小限の型追加をしてもよい。

ただし、`EvolutionLoop.ts` に outcome 判定ロジック本体を書かない。  
`EvolutionLoop.ts` は orchestration に留める。

---

## 型定義

### RepairOutcomeStatus

```ts
// RepairHint 適用後の結果判定
export type RepairOutcomeStatus =
  | 'improved'
  | 'worsened'
  | 'unchanged'
  | 'unknown';
```

### RepairOutcomeMetricDelta

```ts
// 親または失敗元と子候補の metrics 差分
export type RepairOutcomeMetricDelta = {
  pfDelta: number | null;
  tradeCountDelta: number | null;
  maxDrawdownDelta: number | null;
  expectancyDelta: number | null;
};
```

### RepairOutcomeBaseline

```ts
// 比較元の metrics
export type RepairOutcomeBaseline = {
  candidateId: string;
  dslId?: string;
  failureReason: string;
  route?: string;
  metrics: {
    pf?: number | null;
    tradeCount?: number | null;
    maxDrawdown?: number | null;
    expectancy?: number | null;
  };
};
```

### RepairAppliedTrace

```ts
// mutation child に付与する RepairHint 適用トレース
export type RepairAppliedTrace = {
  sourceCandidateId: string;
  sourceDslId?: string;
  failureReason: string;
  route?: string;
  severity: string;
  targets: string[];
  actionSummaries: string[];
};
```

### RepairOutcome

```ts
// RepairHint 適用後の観測結果
export type RepairOutcome = {
  childCandidateId: string;
  childDslId: string;
  sourceCandidateId: string;
  sourceDslId?: string;
  failureReason: string;
  route: string;
  targets: string[];
  status: RepairOutcomeStatus;
  deltas: RepairOutcomeMetricDelta;
  reason: string;
  warnings: string[];
};
```

### RepairOutcomeSummaryBucket

```ts
// failureReason / target / route ごとの集計
export type RepairOutcomeSummaryBucket = {
  attempted: number;
  improved: number;
  worsened: number;
  unchanged: number;
  unknown: number;
};
```

### RepairOutcomeSummary

```ts
// GenerationReport / smoke に出す summary
export type RepairOutcomeSummary = {
  attempted: number;
  improved: number;
  worsened: number;
  unchanged: number;
  unknown: number;
  byFailureReason: Record<string, RepairOutcomeSummaryBucket>;
  byActionTarget: Record<string, RepairOutcomeSummaryBucket>;
  byRoute: Record<string, RepairOutcomeSummaryBucket>;
  warnings: string[];
};
```

---

## RepairAppliedTrace の付与

### 目的

RepairHint が mutation に渡されたあと、生成された子候補が「どの RepairHint を受けて生まれたのか」を追えるようにする。

### 実装方針

mutation agent の出力 DSL または metadata に、可能な範囲で以下を残す。

```ts
repairApplied?: RepairAppliedTrace;
```

既存 StrategyDSL schema が追加 metadata を許容しない場合は、GenerationReport 内の一時 map として保持してもよい。

### 優先順位

1. DSL metadata に安全に入れられるなら入れる
2. 無理なら EvolutionLoop 内の generation-local map に保持する
3. DB永続化はしない

PR #102 では migration をしない。

---

## baseline の作り方

### 比較元

RepairOutcome の baseline は、RepairHint の元になった candidate の metrics を使う。

優先順位:

```text
formal BT failure metrics
  > surrogate / validation metrics
  > parent pool metrics
  > unknown
```

### 重要

比較元がない場合は無理に比較しない。

```text
baseline missing → status = unknown
```

不明な baseline に対して適当な 0 を入れない。  
0 は情報ではなく嘘になる場合がある。

---

## outcome 判定ルール

### 関数

```ts
export function evaluateRepairOutcome(
  baseline: RepairOutcomeBaseline | null,
  child: {
    candidateId: string;
    dslId: string;
    route?: string;
    repairApplied?: RepairAppliedTrace;
    metrics?: {
      pf?: number | null;
      tradeCount?: number | null;
      maxDrawdown?: number | null;
      expectancy?: number | null;
    };
  },
): RepairOutcome;
```

### 基本ルール

- baseline がない → `unknown`
- child metrics がない → `unknown`
- repairApplied がない → outcome 対象外、または `unknown`
- 比較できる metrics がない → `unknown`

### failureReason 別の改善判定

#### insufficient_trades

主指標:

- `tradeCount` の増加

改善:

```text
child.tradeCount > baseline.tradeCount
```

悪化:

```text
child.tradeCount < baseline.tradeCount
```

補足:

- baseline.tradeCount = 0 かつ child.tradeCount > 0 は強い改善
- child.tradeCount は増えたが PF が極端に悪化した場合は warning を出す

#### low_pf

主指標:

- `pf` の改善

改善:

```text
child.pf > baseline.pf
```

悪化:

```text
child.pf < baseline.pf
```

補足:

- PFが改善しても tradeCount が大幅減少した場合は warning を出す
- PFが微差の場合は `unchanged` とするため、最小差分閾値を設けてもよい

#### analysis_engine_timeout

主指標:

- child が formal BT / analysis-engine を完走したか

改善:

```text
baseline が timeout で、child metrics が存在する
```

悪化:

```text
child も timeout または analysis_engine_error
```

PR #102 では、timeout の詳細結果が取れない場合は `unknown` でもよい。

#### analysis_engine_error

主指標:

- child が analysis-engine を実行可能になったか

改善:

```text
baseline が error で、child metrics が存在する
```

悪化:

```text
child も error
```

#### dsl_missing

`dsl_missing` は PR #100 で fatal / repair mutation 対象外になっているはず。  
この outcome が出た場合は warning とし、原則 `unknown` にする。

#### other

主指標が曖昧なため、以下を総合して判定する。

- PF 改善
- tradeCount 改善
- maxDrawdown 改善
- expectancy 改善

比較できる指標が1つだけなら、その指標で判定する。  
複数指標が矛盾する場合は `unchanged` または `unknown` にする。

---

## unchanged 判定

微差を改善・悪化扱いしない。

推奨閾値:

```ts
export const repairOutcomeThresholds = {
  pfMinDelta: 0.02,
  expectancyMinDelta: 0.0001,
  maxDrawdownMinDelta: 0.01,
  tradeCountMinDelta: 1,
} as const;
```

例:

```text
PF 1.10 → 1.11 は unchanged
PF 1.10 → 1.16 は improved
```

実コードの metrics scale に合わせて調整すること。

---

## maxDrawdown の扱い

maxDrawdown は小さい方が良い。

```text
child.maxDrawdown < baseline.maxDrawdown → improved
child.maxDrawdown > baseline.maxDrawdown → worsened
```

ただし、metrics が percent か decimal かは実コードに合わせること。  
scale が不明な場合は、このPRでは warning を出し、補助指標扱いに留める。

---

## summary 集計

### summarizeRepairOutcomes

```ts
export function summarizeRepairOutcomes(outcomes: RepairOutcome[]): RepairOutcomeSummary;
```

### 集計ルール

- `attempted` は outcome 対象になった child 数
- `improved / worsened / unchanged / unknown` を status ごとに集計
- `byFailureReason` に failureReason ごとの bucket を入れる
- `byActionTarget` に target ごとの bucket を入れる
- `byRoute` に route ごとの bucket を入れる
- route がない場合は `'unknown'`
- targets が空の場合は `'unknown'`

---

## EvolutionLoop への統合

### 目的

1世代の中で、RepairHint を使った mutation child の正式BT結果を outcome として集計する。

想定フロー:

```text
前世代 failure → RepairHint 生成
  ↓
次世代 mutation に repairHints を渡す
  ↓
mutation child に repairApplied trace を付与
  ↓
surrogate / rescue / formal BT
  ↓
child metrics を取得
  ↓
baseline と child metrics を比較
  ↓
repairOutcomeSummary を GenerationReport に追加
```

### 注意

PR #102 では、outcome 結果をもとに mutation 方針を自動変更しない。  
自動制御は PR #102 以降。

---

## smoke 出力

`scripts/evolution-pdca-smoke.ts` に以下を出す。

```text
--- repairOutcomeSummary ---
{
  "attempted": 5,
  "improved": 2,
  "worsened": 1,
  "unchanged": 1,
  "unknown": 1,
  "byFailureReason": {
    "low_pf": {
      "attempted": 2,
      "improved": 1,
      "worsened": 0,
      "unchanged": 1,
      "unknown": 0
    },
    "insufficient_trades": {
      "attempted": 3,
      "improved": 1,
      "worsened": 1,
      "unchanged": 0,
      "unknown": 1
    }
  },
  "byActionTarget": {
    "entry": {
      "attempted": 3,
      "improved": 1,
      "worsened": 1,
      "unchanged": 0,
      "unknown": 1
    }
  },
  "byRoute": {
    "trade_count_rescue": {
      "attempted": 2,
      "improved": 1,
      "worsened": 0,
      "unchanged": 0,
      "unknown": 1
    }
  },
  "warnings": []
}
```

さらに可能なら短い per-outcome log を出す。

```text
repairOutcome child=<id> reason=insufficient_trades target=entry status=improved tradeCountDelta=+12 pfDelta=-0.03
repairOutcome child=<id> reason=low_pf target=exit status=worsened pfDelta=-0.08
```

---

## テスト要件

### repairOutcomeTelemetry.test.ts

以下を追加する。

1. baseline がない場合 `unknown` になる
2. child metrics がない場合 `unknown` になる
3. `insufficient_trades` で tradeCount が増えたら `improved`
4. `insufficient_trades` で tradeCount が減ったら `worsened`
5. `low_pf` で PF が改善したら `improved`
6. `low_pf` で PF が悪化したら `worsened`
7. PF差分が閾値未満なら `unchanged`
8. `analysis_engine_timeout` で child metrics が存在すれば `improved`
9. `analysis_engine_error` で child metrics が存在すれば `improved`
10. `dsl_missing` は warning 付き `unknown`
11. `other` は複数metricsから保守的に判定する
12. maxDrawdown は小さい方を改善として扱う
13. `summarizeRepairOutcomes` が failureReason ごとに集計する
14. `summarizeRepairOutcomes` が target ごとに集計する
15. `summarizeRepairOutcomes` が route ごとに集計する
16. targets が空の場合 `'unknown'` bucket に入る

### mutation integration test

可能なら以下を追加する。

1. repairHint を使った mutation child に `repairApplied` trace が付与される
2. `repairApplied` に sourceCandidateId / failureReason / targets が含まれる
3. repairHint がない mutation child は outcome 対象外または unknown になる

### evolutionLoop test

必要なら最小限追加する。

1. RepairHint を使った世代で `repairOutcomeSummary` が GenerationReport に入る
2. formal BT 結果と baseline metrics から outcome が生成される
3. outcome がなくても runOneGeneration は落ちない

---

## 実装制約

- `any` を使わない
- DB migration を追加しない
- EdgeStatus enum を変更しない
- Promotion Gate を追加しない
- LLM に outcome 判定を任せない
- formal BT 合格条件を変えない
- repairHint がある候補を高評価しない
- outcome 結果で mutation budget をこのPRでは変更しない
- 既存 parentPool / rescue lane / novelty / EdgeHypothesis / repairHint 経路を壊さない

---

## 禁止事項

- `improved` をもって `confirmed` 扱いしない
- outcome によって production_ready 相当へ昇格させない
- baseline 不明なのに 0 扱いで比較しない
- PFだけを万能指標にしない
- tradeCount 増加だけで成功扱いしすぎない
- drawdown 悪化を無視しない
- LLMに「改善したか」を判断させない
- UI / dashboard をこのPRで作らない

---

## 完了条件

以下を満たしたら PR #102 完了。

- `repairOutcomeTelemetry.ts` が実装されている
- RepairHint 適用 trace を子候補と関連付けられる
- baseline metrics と child metrics を比較できる
- `RepairOutcome` が deterministic に判定される
- `RepairOutcomeSummary` が集計される
- GenerationReport または smoke で `repairOutcomeSummary` が観測できる
- `byFailureReason / byActionTarget / byRoute` が出る
- outcome がない世代でも落ちない
- DB migration なし
- EdgeStatus 変更なし
- Promotion Gate なし
- 対象テストが通る
- smoke 実行で `parentPoolSummary` / `formalBtCandidateSummary` / `repairHintSummary` / `repairOutcomeSummary` が確認できる

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

可能なら multi-generation smoke も実行する。

```bash
# 実行場所: リポジトリルート
set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3 --generations 2
```

`--generations` が未実装の場合、このPRで無理に追加しなくてよい。  
ただし、PR本文に「単世代 smoke のため outcome は unknown が多い可能性あり」と明記する。

---

## PR本文に記載すること

```md
## Summary
- RepairHint Outcome Telemetry v1 を追加
- RepairHint 適用 child の trace を記録
- baseline metrics と child formal BT metrics を比較して RepairOutcome を判定
- repairOutcomeSummary を GenerationReport / smoke で観測可能にした

## Scope
- DB migration なし
- EdgeStatus enum 変更なし
- Promotion Gate なし
- mutation budget 自動調整なし
- LLM outcome 判定なし
- UI / dashboard なし

## Verification
- npx tsc --noEmit -p tsconfig.json
- npx jest src/side-b/tests/evolution/ src/side-b/tests/strategy_dsl/ src/side-b/tests/agents/ --silent
- set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3

## Smoke Observations
- parentPoolSummary:
- formalBtCandidateSummary:
- repairHintSummary:
- repairOutcomeSummary:
```

---

## 最重要判断基準

PR #102 の目的は、RepairHint の効果を改善することではない。

目的は、**RepairHint が効いたかどうかを測れるようにすること** である。

```text
失敗理由を修復ヒントにする
  ↓
修復ヒントを mutation に渡す
  ↓
子候補ができる
  ↓
正式BTで評価される
  ↓
親・失敗元と比べて改善したか測る
```

このPRで outcome による自動制御まで入れない。  
まずは観測可能性を作る。

実装判断に迷った場合は、以下を優先する。

1. deterministic に判定する
2. baseline 不明なら unknown にする
3. outcome は昇格判定に使わない
4. summary で傾向を追えるようにする
5. DB / status / promotion に触らない
6. PR #102 のスコープを小さく保つ

---

## エージェントへの最終指示

まず現在の `RepairHint` 型、mutation agent の input / output、GenerationReport、formal BT metrics の記録箇所を確認すること。

その上で、最小差分で `repairOutcomeTelemetry.ts` を追加し、RepairHint 適用 child の outcome を観測できるようにすること。

このPRで目指すのは、自律進化の完成ではない。  
RepairHint が次世代で本当に改善へつながったかを、測定できる状態にすることである。

実装後は、型チェック、対象テスト、smoke を実行し、PR本文に `repairOutcomeSummary` の実測ログを貼ること。

