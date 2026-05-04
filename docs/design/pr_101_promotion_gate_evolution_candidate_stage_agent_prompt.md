# 実装指示: PR #101 Promotion Gate / EvolutionCandidateStage v1

## 位置づけ

この文書は **PR #101 専用の正式な実装指示** である。

PR #100 では `FailureReason → RepairHint v1` を実装し、失敗理由を次世代 mutation の修復材料として利用できるようになった。

当初ロードマップでは、PR #101 は以下の位置づけだった。

```text
#100 FailureReason → RepairHint
#101 Promotion Gate / EvolutionCandidateStage
#102 RepairHint Outcome Telemetry
#103 OOS / Walk-forward
```

このPRでは、当初ロードマップ通り **Promotion Gate / EvolutionCandidateStage v1** を実装する。

RepairHint Outcome Telemetry は PR #102 へ繰り下げる。

---

## 目的

進化ループ内の候補状態を整理し、以下を明確に分離する。

```text
親として使える候補
正式BTへ送る候補
正式BTを通過した候補
repair対象候補
validation候補
production候補
除外すべき候補
```

現在の進化ループでは、以下の概念が増えている。

- parent pool
- rescue lane
- novelty rescue
- formal BT candidate
- formal BT passed
- failureReason
- repairHint
- EdgeHypothesis由来の親候補

このまま状態管理を曖昧にすると、`rescue候補`、`formal BT通過候補`、`repair対象`、`production候補` が混ざる。

PR #101 の目的は、これらを **EvolutionCandidateStage** と **PromotionGatePolicy** で整理し、ログとレポート上で追跡可能にすることである。

---

## このPRでやること

### 実装する

- `EvolutionCandidateStage` の定義
- `PromotionGateDecision` の定義
- `PromotionGatePolicy v1` の実装
- 候補ごとの stage 判定
- rescue / repair / formal BT / parent 利用の意味の分離
- `promotionGateSummary` の GenerationReport / smoke 出力
- `rescue != promotion` をコード上で固定
- `repairable != promoted` をコード上で固定
- 単体テスト
- 既存 parentPool / rescue lane / novelty / EdgeHypothesis / repairHint 経路の互換性維持

### 実装しない

- DB migration
- `EdgeStatus` enum の変更
- `StatusManager` の変更
- `confirmed` の意味変更
- `production_ready` の永続化
- OOS / walk-forward
- RepairHint Outcome Telemetry
- mutation budget 自動調整
- QualityDiversityArchive
- UI / dashboard
- formal BT 合格条件の緩和

---

## 基本方針

### 1. EdgeStatus と EvolutionCandidateStage を分ける

`EdgeStatus` は EdgeHypothesis の業務・仮説管理状態である。

`EvolutionCandidateStage` は、進化ループ内の候補がどの検証段階にいるかを表す。

この2つを混ぜない。

```text
EdgeStatus:
  EdgeHypothesis の状態

EvolutionCandidateStage:
  進化候補としての検証段階
```

### 2. DB保存しない v1 とする

PR #101 では migration を行わない。

`EvolutionCandidateStage` は GenerationReport / smoke / in-memory の判定として実装する。

永続化が必要になった場合は、後続PRで扱う。

### 3. formal BT pass は production ready ではない

正式BTに通った候補は強い候補ではなく、次の検証へ進める候補である。

```text
formal_bt_passed != validation_confirmed
formal_bt_passed != production_ready
```

### 4. rescue は昇格ではない

`near_miss_rescue`、`novelty_rescue`、`low_drawdown_rescue`、`trade_count_rescue` は、正式BTへ送る価値があるという意味であり、昇格ではない。

### 5. repairHint は昇格ではない

RepairHint は次世代 mutation の補助情報であり、候補を高評価する根拠ではない。

---

## 推奨ファイル構成

既存構成に合わせること。候補としては以下。

```text
src/side-b/evolution/promotionGatePolicy.ts
src/side-b/tests/evolution/promotionGatePolicy.test.ts
```

必要に応じて型だけ別ファイルに分けてもよい。

```text
src/side-b/evolution/evolutionCandidateStage.ts
```

ただし、`EvolutionLoop.ts` に stage 判定ロジック本体を書かない。  
`EvolutionLoop.ts` は orchestration のみに留める。

---

## 型定義

### EvolutionCandidateStage

```ts
// 進化候補としての検証段階
export type EvolutionCandidateStage =
  | 'generated'
  | 'parent_eligible'
  | 'surrogate_candidate'
  | 'formal_bt_candidate'
  | 'formal_bt_passed'
  | 'formal_bt_failed'
  | 'repairable'
  | 'repair_excluded'
  | 'validation_candidate'
  | 'validation_confirmed'
  | 'production_candidate'
  | 'rejected';
```

### PromotionGateDecisionKind

```ts
// PromotionGate の判定結果
export type PromotionGateDecisionKind =
  | 'hold'
  | 'promote_to_parent_eligible'
  | 'promote_to_formal_bt_candidate'
  | 'promote_to_formal_bt_passed'
  | 'promote_to_repairable'
  | 'promote_to_validation_candidate'
  | 'mark_repair_excluded'
  | 'mark_rejected';
```

### PromotionGateReason

```ts
// 判定理由
export type PromotionGateReason =
  | 'source_parent_pool'
  | 'normal_pass'
  | 'rescue_lane'
  | 'formal_bt_passed'
  | 'formal_bt_failed'
  | 'repair_hint_available'
  | 'repair_hint_fatal'
  | 'dsl_missing'
  | 'schema_validation_failed'
  | 'analysis_engine_error'
  | 'insufficient_metrics'
  | 'validation_not_run'
  | 'oos_not_run'
  | 'manual_hold'
  | 'unknown';
```

### PromotionGateDecision

```ts
// 候補ごとの PromotionGate 判定
export type PromotionGateDecision = {
  candidateId: string;
  dslId?: string;
  fromStage: EvolutionCandidateStage | null;
  toStage: EvolutionCandidateStage;
  decision: PromotionGateDecisionKind;
  reasons: PromotionGateReason[];
  route?: string;
  source?: string;
  failureReason?: string | null;
  formalBtPassed?: boolean | null;
  repairable?: boolean;
  productionEligible: boolean;
  warnings: string[];
};
```

### PromotionGateSummary

```ts
// GenerationReport / smoke に出す集計
export type PromotionGateSummary = {
  totalCandidates: number;
  byStage: Record<EvolutionCandidateStage, number>;
  byDecision: Record<PromotionGateDecisionKind, number>;
  byReason: Record<PromotionGateReason, number>;
  productionEligible: number;
  repairable: number;
  repairExcluded: number;
  warnings: string[];
};
```

---

## Stage 判定ルール

### generated

mutation / crossover / noveltySeed などで生成された直後の候補。

正式BTやsurrogateの結果はまだない。

### parent_eligible

親として利用可能な候補。

対象例:

- `formal_bt_passed` 由来
- `edge_confirmed` 由来
- `edge_screening_passed` 由来
- current population の有効候補

ただし、以下は除外。

- DSL missing
- schema validation failed
- repairHint fatal
- rejected
- analysis-engine structural error

### surrogate_candidate

surrogate 評価対象となる候補。

PR #101 では surrogate 閾値を変更しない。

### formal_bt_candidate

正式BTへ送る候補。

対象例:

- `normal_pass`
- `near_miss_rescue`
- `novelty_rescue`
- `low_drawdown_rescue`
- `trade_count_rescue`

重要:

```text
formal_bt_candidate は昇格ではない。
正式BTで確認する価値がある、という意味だけである。
```

### formal_bt_passed

正式BTに通過した候補。

ただし、production candidate ではない。

```text
formal_bt_passed → validation_candidate へ進む可能性がある
formal_bt_passed → production_candidate ではない
```

### formal_bt_failed

正式BTに失敗した候補。

failureReason がある場合、repair 判定へ進む。

### repairable

RepairHint があり、`shouldUseForRepairMutation=true` かつ `shouldExcludeFromParentPool=false` の候補。

repairable は昇格ではない。

次世代 mutation の修復素材として使えるという意味である。

### repair_excluded

以下のような候補。

- `dsl_missing`
- schema validation failed
- fatal RepairHint
- `shouldUseForRepairMutation=false`
- `shouldExcludeFromParentPool=true`

### validation_candidate

正式BT通過後、さらに検証へ進める候補。

PR #101 では OOS / walk-forward を実装しないため、ここは stage として定義するだけでよい。

### validation_confirmed

OOS / walk-forward / 追加検証を通過した候補。

PR #101 では実際にこの stage へ進めなくてよい。  
将来PRのために型として定義する。

### production_candidate

本番採用候補。

PR #101 では原則として production_candidate へ自動昇格しない。

`productionEligible` は常に false でもよい。  
ただし、既存コードで production 相当が明確にある場合のみ、後方互換を考慮する。

### rejected

明確に除外すべき候補。

- invalid DSL
- unrecoverable error
- lookahead suspected 相当
- 明らかな異常値

---

## PromotionGatePolicy v1

### 関数

```ts
export function decidePromotionGateV1(input: {
  candidateId: string;
  dslId?: string;
  currentStage?: EvolutionCandidateStage | null;
  source?: string;
  route?: string;
  formalBtPassed?: boolean | null;
  formalBtFailureReason?: string | null;
  repairHint?: {
    shouldUseForRepairMutation: boolean;
    shouldExcludeFromParentPool: boolean;
    severity: string;
  } | null;
  hasValidDsl?: boolean;
  schemaValidationPassed?: boolean;
  metrics?: {
    pf?: number | null;
    tradeCount?: number | null;
    maxDrawdown?: number | null;
    expectancy?: number | null;
  };
}): PromotionGateDecision;
```

既存型に合わせて input は調整してよい。  
ただし、判定ロジックは別ファイルに切り出す。

---

## PromotionGatePolicy 判定仕様

### DSL欠損

条件:

```text
hasValidDsl=false
```

結果:

```text
toStage = repair_excluded または rejected
decision = mark_repair_excluded または mark_rejected
reason = dsl_missing
productionEligible = false
```

### schema validation failed

条件:

```text
schemaValidationPassed=false
```

結果:

```text
toStage = rejected
decision = mark_rejected
reason = schema_validation_failed
productionEligible = false
```

### rescue route

条件:

```text
route in near_miss_rescue / novelty_rescue / low_drawdown_rescue / trade_count_rescue
```

結果:

```text
toStage = formal_bt_candidate
decision = promote_to_formal_bt_candidate
reason = rescue_lane
productionEligible = false
```

### normal_pass

条件:

```text
route = normal_pass
```

結果:

```text
toStage = formal_bt_candidate
decision = promote_to_formal_bt_candidate
reason = normal_pass
productionEligible = false
```

### formal BT passed

条件:

```text
formalBtPassed=true
```

結果:

```text
toStage = validation_candidate
decision = promote_to_validation_candidate
reason = formal_bt_passed
productionEligible = false
```

重要:

`formalBtPassed=true` でも `productionEligible=false` のままにする。

### formal BT failed + repairable

条件:

```text
formalBtPassed=false
repairHint.shouldUseForRepairMutation=true
repairHint.shouldExcludeFromParentPool=false
```

結果:

```text
toStage = repairable
decision = promote_to_repairable
reason = formal_bt_failed + repair_hint_available
productionEligible = false
```

### formal BT failed + fatal repairHint

条件:

```text
formalBtPassed=false
repairHint.shouldExcludeFromParentPool=true
```

結果:

```text
toStage = repair_excluded
decision = mark_repair_excluded
reason = formal_bt_failed + repair_hint_fatal
productionEligible = false
```

### parent source

条件:

```text
source in formal_bt_passed / edge_confirmed / edge_screening_passed / current_population
```

結果:

```text
toStage = parent_eligible
decision = promote_to_parent_eligible
reason = source_parent_pool
productionEligible = false
```

ただし DSL validation failure や fatal repairHint がある場合は除外を優先する。

---

## 優先順位

判定は以下の優先順位で行う。

```text
1. DSL missing / schema validation failed
2. fatal repairHint / repair excluded
3. formalBtPassed=true
4. formalBtPassed=false + repairable
5. route normal_pass / rescue lane
6. parent source
7. generated / hold
```

除外条件を最優先する。  
通過・昇格系の判定で invalid candidate を復活させない。

---

## GenerationReport への統合

`GenerationReport` に以下を optional で追加する。

```ts
promotionGateSummary?: PromotionGateSummary;
promotionGateDecisions?: PromotionGateDecision[];
```

大きな型変更が重い場合、まずは `promotionGateSummary` のみでもよい。

ただし、最低限 `promotionGateSummary` は smoke で観測できるようにする。

---

## smoke 出力

`scripts/evolution-pdca-smoke.ts` に以下を出す。

```text
--- promotionGateSummary ---
{
  "totalCandidates": 12,
  "byStage": {
    "generated": 4,
    "parent_eligible": 3,
    "formal_bt_candidate": 3,
    "validation_candidate": 1,
    "repairable": 1,
    "repair_excluded": 0,
    "rejected": 0
  },
  "byDecision": {
    "promote_to_parent_eligible": 3,
    "promote_to_formal_bt_candidate": 3,
    "promote_to_validation_candidate": 1,
    "promote_to_repairable": 1,
    "hold": 4
  },
  "byReason": {
    "source_parent_pool": 3,
    "rescue_lane": 2,
    "normal_pass": 1,
    "formal_bt_passed": 1,
    "repair_hint_available": 1
  },
  "productionEligible": 0,
  "repairable": 1,
  "repairExcluded": 0,
  "warnings": []
}
```

PR #101 では `productionEligible` は原則 0 でよい。

---

## テスト要件

### promotionGatePolicy.test.ts

以下を追加する。

1. DSL missing は `repair_excluded` または `rejected` になる
2. schema validation failed は `rejected` になる
3. `normal_pass` は `formal_bt_candidate` になる
4. rescue route は `formal_bt_candidate` になる
5. rescue route は productionEligible にならない
6. `formalBtPassed=true` は `validation_candidate` になる
7. `formalBtPassed=true` でも productionEligible=false のまま
8. formal BT failed + repairable hint は `repairable` になる
9. fatal repairHint は `repair_excluded` になる
10. parent source は `parent_eligible` になる
11. invalid DSL は parent source より除外判定が優先される
12. 判定理由が `reasons` に含まれる
13. `summarizePromotionGateDecisions` が stage ごとに集計する
14. `summarizePromotionGateDecisions` が decision ごとに集計する
15. `summarizePromotionGateDecisions` が reason ごとに集計する

### evolutionLoop test

必要なら最小限追加する。

1. `GenerationReport` に `promotionGateSummary` が含まれる
2. rescue候補が `formal_bt_candidate` として集計される
3. formal BT passed 候補が `validation_candidate` として集計される
4. repairHint fatal 候補が `repair_excluded` として集計される
5. promotionGateSummary がなくても既存経路は壊れない

---

## 実装制約

- `any` を使わない
- DB migration を追加しない
- EdgeStatus enum を変更しない
- StatusManager を変更しない
- `confirmed` の意味を変更しない
- formal BT 条件を緩和しない
- rescue候補を昇格扱いしない
- repairable候補を昇格扱いしない
- production_candidate へ自動昇格しない
- 既存 parentPool / rescue lane / novelty / EdgeHypothesis / repairHint 経路を壊さない

---

## 禁止事項

- `formalBtPassed=true` を production_ready と同義にしない
- rescue route を confirmed 扱いしない
- repairHint があるだけで候補を高評価しない
- EdgeStatus に `formal_bt_passed` などを追加しない
- DB schema を変更しない
- OOS / walk-forward をこのPRで追加しない
- outcome telemetry をこのPRで追加しない
- UI / dashboard をこのPRで作らない

---

## 完了条件

以下を満たしたら PR #101 完了。

- `EvolutionCandidateStage` が定義されている
- `PromotionGateDecision` が定義されている
- `PromotionGatePolicy v1` が実装されている
- rescue候補が `formal_bt_candidate` として扱われる
- formal BT passed 候補が `validation_candidate` として扱われる
- repairable候補が昇格ではなく修復素材として扱われる
- fatal / invalid 候補が除外される
- `promotionGateSummary` が GenerationReport または smoke で観測できる
- productionEligible が安易に true にならない
- DB migration なし
- EdgeStatus 変更なし
- StatusManager 変更なし
- 対象テストが通る
- smoke 実行で `parentPoolSummary` / `formalBtCandidateSummary` / `repairHintSummary` / `promotionGateSummary` が確認できる

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

---

## PR本文に記載すること

```md
## Summary
- EvolutionCandidateStage v1 を追加
- PromotionGatePolicy v1 を追加
- rescue / formal BT / repair / validation candidate の状態を分離
- promotionGateSummary を GenerationReport / smoke で観測可能にした

## Roadmap Note
- 本PRは正式な PR #101: Promotion Gate / EvolutionCandidateStage
- RepairHint Outcome Telemetry は PR #102 へ繰り下げ

## Scope
- DB migration なし
- EdgeStatus enum 変更なし
- StatusManager 変更なし
- production_ready 自動昇格なし
- OOS / walk-forward なし
- outcome telemetry なし

## Verification
- npx tsc --noEmit -p tsconfig.json
- npx jest src/side-b/tests/evolution/ src/side-b/tests/strategy_dsl/ src/side-b/tests/agents/ --silent
- set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3

## Smoke Observations
- parentPoolSummary:
- formalBtCandidateSummary:
- repairHintSummary:
- promotionGateSummary:
```

---

## 最重要判断基準

PR #101 の目的は、候補を強くすることではない。

目的は、候補の状態を整理し、以下を混同しないようにすることである。

```text
rescueされた
正式BTへ送る
正式BTに通った
修復対象になった
validation候補になった
production候補になった
```

このPRでは production への自動昇格は行わない。  
状態の整理と観測可能性を作る。

実装判断に迷った場合は、以下を優先する。

1. EdgeStatus と EvolutionCandidateStage を分ける
2. rescue を昇格扱いしない
3. formal BT passed を production扱いしない
4. repairable を昇格扱いしない
5. invalid / fatal を最優先で除外する
6. DB / StatusManager / OOS に触らない
7. PR #101 のスコープを小さく保つ

---

## エージェントへの最終指示

まず現在の `GenerationReport`、`formalBtCandidateSummary`、`repairHintSummary`、`EvolutionLoop`、`parentPoolPolicy`、`surrogateRescuePolicy` を確認すること。

その上で、最小差分で `promotionGatePolicy.ts` を追加し、候補状態の整理と `promotionGateSummary` の観測を実装すること。

このPRで目指すのは、自律進化の完成ではない。  
進化候補がどの段階にいるのかを、誤解なく判定・集計できる状態にすることである。

実装後は、型チェック、対象テスト、smoke を実行し、PR本文に `promotionGateSummary` の実測ログを貼ること。

