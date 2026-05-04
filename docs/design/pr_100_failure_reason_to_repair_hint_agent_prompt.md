# 実装指示: PR #100 FailureReason → RepairHint v1

## 位置づけ

この文書は **PR #100 専用の実装指示** である。

当初ロードマップでは `FailureReason → RepairHint v1` は PR #99 相当だったが、PR #99 は別問題として使用済みである。  
そのため、本PRは **元計画 PR #99 相当の内容を PR #100 として実装する**。

Promotion Gate / EvolutionCandidateStage 整理は、このPRでは扱わない。  
それは **PR #101 以降** に繰り下げる。

---

## これまでの前提

### PR #95

親個体プール v1 を実装済み。

- `formal_bt_passed`
- `current_population`
- `novelty_seed`

から親候補を取得できる。

### PR #96

Surrogate Rescue Lane を実装済み。

- `normal_pass`
- `near_miss_rescue`
- `novelty_rescue`
- `low_drawdown_rescue`
- `trade_count_rescue`
- `kill`

により、`normal_pass = 0` でも正式BT候補を抽出できる。

### PR #97

BehaviorDescriptorLite / Novelty Score を実装済み。

`novelty_rescue` が、StrategyDSL の構造差分を使って候補選抜できる。

### PR #98

EdgeHypothesis → StrategyDSL 逆変換 / 親プール統合を実装済み。

- `edge_confirmed`
- `edge_screening_passed`
- `edge_unverified`

を親候補ソースとして利用できる。

### PR #99

別問題として使用済み。

---

## PR #100 の目的

正式BT・surrogate・validation で失敗した候補について、既存の failure reason をもとに、次世代 mutation に渡せる **RepairHint v1** を生成する。

このPRの目的は、失敗理由を細かく増やすことではない。  
既存の failureReason 粒度を使い、まずは deterministic に修復方針を作る。

```text
failureReason
  ↓
repairHint
  ↓
mutation agent へ渡す文脈
  ↓
次世代では「ランダム変異」ではなく「失敗理由を直す変異」を行える
```

---

## このPRでやること

### 実装する

- 既存 failureReason の棚卸し
- FailureReason → RepairHint v1 の deterministic mapping
- rescue route / formal BT metrics / failureReason を含めた repair context 生成
- mutation agent へ repairHint を渡す経路
- `repairHintSummary` の GenerationReport / smoke 出力
- 単体テスト
- 既存 mutation / crossover / parentPool / rescue lane の互換性維持

### 実装しない

- FailureReason の13分類化
- analysis-engine の大改修
- LLM による failureReason 推定
- DB migration
- EdgeStatus enum の変更
- StatusManager の変更
- Promotion Gate
- EvolutionCandidateStage
- production_ready 昇格
- OOS / walk-forward
- QualityDiversityArchive
- EdgeHypothesis 逆変換の追加改修

---

## 基本方針

### 1. 既存 failureReason を使う

現時点で想定する failureReason は、既存コード上の分類を最優先する。

代表例:

```ts
// 既存分類を優先する。実装前に現在の classifyFailureReason を必ず確認すること。
export type FailureReasonV1 =
  | 'insufficient_trades'
  | 'low_pf'
  | 'analysis_engine_timeout'
  | 'analysis_engine_error'
  | 'dsl_missing'
  | 'other';
```

実コードに別名が存在する場合は、既存名に合わせる。  
このPRで無理に13分類へ拡張しない。

### 2. RepairHint は deterministic に生成する

LLMに「なぜ失敗したか」を推測させない。

RepairHint は、metrics / failureReason / route からコードで決定する。

### 3. RepairHint は昇格条件ではない

RepairHint は mutation の補助情報であり、候補の評価・昇格・採用を意味しない。

### 4. 失敗は捨てず、修復材料にする

ただし、以下は repair せず、親候補からも除外する。

- StrategyDSL validation failure
- `dsl_missing`
- lookahead suspected 相当
- 明らかな異常値
- analysis-engine の構造的エラー

---

## 推奨ファイル構成

既存構成に合わせること。候補としては以下。

```text
src/side-b/evolution/repairHintPolicy.ts
src/side-b/tests/evolution/repairHintPolicy.test.ts
```

既存の failureReason 分類ロジックが別ファイルにある場合は、そこを直接肥大化させず、RepairHint 生成は別ファイルへ切り出す。

`EvolutionLoop.ts` に mapping 本体を書かない。  
`EvolutionLoop.ts` は orchestration のみに留める。

---

## 型定義

### RepairHintSeverity

```ts
// 修復ヒントの強さ。mutation の変更幅制御に使う。
export type RepairHintSeverity = 'low' | 'medium' | 'high' | 'fatal';
```

### RepairTarget

```ts
// どの部分を修復対象にするか
export type RepairTarget =
  | 'entry'
  | 'exit'
  | 'risk'
  | 'filters'
  | 'timeframe'
  | 'parameters'
  | 'dsl_shape'
  | 'evaluation_runtime'
  | 'none';
```

### RepairHintAction

```ts
// mutation agent に渡す修復アクション
export type RepairHintAction = {
  target: RepairTarget;
  instruction: string;
  allowedChangeScope: 'small' | 'medium' | 'large' | 'none';
};
```

### RepairHint

```ts
// failureReason から生成する修復ヒント
export type RepairHint = {
  failureReason: string;
  severity: RepairHintSeverity;
  summary: string;
  actions: RepairHintAction[];
  mutationGuidance: string;
  shouldUseForRepairMutation: boolean;
  shouldExcludeFromParentPool: boolean;
  warnings: string[];
};
```

### RepairHintContext

```ts
// RepairHint 生成に使う評価文脈
export type RepairHintContext = {
  candidateId: string;
  dslId?: string;
  route?: string;
  failureReason: string;
  metrics?: {
    pf?: number | null;
    tradeCount?: number | null;
    maxDrawdown?: number | null;
    expectancy?: number | null;
  };
  notes?: string[];
};
```

### RepairHintSummary

```ts
// smoke / GenerationReport に出す集計
export type RepairHintSummary = {
  totalFailures: number;
  repairable: number;
  excluded: number;
  byFailureReason: Record<string, number>;
  bySeverity: Record<RepairHintSeverity, number>;
  byRoute: Record<string, number>;
  warnings: string[];
};
```

---

## mapping 仕様

### createRepairHintV1

```ts
export function createRepairHintV1(context: RepairHintContext): RepairHint;
```

### insufficient_trades

意味:

- 取引回数が不足している
- entry 条件が厳しすぎる可能性がある
- timeframe / filter / session 条件が狭すぎる可能性がある

RepairHint:

```ts
{
  severity: 'medium',
  actions: [
    {
      target: 'entry',
      instruction: 'entry条件が厳しすぎる可能性があるため、閾値・比較条件・必要条件数を少し緩和する',
      allowedChangeScope: 'medium',
    },
    {
      target: 'filters',
      instruction: 'filter条件が多すぎる場合は、最も寄与の低いfilterを1つだけ削る',
      allowedChangeScope: 'small',
    },
  ],
  mutationGuidance: '取引回数を増やす方向で修復する。ただし、entry条件を無制限に緩めず、元の仮説の中核条件を1つ以上残す。',
  shouldUseForRepairMutation: true,
  shouldExcludeFromParentPool: false,
}
```

### low_pf

意味:

- 取引はあるが PF が低い
- entry 精度、exit、risk reward、ノイズ除去に問題がある可能性

RepairHint:

```ts
{
  severity: 'medium',
  actions: [
    {
      target: 'exit',
      instruction: '利確・損切り・trailing の条件を見直し、損小利大または損失抑制を改善する',
      allowedChangeScope: 'medium',
    },
    {
      target: 'filters',
      instruction: 'ノイズの多いentryを減らすため、trend / volatility / price action filter を1つ追加または調整する',
      allowedChangeScope: 'small',
    },
  ],
  mutationGuidance: 'PF改善を目的に、entry精度またはexit設計を改善する。条件を増やしすぎず、変更点は最大2箇所に抑える。',
  shouldUseForRepairMutation: true,
  shouldExcludeFromParentPool: false,
}
```

### analysis_engine_timeout

意味:

- 評価処理が重すぎる
- 条件数、indicator数、探索範囲、データ範囲が重い可能性

RepairHint:

```ts
{
  severity: 'high',
  actions: [
    {
      target: 'dsl_shape',
      instruction: '条件数やindicator参照数を減らし、評価可能な単純な形にする',
      allowedChangeScope: 'medium',
    },
    {
      target: 'evaluation_runtime',
      instruction: '複雑な複数条件・複数時間足・重いindicatorの組み合わせを避ける',
      allowedChangeScope: 'medium',
    },
  ],
  mutationGuidance: '評価可能性を優先し、戦略構造を単純化する。性能改善よりもまずanalysis-engineが完走できる形にする。',
  shouldUseForRepairMutation: true,
  shouldExcludeFromParentPool: false,
}
```

### analysis_engine_error

意味:

- analysis-engine 側で実行エラー
- DSL構造、データ整合性、未対応演算子の可能性

RepairHint:

```ts
{
  severity: 'high',
  actions: [
    {
      target: 'dsl_shape',
      instruction: '未対応の演算子・不正な条件構造・欠損フィールドを避け、StrategyDSL schema に沿った単純な構造へ修正する',
      allowedChangeScope: 'medium',
    },
  ],
  mutationGuidance: '性能改善ではなく、まずanalysis-engineで実行できるDSL形状へ修復する。',
  shouldUseForRepairMutation: true,
  shouldExcludeFromParentPool: false,
}
```

### dsl_missing

意味:

- StrategyDSL が存在しない
- mutation / formal BT の入力として使えない

RepairHint:

```ts
{
  severity: 'fatal',
  actions: [
    {
      target: 'none',
      instruction: 'StrategyDSL が存在しないため、この候補はrepair mutation対象にしない',
      allowedChangeScope: 'none',
    },
  ],
  mutationGuidance: 'DSL欠損候補は修復変異に使わず、親候補から除外する。EdgeHypothesis由来の場合は別途DSL変換経路で扱う。',
  shouldUseForRepairMutation: false,
  shouldExcludeFromParentPool: true,
}
```

### other

意味:

- 失敗理由が曖昧
- 安全な小変更のみ許可

RepairHint:

```ts
{
  severity: 'low',
  actions: [
    {
      target: 'parameters',
      instruction: '失敗理由が不明なため、変更幅を小さくし、主要ロジックは維持したまま閾値を微調整する',
      allowedChangeScope: 'small',
    },
  ],
  mutationGuidance: '不明理由のため大改変しない。元の仮説の中核を維持し、1〜2個のパラメータのみ小さく変更する。',
  shouldUseForRepairMutation: true,
  shouldExcludeFromParentPool: false,
}
```

---

## metrics による補足調整

failureReason だけでなく、metrics が取れる場合は hint を補強する。

### tradeCount = 0

`failureReason` が `insufficient_trades` かつ `tradeCount = 0` の場合:

- severity を `high` に上げる
- entry / filter 条件が極端に厳しい可能性を warning に追加

### PF が極端に低い

`pf < 0.8` の場合:

- risk / exit の見直しを強める
- `low_pf` の warning に「PFが極端に低い」を追加

### maxDrawdown が大きい

`maxDrawdown` が取れる場合:

- risk / stopLoss / position sizing の action を追加してよい

ただし、このPRで新しい failureReason 名を増やさない。  
あくまで existing failureReason に対する補足に留める。

---

## mutation agent への統合

### 目的

mutation agent に対して、repairHint を入力文脈として渡す。

### 渡す情報

mutation prompt または mutation payload に以下を追加する。

```ts
repairHint?: RepairHint;
```

既存 mutation agent の interface 変更が重い場合は、まず metadata / context の optional field として追加する。

### mutation agent に守らせること

repairHint がある場合、mutation agent は以下を守る。

```text
- repairHint.actions の target を優先して変更する
- allowedChangeScope を超える大改変をしない
- shouldUseForRepairMutation=false の候補は mutation 対象にしない
- 元の仮説の中核条件を最低1つ残す
- 変更点と repairHint への対応を出力 metadata に残す
```

### 出力 metadata

可能なら mutation 結果に以下を残す。

```ts
repairApplied?: {
  failureReason: string;
  targets: RepairTarget[];
  summary: string;
};
```

大きな型変更になる場合は、PR #100 ではログ出力だけでもよい。  
ただし、repairHint が mutation に渡ったことはテストまたはログで確認できるようにする。

---

## formal BT / rescue route との統合

正式BTで落ちた候補について、以下を repair context に含める。

- candidateId
- dslId
- route
- failureReason
- pf
- tradeCount
- maxDrawdown
- expectancy

特に PR #96 / #97 で追加された route を活用する。

例:

```text
route=trade_count_rescue
failureReason=insufficient_trades
tradeCount=0
```

この場合、RepairHint は以下のような方向になる。

```text
trade_count_rescue で拾われたが formal BT では tradeCount=0。
surrogate と formal BT の評価差があるため、entry条件またはDSL解釈差を疑う。
entry条件を緩和しつつ、DSL構造を単純化する。
```

---

## repairHintSummary

GenerationReport または smoke に以下を追加する。

```text
--- repairHintSummary ---
{
  "totalFailures": 3,
  "repairable": 2,
  "excluded": 1,
  "byFailureReason": {
    "insufficient_trades": 1,
    "low_pf": 1,
    "dsl_missing": 1
  },
  "bySeverity": {
    "low": 0,
    "medium": 2,
    "high": 0,
    "fatal": 1
  },
  "byRoute": {
    "trade_count_rescue": 1,
    "novelty_rescue": 1,
    "unknown": 1
  },
  "warnings": []
}
```

既存 GenerationReport の型変更が大きい場合は、`repairHintSummary` を optional にする。

---

## テスト要件

### repairHintPolicy.test.ts

以下を追加する。

1. `insufficient_trades` から entry / filters 修復ヒントが生成される
2. `low_pf` から exit / filters 修復ヒントが生成される
3. `analysis_engine_timeout` から dsl_shape / evaluation_runtime 修復ヒントが生成される
4. `analysis_engine_error` から dsl_shape 修復ヒントが生成される
5. `dsl_missing` は `shouldUseForRepairMutation=false` かつ `shouldExcludeFromParentPool=true`
6. `other` は小変更のみ許可される
7. `tradeCount=0` の場合、`insufficient_trades` の severity が high になる
8. `pf < 0.8` の場合、low_pf に warning が追加される
9. 未知の failureReason でも例外を投げず `other` 相当で扱う
10. RepairHintSummary が failureReason / severity / route ごとに集計される

### mutation integration test

可能なら以下を追加する。

1. repairHint がある candidate は mutation input に repairHint を含む
2. `shouldUseForRepairMutation=false` の candidate は repair mutation 対象から除外される
3. repairHint がない場合、既存 mutation 挙動が変わらない

### evolutionLoop test

必要なら最小限追加する。

1. formal BT failure から `repairHintSummary` が生成される
2. route 情報が `repairHintSummary.byRoute` に反映される
3. `dsl_missing` / fatal 系は repairable に入らない

---

## smoke 出力

`scripts/evolution-pdca-smoke.ts` に、可能であれば以下を出す。

```text
--- repairHintSummary ---
...
```

さらに、正式BT失敗候補ごとの short log を出せるなら出す。

```text
repairHint candidate=<id> route=trade_count_rescue reason=insufficient_trades severity=high target=entry,filters
repairHint candidate=<id> route=novelty_rescue reason=low_pf severity=medium target=exit,filters
```

---

## 実装制約

- `any` を使わない
- 既存 failureReason 名を優先する
- FailureReason 13分類をこのPRで作らない
- DB migration を追加しない
- EdgeStatus enum を変更しない
- LLMに failureReason / repairHint を推測させない
- Promotion Gate を追加しない
- `confirmed` の意味を変更しない
- rescue 候補を昇格扱いしない
- fatal candidate を mutation 親にしない
- 既存 parentPool / rescue lane / novelty / EdgeHypothesis 経路を壊さない

---

## 禁止事項

- repairHint を根拠に formal BT の合格条件を緩めない
- `repairHint` があるだけで候補を高評価しない
- `dsl_missing` をLLMで勝手に補完しない
- analysis-engine error を握りつぶして正常扱いしない
- `tradeCount=0` 候補を無条件に救済し続けない
- mutation agent に「良い感じに直して」と丸投げしない
- 失敗理由が不明なのに大改変しない

---

## 完了条件

以下を満たしたら PR #100 完了。

- `createRepairHintV1` が実装されている
- 既存 failureReason から deterministic に RepairHint が生成される
- `dsl_missing` など fatal 系が repair mutation 対象から除外される
- metrics による補足調整が入っている
- mutation agent へ repairHint を渡せる
- `repairHintSummary` が GenerationReport または smoke で観測できる
- rescue route ごとの failure / repair 傾向が追える
- 既存 mutation / crossover / parentPool / rescue lane / novelty / EdgeHypothesis 経路が壊れていない
- DB migration なし
- EdgeStatus 変更なし
- 対象テストが通る
- smoke 実行で `parentPoolSummary` / `formalBtCandidateSummary` / `repairHintSummary` が確認できる

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
- FailureReason → RepairHint v1 を追加
- existing failureReason を deterministic に修復方針へ変換
- mutation agent に repairHint を渡せるようにした
- repairHintSummary を GenerationReport / smoke で観測可能にした

## Roadmap Note
- 本PRは元計画 PR #99 相当
- 実PR #99 は別問題で使用済みのため、本内容を PR #100 として実装
- Promotion Gate / EvolutionCandidateStage は PR #101 以降へ繰り下げ

## Scope
- DB migration なし
- EdgeStatus enum 変更なし
- FailureReason 13分類化なし
- analysis-engine 大改修なし
- LLM補完なし
- Promotion Gate なし

## Verification
- npx tsc --noEmit -p tsconfig.json
- npx jest src/side-b/tests/evolution/ src/side-b/tests/strategy_dsl/ src/side-b/tests/agents/ --silent
- set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3

## Smoke Observations
- parentPoolSummary:
- formalBtCandidateSummary:
- repairHintSummary:
```

---

## 最重要判断基準

PR #100 の目的は、失敗理由を賢そうに説明することではない。

目的は、次世代 mutation が以下をできるようにすることである。

```text
なぜ失敗したかを受け取る
  ↓
どこを直すべきかを知る
  ↓
変更幅を制限する
  ↓
同じ失敗を少し減らす
```

このPRでは、失敗理由の粒度を無理に増やさない。  
まずは既存分類を使い、修復方向を安定して生成する。

実装判断に迷った場合は、以下を優先する。

1. deterministic mapping にする
2. 既存 failureReason を尊重する
3. mutation に渡せる形にする
4. fatal candidate を除外する
5. route / metrics / failureReason を summary で観測可能にする
6. DB / status / promotion に触らない
7. PR #100 のスコープを小さく保つ

---

## エージェントへの最終指示

まず現在の `classifyFailureReason`、formal BT failure の記録箇所、mutation agent の input schema、GenerationReport の構造を確認すること。

その上で、最小差分で `repairHintPolicy.ts` を追加し、既存 failureReason から RepairHint v1 を生成すること。

このPRで目指すのは、自律進化の完成ではない。  
失敗した候補を、次世代 mutation の修復材料として使える状態にすることである。

実装後は、型チェック、対象テスト、smoke を実行