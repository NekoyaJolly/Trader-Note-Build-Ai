# 実装指示: PR #97 BehaviorDescriptor Lite / Novelty Score

## 位置づけ

この文書は **PR #97 専用の実装指示** である。

PR #95 では、親個体プール v1 により `formal_bt_passed / current_population / novelty_seed` の3系統から mutation / crossover の親候補を取得できるようになった。

PR #96 では、Surrogate Rescue Lane により `normal_pass = 0` の世代でも、`near_miss_rescue / low_drawdown_rescue / trade_count_rescue / novelty_rescue` から正式BT候補を抽出できるようになった。

PR #97 では、PR #96 で簡易実装された `novelty_rescue` を改善する。

現状の novelty は、厳密な構造差分ではなく、未選択候補の中から1件を拾う程度の軽量実装である。  
このPRでは、DB保存なし・migrationなしで、StrategyDSL から軽量な振る舞い記述子 `BehaviorDescriptorLite` を抽出し、既存候補との構造的な違いをもとに novelty score を計算する。

---

## 目的

`novelty_rescue` を以下の状態へ改善する。

```text
現状:
  score 上位や他 rescue lane で未選択の候補から、比較的雑に1件拾う

PR #97 後:
  DSL の regime / timeframe / entry / exit / indicator / risk 構造を見て、
  既存選抜候補と構造的に違う候補を優先的に拾う
```

このPRの目的は、Quality-Diversity Archive 本体を作ることではない。  
あくまで、将来の Archive に備える **軽量 descriptor と novelty score の導入** に限定する。

---

## このPRでやること

### 実装する

- `BehaviorDescriptorLite` の定義
- StrategyDSL からの軽量 descriptor 抽出
- descriptor similarity / novelty score の計算
- `surrogateRescuePolicy.ts` の `novelty_rescue` で novelty score を利用
- `formalBtCandidateSummary` または route reason に novelty 情報を反映
- 単体テスト
- smoke CLI で novelty route の理由が追える状態にする

### 実装しない

- DB migration
- QualityDiversityArchive 本体
- Archive repository
- BehaviorDescriptor のDB保存
- EdgeStatus enum の変更
- EdgeHypothesis → StrategyDSL 逆変換
- FailureReason 13分類化
- production_ready 昇格処理
- OOS / walk-forward の追加
- 類似度に equity curve / trade pattern を使う処理

---

## 基本方針

### 1. DBなしで実装する

PR #97 はメモリ上の descriptor 計算に限定する。  
永続化はしない。

### 2. 型は実コードの自由度に合わせる

`regimeTarget` や `timeframe` は既存コード上で自由度があるため、厳密な enum にしない。  
未知値を落とすのではなく、`unknown` または文字列として扱う。

### 3. 完璧な novelty を目指さない

PR #97 の novelty は以下を見れば十分。

- regimeTarget が違う
- timeframe が違う
- entry 構造が違う
- exit 構造が違う
- indicator family が違う
- risk / SL / TP 構造が違う

equity curve similarity や trade pattern similarity は、正式BT履歴が安定してから別PRで扱う。

### 4. novelty は昇格ではない

`novelty_rescue` は「正式BTで確認する価値がある構造差分候補」であり、強い候補という意味ではない。

---

## 推奨ファイル構成

既存構成に合わせること。候補としては以下。

```text
src/side-b/evolution/behaviorDescriptorLite.ts
src/side-b/tests/evolution/behaviorDescriptorLite.test.ts
```

既存の `surrogateRescuePolicy.ts` は直接修正してよいが、descriptor 抽出・類似度計算の本体は別ファイルに切り出すこと。

`EvolutionLoop.ts` に novelty 計算ロジックを書かない。

---

## 型定義

### BehaviorDescriptorLite

```ts
// StrategyDSL から抽出する軽量な振る舞い記述子
export type BehaviorDescriptorLite = {
  regimeTarget: string;
  timeframe: string;
  entryKind: string;
  exitKind: string;
  indicatorKinds: string[];
  riskKind: string;
  stopLossKind: string;
  takeProfitKind: string;
  tradeFrequencyClass: 'low' | 'medium' | 'high' | 'unknown';
};
```

### DescriptorSimilarity

```ts
// 2つの descriptor の類似度。1 に近いほど似ている。
export type DescriptorSimilarity = {
  regimeSimilarity: number;
  timeframeSimilarity: number;
  entrySimilarity: number;
  exitSimilarity: number;
  indicatorSimilarity: number;
  riskSimilarity: number;
  totalSimilarity: number;
};
```

### NoveltyScore

```ts
// 候補個体の novelty score。1 に近いほど既存候補と違う。
export type NoveltyScore = {
  candidateId: string;
  nearestSimilarity: number;
  noveltyScore: number;
  descriptor: BehaviorDescriptorLite;
  nearestCandidateId: string | null;
  reason: string;
};
```

---

## descriptor 抽出仕様

### 関数

```ts
export function extractBehaviorDescriptorLite(
  dsl: StrategyDSL,
  options?: {
    validationTradeCount?: number;
  },
): BehaviorDescriptorLite;
```

### 抽出ルール

#### regimeTarget

- `dsl.regimeTarget` があればその文字列
- なければ `'unknown'`

#### timeframe

- `dsl.timeframe` があればその文字列
- なければ `'unknown'`

#### entryKind

以下のように、StrategyDSL の entry 条件から概算する。

- breakout 系条件があれば `'breakout'`
- moving average / EMA / SMA 系があれば `'ma'`
- RSI / stochastic / oscillator 系があれば `'oscillator'`
- ATR / volatility / band 系があれば `'volatility'`
- price / candle / high / low 系が中心なら `'price_action'`
- 判定不能なら `'unknown'`

実DSLの形に合わせて実装すること。  
存在しないプロパティを仮定しない。

#### exitKind

- fixed RR / take profit / stop loss が中心なら `'fixed_rr'`
- ATR trailing / trailing stop 系があれば `'trailing'`
- time exit 系があれば `'time_exit'`
- opposite signal 系があれば `'opposite_signal'`
- 判定不能なら `'unknown'`

#### indicatorKinds

StrategyDSL 内の条件・indicator参照から indicator family を抽出する。

例:

- `ema`
- `sma`
- `rsi`
- `atr`
- `bollinger`
- `macd`
- `volume`
- `price`
- `unknown`

重複は除去し、安定した順序で返す。

#### riskKind

- SL / TP が両方あるなら `'sl_tp'`
- SL のみなら `'sl_only'`
- TP のみなら `'tp_only'`
- trailing があるなら `'trailing'`
- 判定不能なら `'unknown'`

#### stopLossKind / takeProfitKind

- fixed price / fixed pips / percent / ATR / RR など、取れる範囲で分類
- 判定不能なら `'unknown'`

#### tradeFrequencyClass

PR #97 では validation trade count を受け取れる場合のみ分類する。

```text
0 または undefined: unknown
1〜19: low
20〜99: medium
100以上: high
```

この閾値は v1 の仮値であり、将来調整可能にする。

---

## 類似度計算

### compareBehaviorDescriptorsLite

```ts
export function compareBehaviorDescriptorsLite(
  a: BehaviorDescriptorLite,
  b: BehaviorDescriptorLite,
): DescriptorSimilarity;
```

### 類似度ルール

各項目の類似度は 0〜1 で返す。

#### regime / timeframe / entry / exit / risk

- 完全一致: 1
- どちらかが unknown: 0.5
- 不一致: 0

#### indicatorSimilarity

Jaccard similarity を使う。

```text
intersection / union
```

両方空の場合は 0.5 とする。

#### totalSimilarity

重み付き平均にする。

```ts
const weights = {
  regime: 1.0,
  timeframe: 0.8,
  entry: 1.2,
  exit: 1.0,
  indicator: 1.2,
  risk: 0.8,
} as const;
```

合計を 0〜1 に clamp する。

---

## novelty score 計算

### scoreNoveltyAgainstSelected

```ts
export function scoreNoveltyAgainstSelected(
  candidate: StrategyDSL,
  selected: StrategyDSL[],
  options?: {
    candidateValidationTradeCount?: number;
    selectedValidationTradeCounts?: Map<string, number>;
  },
): NoveltyScore;
```

### 仕様

- `selected` が空なら noveltyScore は 1
- selected 内の各候補と比較する
- 最も似ている候補の similarity を `nearestSimilarity` とする
- `noveltyScore = 1 - nearestSimilarity`
- `nearestCandidateId` を保存する
- reason に以下を含める
  - noveltyScore
  - nearestSimilarity
  - nearestCandidateId
  - 主な差分要素

---

## surrogateRescuePolicy への統合

### 現状

PR #96 の `novelty_rescue` は、既選定済み以外から1件拾う簡易実装である。

### PR #97 後

`novelty_rescue` は以下のように変更する。

```text
1. nonKill から、まだ selected に入っていない候補を noveltyPool にする
2. 各候補について、selected 済み候補との noveltyScore を計算する
3. noveltyScore 降順で並べる
4. 同点の場合は surrogateScore 降順
5. 上位 noveltyTopK 件を novelty_rescue として採用
```

### reason 例

```text
most novel candidate: noveltyScore=0.67, nearestSimilarity=0.33, nearestCandidateId=abc123, diff=entryKind,indicatorKinds,timeframe
```

---

## formalBtCandidateSummary への反映

既存の `FormalBtCandidateSummary` を大きく変えない。

ただし、可能なら以下を optional で追加してよい。

```ts
noveltySelected?: Array<{
  candidateId: string;
  noveltyScore: number;
  nearestSimilarity: number;
  nearestCandidateId: string | null;
}>;
```

大きな型変更になる場合は summary には追加せず、`reason` のみに novelty 情報を入れる。

PR #97 では後方互換性を優先する。

---

## テスト要件

### behaviorDescriptorLite.test.ts

以下を追加する。

1. regimeTarget / timeframe を DSL から抽出できる
2. entryKind を移動平均系として分類できる
3. entryKind を oscillator 系として分類できる
4. entryKind を volatility 系として分類できる
5. indicatorKinds が重複除去され、安定順序で返る
6. riskKind が SL/TP 構造から分類される
7. tradeFrequencyClass が trade count から分類される
8. unknown 値でも例外を投げない
9. descriptor 完全一致なら totalSimilarity が高い
10. descriptor が大きく異なるなら totalSimilarity が低い
11. selected が空なら noveltyScore=1 になる
12. selected がある場合 nearestCandidateId が入る

### surrogateRescue.test.ts

既存テストに加えて以下を追加する。

1. novelty_rescue が未選択候補のうち最も構造的に違う候補を選ぶ
2. noveltyScore が同点の場合 surrogateScore が高い候補を選ぶ
3. normal_pass / low_drawdown / trade_count で既に選ばれた候補は novelty_rescue で重複選択されない
4. novelty reason に noveltyScore / nearestSimilarity が含まれる
5. 全候補が類似している場合でも例外を投げない

---

## 実装制約

- `any` を使わない
- DB migration を追加しない
- EdgeStatus enum を変更しない
- `EvolutionLoop.ts` を大きく肥大化させない
- StrategyDSL の存在しないプロパティを仮定しない
- schema validation は既存経路を尊重する
- novelty score は昇格判定に使わない
- rescue route の意味を変えない
- formal BT の閾値を緩和しない
- 既存 parentPool / rescue lane / formal BT verification を壊さない

---

## 禁止事項

- QualityDiversityArchive をこのPRで作らない
- descriptor をDB保存しない
- equity curve similarity を実装しない
- trade pattern similarity を実装しない
- LLMに novelty 判定を任せない
- `novelty_rescue` を confirmed / production_ready 扱いしない
- `normal_pass` の定義を変えない
- `near_miss_rescue` の定義を変えない
- `trade_count_rescue` の minTrades 制約を弱めない

---

## 完了条件

以下を満たしたら PR #97 完了。

- `BehaviorDescriptorLite` が実装されている
- DSL から descriptor を抽出できる
- descriptor similarity を計算できる
- selected 候補に対する noveltyScore を計算できる
- `novelty_rescue` が noveltyScore を使って候補を選ぶ
- novelty route の reason から選定理由を追える
- 既存 `formalBtCandidateSummary` が壊れていない
- `normal_pass / near_miss / low_drawdown / trade_count / kill` の挙動が維持されている
- DB migration なし
- EdgeStatus 変更なし
- 対象テストが通る
- smoke 実行で `formalBtCandidateSummary` が確認できる

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
- BehaviorDescriptorLite を追加
- StrategyDSL から regime / timeframe / entry / exit / indicator / risk の軽量descriptorを抽出
- descriptor similarity / noveltyScore を追加
- novelty_rescue が noveltyScore を使って候補を選ぶように変更

## Scope
- DB migration なし
- QualityDiversityArchive なし
- EdgeStatus enum 変更なし
- EdgeHypothesis → StrategyDSL 逆変換なし
- production_ready 昇格なし

## Verification
- npx tsc --noEmit -p tsconfig.json
- npx jest src/side-b/tests/evolution/ src/side-b/tests/strategy_dsl/ src/side-b/tests/agents/ --silent
- set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3

## Smoke Observations
- parentPoolSummary:
- formalBtCandidateSummary:
- novelty_rescue reason:
```

---

## 最重要判断基準

PR #97 の目的は、進化ループをさらに複雑にすることではない。

目的は、PR #96 で追加した `novelty_rescue` を、以下の状態に改善することである。

```text
雑に未選択候補を拾う
  ↓
既存選抜候補と構造が違う候補を拾う
```

このPRでは、Quality-Diversity Archive 本体を作らない。  
Archive の前に、まず descriptor と novelty score が正しく機能することを確認する。

実装判断に迷った場合は、以下を優先する。

1. DBなしで完結する
2. 実コードの StrategyDSL 構造に合わせる
3. novelty の理由をログで追えるようにする
4. 既存 rescue lane を壊さない
5. `novelty_rescue = 昇格` と誤解されないようにする
6. PR #97 のスコープを小さく保つ

---

## エージェントへの最終指示

まず現在の `StrategyDSL` schema、`surrogateRescuePolicy.ts`、`surrogateRescue.test.ts` を確認すること。

その上で、最小差分で `behaviorDescriptorLite.ts` を追加し、`novelty_rescue` の選定に novelty score を組み込むこと。

このPRで目指すのは、自律進化の完成ではない。  
正式BTへ送る rescue 候補のうち、`novelty_rescue` の質を少し上げることである。

実装後は、型チェック、対象テスト、smoke を実行し、PR本文に `formalBtCandidateSummary` と `novelty_rescue reason` の実測ログを貼ること。

