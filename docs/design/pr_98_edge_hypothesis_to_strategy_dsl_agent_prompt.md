# 実装指示: PR #98 EdgeHypothesis → StrategyDSL 逆変換 / 親プール統合

## 位置づけ

この文書は **PR #98 専用の実装指示** である。

PR #95 では、親個体プール v1 により `formal_bt_passed / current_population / novelty_seed` の3系統から mutation / crossover の親候補を取得できるようになった。

PR #96 では、Surrogate Rescue Lane により `normal_pass = 0` の世代でも、rescue route 経由で正式BT候補を抽出できるようになった。

PR #97 では、BehaviorDescriptorLite / Novelty Score により `novelty_rescue` が StrategyDSL の構造差分を見て候補を選べるようになった。

PR #98 では、これまで進化ループの外側にあった `EdgeHypothesis` 資産を、進化ループの親素材として使えるようにする。

ただし、このPRでは `EdgeStatus` enum の拡張、DB migration、LLM補完、QualityDiversityArchive、Promotion Gate は扱わない。

---

## 目的

既存の `EdgeHypothesis` を安全に `StrategyDSL` へ逆変換し、親個体プールのソースに以下を追加する。

- `edge_confirmed`
- `edge_screening_passed`
- `edge_unverified`

これにより、過去に作成・選別された仮説を mutation / crossover の親として利用できるようにする。

---

## このPRでやること

### 実装する

- `EdgeHypothesis → StrategyDSL` の逆変換ユーティリティ
- 変換結果の `ok / failureReason / warnings` 付き返却
- `StrategyDSLSchema` による変換後 validation
- 親個体プールへの `EdgeHypothesis` 系ソース追加
- `parentPoolSummary` への EdgeHypothesis 系件数追加
- 変換不能な EdgeHypothesis の warning / skipped 件数の観測
- 単体テスト
- smoke CLI で parentPoolSummary の新ソースを観測可能にする

### 実装しない

- DB migration
- `EdgeStatus` enum の変更
- `StatusManager` の変更
- `confirmed` の意味変更
- `surrogate_passed / formal_bt_passed / production_ready` などの状態追加
- LLMによる欠損DSL補完
- `EdgeHypothesis` の永続データ更新
- QualityDiversityArchive 本体
- FailureReason 13分類化
- RepairMutation
- OOS / walk-forward / Promotion Gate

---

## 重要な前提

### EdgeStatus は変更しない

現コードの `EdgeStatus` は以下のような仮説管理用ステータスであり、進化候補の検証ステージではない。

```text
unverified
screening_passed
testing
confirmed
stale
rejected
insufficient_data
not_testable
```

このPRでは、`surrogate_passed / formal_bt_passed / walk_forward_passed / oos_passed / production_ready` などを追加しない。

### confirmed の意味を変えない

現コードの `confirmed` は、進化途中の `formal_bt_passed` ではなく、より上位の検証済み仮説に近い意味で扱われている。

そのため、PR #98 では `confirmed` を「本番採用済み」や「production_ready」として扱わない。  
あくまで、親素材として利用可能な EdgeHypothesis ソースの1つとして扱う。

### 逆変換は完全復元ではない

`EdgeHypothesis` は `StrategyDSL` と同じ情報をすべて持っているとは限らない。  
特に `parameters` は欠損しやすいため、無理に補完しない。

変換できないものは捨てず、`failureReason` と `warnings` に残す。

---

## 推奨ファイル構成

既存構成に合わせること。候補としては以下。

```text
src/side-b/evolution/dslFromHypothesis.ts
src/side-b/tests/evolution/dslFromHypothesis.test.ts
```

親プール側の変更は既存ファイルに合わせる。

```text
src/side-b/evolution/parentPoolPolicy.ts
src/side-b/tests/evolution/parentPool.test.ts
```

`EvolutionLoop.ts` に逆変換ロジックを直接書かない。  
`EvolutionLoop.ts` は orchestration のみに留める。

---

## 型定義

### DslFromHypothesisFailureReason

```ts
// EdgeHypothesis から StrategyDSL に復元できない理由
export type DslFromHypothesisFailureReason =
  | 'missing_hypothesis_id'
  | 'missing_conditions'
  | 'unsupported_condition_shape'
  | 'unsupported_direction'
  | 'missing_symbol'
  | 'missing_timeframe'
  | 'missing_regime_target'
  | 'missing_risk_rule'
  | 'schema_validation_failed'
  | 'unsupported_shape';
```

### DslFromHypothesisResult

```ts
// EdgeHypothesis → StrategyDSL 逆変換の結果
export type DslFromHypothesisResult = {
  ok: boolean;
  strategyDsl?: StrategyDSL;
  failureReason?: DslFromHypothesisFailureReason;
  warnings: string[];
};
```

### EdgeHypothesisParentLoadSummary

```ts
// EdgeHypothesis 系親候補のロード・変換サマリ
export type EdgeHypothesisParentLoadSummary = {
  requested: {
    edge_confirmed: number;
    edge_screening_passed: number;
    edge_unverified: number;
  };
  loaded: {
    edge_confirmed: number;
    edge_screening_passed: number;
    edge_unverified: number;
  };
  converted: {
    edge_confirmed: number;
    edge_screening_passed: number;
    edge_unverified: number;
  };
  skipped: number;
  warnings: string[];
};
```

大きな型追加が重い場合は、まず `ParentPoolSummary` の `fallbackReason` と `metadata` 的な項目に含めてもよい。  
ただし、変換不能件数は必ず観測可能にする。

---

## 逆変換関数

### 関数名

```ts
export function dslFromHypothesis(hypothesis: EdgeHypothesis): DslFromHypothesisResult;
```

または既存命名に合わせて以下でもよい。

```ts
export function convertEdgeHypothesisToStrategyDsl(
  hypothesis: EdgeHypothesis,
): DslFromHypothesisResult;
```

### 必須仕様

- 変換後は必ず `StrategyDSLSchema.safeParse` する
- 失敗時は `ok: false` を返し、例外を投げない
- 変換不能な項目は `warnings` に残す
- `parameters` を無理に生成しない
- LLM補完を呼ばない
- 未来データやバックテスト結果をDSLに混ぜない
- `metadata` に元の EdgeHypothesis ID と status を残す

---

## StrategyDSL へのマッピング方針

実コードの `StrategyDSL` schema を必ず確認してから実装すること。  
以下は方針であり、存在しないプロパティを仮定してはいけない。

### id

安定したIDを生成する。

```text
edge-hypothesis-{hypothesis.id}
```

同じ EdgeHypothesis から毎回異なる DSL ID を作らない。  
同一仮説の重複投入を防ぐため。

### generation

EdgeHypothesis 起点の親素材であるため、以下のいずれかにする。

```ts
0
```

または既存ルールに合わせて、親プール側で扱いやすい値にする。

### parentIds

EdgeHypothesis の ancestry が取れない場合は空配列にする。

```ts
[]
```

### regimeTarget

- EdgeHypothesis に regime 情報があれば使用
- なければ `'unknown'`
- ただし StrategyDSL schema が `unknown` を許さない場合は、その schema に合わせて安全な既定値を選ぶ

### symbol

- EdgeHypothesis に symbol があれば使用
- ない場合は `missing_symbol` で変換失敗
- 勝手に `EURUSD` などへ補完しない

### timeframe

- EdgeHypothesis に timeframe があれば使用
- `normalizeTimeframe` が既存経路で使われている場合は同じ正規化を使う
- ない場合は `missing_timeframe` で変換失敗
- 勝手に既定timeframeへ補完しない。ただし既存コードが明示的に DEFAULT_TIMEFRAME を使う設計なら、その設計に合わせ、warning を残す

### entry

EdgeHypothesis の条件から StrategyDSL の `entry.trigger.conditions` を作る。

可能な範囲だけ対応する。

対応例:

- indicator comparison
- price comparison
- crossover / crossunder
- threshold 条件
- AND / OR 条件

未対応例:

- 自然言語だけの曖昧な条件
- 複数時間足の複雑な条件
- 条件式として構造化されていないメモ
- DSLに存在しない独自演算子

未対応の場合は `unsupported_condition_shape` または `missing_conditions` を返す。

### direction

- `long` / `short` / `both` など StrategyDSL が許容する値にマッピング
- 不明・未対応なら `unsupported_direction`
- 勝手に `long` へ寄せない

### stopLoss / takeProfit

EdgeHypothesis に SL / TP / RR / ATR などの risk rule がある場合のみ変換する。

- fixed pips
- percent
- rr_ratio
- atr_multiple
- trailing

上記のうち、実DSL schema が対応するものだけ扱う。

risk rule が存在せず、StrategyDSL が必須としている場合は `missing_risk_rule` で失敗させる。

### parameters

EdgeHypothesis に対応パラメータがない場合は以下でよい。

```ts
parameters: {}
```

ただし、DSL条件内で明示的な値が取れる場合は、必要に応じて condition value 側に入れる。  
`parameters` に無理に抽象化しない。

### metadata

以下を入れる。

```ts
metadata: {
  createdAt: new Date().toISOString(),
  createdBy: 'edge_hypothesis_import',
  source: 'edge_hypothesis',
  sourceEdgeHypothesisId: hypothesis.id,
  sourceEdgeStatus: hypothesis.status,
}
```

schema が追加metadataを許さない場合は、許容される範囲で最小情報のみ残す。

---

## 親プール統合

### ParentPoolSource の拡張

既存の source に以下を追加する。

```ts
export type ParentPoolSource =
  | 'formal_bt_passed'
  | 'current_population'
  | 'novelty_seed'
  | 'edge_confirmed'
  | 'edge_screening_passed'
  | 'edge_unverified';
```

`rejected` は親ソースに入れない。

### parentPoolPolicyV2

PR #98 で以下の配分に更新する。

```ts
// EdgeHypothesis 統合後の親個体プール配分
export const parentPoolPolicyV2 = {
  edge_confirmed: 0.25,
  edge_screening_passed: 0.35,
  formal_bt_passed: 0.20,
  current_population: 0.10,
  edge_unverified: 0.05,
  novelty_seed: 0.05,
} as const;
```

ただし、実装上は固定比率だけに依存しない。  
PR #95 と同じく、存在しないソースは fallback する。

### fallback 方針

| 不足ソース | 優先fallback先 |
|---|---|
| `edge_confirmed` 不足 | `edge_screening_passed` → `formal_bt_passed` → `current_population` |
| `edge_screening_passed` 不足 | `formal_bt_passed` → `current_population` |
| `formal_bt_passed` 不足 | `current_population` → `novelty_seed` |
| `current_population` 不足 | `novelty_seed` |
| `edge_unverified` 不足 | `novelty_seed` |

fallback は必ず `fallbackReason` に残す。

---

## EdgeHypothesis のロード方針

既存 repository / service がある場合はそれを使う。  
存在しない場合は、PR #98 用に最小の interface を切る。

```ts
export type EdgeHypothesisParentSource = {
  findRecentByStatus(status: EdgeStatus, limit: number): Promise<EdgeHypothesis[]>;
};
```

または既存命名に合わせること。

### 例外処理

EdgeHypothesis repository が落ちても、世代は継続する。

- `console.warn` または既存 logger に warning を出す
- `fallbackReason` に repo error を残す
- 該当ソースは空扱いにする
- `current_population / novelty_seed` でfallbackする

PR #95 の formal BT repo error と同じ思想にする。

---

## 重複排除

以下の単位で重複排除する。

- `StrategyDSL.id`
- `sourceEdgeHypothesisId`
- 既存の `candidateHash` / `hashStrategyDsl` がある場合はそれも使う

同一 EdgeHypothesis が複数statusや複数ロード経路から入った場合、優先順位は以下。

```text
edge_confirmed
  > edge_screening_passed
  > formal_bt_passed
  > current_population
  > edge_unverified
  > novelty_seed
```

重複削除件数を summary または fallbackReason / warnings に残す。

---

## parentPoolSummary の期待形

PR #98 後、smoke で以下のような情報が見えること。

```json
{
  "requested": {
    "edge_confirmed": 2,
    "edge_screening_passed": 2,
    "formal_bt_passed": 1,
    "current_population": 1,
    "edge_unverified": 0,
    "novelty_seed": 0
  },
  "selected": {
    "edge_confirmed": 1,
    "edge_screening_passed": 2,
    "formal_bt_passed": 1,
    "current_population": 1,
    "edge_unverified": 0,
    "novelty_seed": 0
  },
  "fallbackApplied": true,
  "fallbackReason": "edge_confirmed shortage=1; filled from edge_screening_passed",
  "totalSelected": 5
}
```

実際の件数は問わない。  
重要なのは、EdgeHypothesis 系ソースの requested / selected / fallback が観測できること。

---

## smoke 出力

`scripts/evolution-pdca-smoke.ts` で既存の `parentPoolSummary` をそのまま表示できればよい。

可能なら、EdgeHypothesis 逆変換サマリも追加する。

```text
--- edgeHypothesisParentSummary ---
loaded:
  edge_confirmed:
  edge_screening_passed:
  edge_unverified:
converted:
  edge_confirmed:
  edge_screening_passed:
  edge_unverified:
skipped:
warnings:
```

大きな変更になる場合は、`parentPoolSummary.fallbackReason` に変換不能理由を含めるだけでもよい。  
ただし、変換不能が完全に不可視になる実装は禁止。

---

## テスト要件

### dslFromHypothesis.test.ts

以下を追加する。

1. 構造化済み conditions を持つ EdgeHypothesis を StrategyDSL に変換できる
2. 変換後 DSL が `StrategyDSLSchema` を通過する
3. `metadata` に `sourceEdgeHypothesisId` と `sourceEdgeStatus` が残る
4. conditions が空なら `missing_conditions` で `ok=false`
5. 未対応 direction なら `unsupported_direction` で `ok=false`
6. symbol がなければ `missing_symbol` で `ok=false`
7. timeframe がなければ `missing_timeframe` または warning 付き既定値になる
8. risk rule が必須なのに欠損していれば `missing_risk_rule` で `ok=false`
9. schema validation 失敗時に `schema_validation_failed` で `ok=false`
10. parameters がなくても `{}` として扱える
11. 変換不能でも例外を投げない
12. 同じ EdgeHypothesis から安定した DSL id が生成される

### parentPool.test.ts

以下を追加する。

1. `edge_confirmed` が親候補として選ばれる
2. `edge_screening_passed` が親候補として選ばれる
3. `edge_unverified` は低優先で選ばれる
4. `rejected / stale / insufficient_data / not_testable` は親候補に入らない
5. EdgeHypothesis repository 例外時も世代継続できる
6. 変換不能 EdgeHypothesis は skipped され、warning / fallbackReason に残る
7. EdgeHypothesis 系ソース不足時に fallback が効く
8. 同一 EdgeHypothesis の重複が除外される
9. `parentPoolSummary` に EdgeHypothesis 系 requested / selected が出る
10. `formal_bt_passed / current_population / novelty_seed` の既存挙動が壊れていない

### evolutionLoop.test.ts

必要なら最小限追加する。

1. EdgeHypothesis 親ソースが存在する場合、mutationAgent に渡る parentDsls に含まれる
2. EdgeHypothesis repo が落ちても `runOneGeneration` が落ちない
3. `parentPoolSummary` に EdgeHypothesis fallbackReason が残る

---

## 実装制約

- `any` を使わない
- DB migration を追加しない
- EdgeStatus enum を変更しない
- StatusManager を変更しない
- LLM補完を呼ばない
- 変換できない EdgeHypothesis を無理に親にしない
- `confirmed` の意味を変更しない
- `rejected` を親にしない
- StrategyDSL schema validation を必ず通す
- validation error を握りつぶさない
- `EvolutionLoop.ts` を肥大化させない
- 既存 parentPool / rescue lane / novelty score を壊さない

---

## 禁止事項

- `EdgeHypothesis` の自然言語説明から勝手に条件を生成しない
- LLMに DSL 復元を任せない
- symbol / timeframe / direction / risk を勝手に都合よく補完しない
- `confirmed` を production_ready として扱わない
- `edge_unverified` を高比率で親にしない
- `rejected` や `not_testable` を親にしない
- `surrogate_passed` や `formal_bt_passed` を EdgeStatus に追加しない
- DB schema を変更しない
- QualityDiversityArchive を作らない
- FailureReason 13分類を作らない

---

## 完了条件

以下を満たしたら PR #98 完了。

- `EdgeHypothesis → StrategyDSL` 逆変換関数が実装されている
- 変換後DSLが `StrategyDSLSchema` で検証される
- 変換不能な EdgeHypothesis が failureReason / warnings 付きで skipped される
- 親プールに `edge_confirmed / edge_screening_passed / edge_unverified` が追加されている
- `parentPoolSummary` で EdgeHypothesis 系ソースの requested / selected が観測できる
- EdgeHypothesis repo 例外時も世代継続できる
- 既存 `formal_bt_passed / current_population / novelty_seed` の挙動が壊れていない
- mutation / crossover が EdgeHypothesis 由来DSLを親として使える
- DB migration なし
- EdgeStatus 変更なし
- 対象テストが通る
- smoke 実行で `parentPoolSummary` と `formalBtCandidateSummary` が確認できる

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

PR本文には以下を必ず書く。

```md
## Summary
- EdgeHypothesis → StrategyDSL 逆変換を追加
- edge_confirmed / edge_screening_passed / edge_unverified を親プールに統合
- 変換不能な EdgeHypothesis を failureReason / warnings 付きで skipped するようにした
- parentPoolSummary で EdgeHypothesis 系ソースを観測可能にした

## Scope
- DB migration なし
- EdgeStatus enum 変更なし
- StatusManager 変更なし
- LLM補完なし
- QualityDiversityArchive なし
- production_ready 昇格なし

## Verification
- npx tsc --noEmit -p tsconfig.json
- npx jest src/side-b/tests/evolution/ src/side-b/tests/strategy_dsl/ src/side-b/tests/agents/ --silent
- set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3

## Smoke Observations
- parentPoolSummary:
- edgeHypothesis conversion warnings:
- formalBtCandidateSummary:
```

---

## 最重要判断基準

PR #98 の目的は、EdgeHypothesis を完全な StrategyDSL に魔改造することではない。

目的は、**変換できる仮説だけを安全に親素材へ取り込むこと** である。

```text
EdgeHypothesis
  ↓
安全に変換できるか判定
  ↓
StrategyDSL schema validation
  ↓
親プールへ投入
  ↓
mutation / crossover の親素材として利用
```

変換できないものは失敗ではない。  
失敗理由付きで skipped できれば成功である。

実装判断に迷った場合は、以下を優先する。

1. 変換できないものを無理に変換しない
2. LLM補完を使わない
3. EdgeStatus / DB schema を触らない
4. failureReason / warnings を必ず残す
5. 親利用と昇格判定を混同しない
6. 既存 parentPool / rescue lane / novelty score を壊さない
7. PR #98 のスコープを小さく保つ

---

## エージェントへの最終指示

まず現在の `EdgeHypothesis` model、EdgeHypothesis repository / service、`StrategyDSL` schema、`parentPoolPolicy.ts` を確認すること。

その上で、最小差分で `dslFromHypothesis.ts` を追加し、変換できる EdgeHypothesis のみを親プールに統合すること。

このPRで目指すのは、自律進化の完成ではない。  
既存の仮説資産を、進化ループの親素材として安全に再利用できるようにすることである。

実装後は、型チェック、対象テスト、smoke を実行し、PR本文に `parentPoolSummary` と EdgeHypothesis 変換サマリを貼ること。

