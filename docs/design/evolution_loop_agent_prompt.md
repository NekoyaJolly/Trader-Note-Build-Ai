# 進化ループ実装エージェント用プロンプト

> **ステータス: ロードマップ文書 (実装スコープ ≠ 本文の全項目)**
>
> 本ドキュメントは進化ループの **将来像全体** を記述するロードマップ。実際にどこまで実装したかは PR のリンクを参照する。
>
> ### 実装履歴
>
> - PR #95 = 親個体プール v1 最小版 (本ドキュメント中の「実装対象 1」のサブセット)
>   - **実装した source キー**: `formal_bt_passed` / `current_population` / `novelty_seed`
>   - 本文中の `confirmed: 0.25 / screeningPassed: 0.40 / unverified: 0.10` は **未実装** (= EdgeHypothesis 逆変換層が無いため)。後続 PR #98 で対応予定
>   - 本文中の「PR#93 = 親個体プール v1」「PR#94 = Archive」等の番号は **執筆時点の希望** であり、実 PR 番号とは一致しない (PR #93 はヘルスチェック修正 / PR #94 は DSL lint 修正で別件マージ済み)
> - PR #96 以降の予定:
>   | 想定 PR | 内容 | 状態 |
>   |---|---|---|
>   | #96 | Surrogate Rescue Lane (本文「実装対象 3」) | 未着手 |
>   | #97 | BehaviorDescriptor Lite / Novelty Score (本文「実装対象 2 / 7」) | 未着手 |
>   | #98 | EdgeHypothesis → StrategyDSL 逆変換 (本文「実装対象 1」の confirmed/screening_passed 部分) | 未着手 |
>   | #99 | FailureReason → RepairHint v1 (本文「実装対象 4」) | 未着手 |
>   | #100 | Promotion Gate / EdgeStatus 拡張 (本文「実装対象 5」、migration 要検討) | 未着手 |
>
> 本文の `parentPoolPolicy` / `behaviorDescriptor` / `formalBtCandidatePolicy` 等の例コードは **設計意図の記述** であり、最終形ではない。実装側で必要に応じて構造・キー名を調整する。

## 目的

Trader-Note-Build-Ai の進化ループ実装を、単なる候補生成ではなく、継続的に改善可能な **Quality-Diversity 型の自律進化基盤** として完成させる。

現状、mutation / crossover / population 追加の配管は通っているが、正式バックテストへ進む候補が surrogate 段階で 0 件になる世代が発生している。これは実装バグではなく、親個体プール、選抜ゲート、多様性維持、失敗理由の再利用設計が未成熟であることを示している。

本タスクでは、進化を促進するために以下を実装・整理する。

- 親個体プール戦略
- Quality-Diversity Archive
- Surrogate Rescue Lane
- FailureReason に基づく Repair Mutation
- 昇格ゲートの明確化
- 過剰最適化を避ける検証制約

---

## 現状認識

直近の smoke 実行では、以下が確認済み。

- mutation は 10/10 成功
- crossover は 5/5 成功
- eliteIds は複数取得可能
- addedToPopulation は正常
- Zod 厳格バリデーション由来の警告は解消済み
- ただし surrogate 条件を通過できず、正式 BT へ進んだ候補は 0 件

このため、次の焦点は **配管修正ではなく、進化場の設計** である。

---

## 基本方針

### 1. 生成は自由、昇格は厳格

LLM mutation / crossover / novelty seed による候補生成は広く許容する。  
ただし、正式採用・UI表示・production candidate への昇格は厳格に制御する。

### 2. 単一スコア最適化を避ける

PF、勝率、期待値など単一指標だけで選抜しない。  
単一スコア最適化は、バックテストに過剰適合した脆弱な個体を量産する危険が高い。

### 3. 多様な良個体を残す

「最強個体」だけではなく、異なる regime / timeframe / entry family / exit family / risk profile ごとの優良個体を残す。

### 4. 失敗理由を次世代に利用する

失敗した個体を単に捨てるのではなく、failureReason を mutation 方針に変換する。

### 5. 親利用と本番採用を分ける

親として使える個体と、本番候補として扱える個体を混同しない。

---

## 用語定義

| 用語 | 意味 |
|---|---|
| `unverified` | 未検証だが探索素材として利用可能な仮説 |
| `screening_passed` | 軽量スクリーニングを通過した仮説 |
| `surrogate_passed` | surrogate 評価を通過した候補 |
| `formal_bt_passed` | 正式バックテストを通過した候補 |
| `walk_forward_passed` | walk-forward validation を通過した候補 |
| `oos_passed` | out-of-sample 検証を通過した候補 |
| `validation_confirmed` | 4c 検証を通過した候補 |
| `production_ready` | 採用候補として扱える最終状態 |
| `evolution_eligible` | 親個体として利用可能な状態 |
| `rejected` | 原則として親個体から除外する状態 |

---

## 実装対象 1: 親個体プール戦略

### 目的

進化ループの親候補を単一ソースに依存させず、探索と活用のバランスを取る。

### 親候補ソース

以下のソースから親候補を収集する。

1. `EdgeHypothesis`
   - `confirmed`
   - `screening_passed`
   - `unverified`

2. `EvolutionBacktestRun`
   - `formalBtPassed = true`
   - 成績・失敗理由・regime 情報を含む履歴

3. 現在の `population`
   - 直近世代の上位個体
   - 新規性の高い個体

4. `QualityDiversityArchive`
   - descriptor ごとの elite 個体

### 初期配分

以下を初期値として実装する。  
設定値として外部化し、後から調整可能にすること。

```ts
// 進化ループの親個体プール配分設定
export const parentPoolPolicy = {
  confirmed: 0.25,
  screeningPassed: 0.40,
  currentPopulation: 0.20,
  unverified: 0.10,
  noveltySeed: 0.05,
  rejected: 0.00,
} as const;
```

### 重要な判断

`confirmed: 0.50` のような confirmed 偏重は現段階では避ける。  
正式 BT 通過個体が十分に育っていない段階で confirmed 偏重にすると、探索空間が狭まり、早期収束の危険が高い。

---

## 実装対象 2: Quality-Diversity Archive

### 目的

単一ランキング上位だけを残すのではなく、特徴空間ごとに優良個体を保持する。

### behaviorDescriptor

各個体に以下のような descriptor を付与する。

```ts
// 個体の振る舞い特徴を表す記述子
export type BehaviorDescriptor = {
  regime: 'breakout' | 'trend' | 'range' | 'reversal' | 'unknown';
  timeframe: '15m' | '1h' | '4h' | '1d' | 'unknown';
  entryFamily:
    | 'ema_breakout'
    | 'ma_cross'
    | 'volatility_breakout'
    | 'price_action'
    | 'oscillator'
    | 'unknown';
  exitFamily:
    | 'fixed_rr'
    | 'atr_trailing'
    | 'time_exit'
    | 'opposite_signal'
    | 'unknown';
  holdingPeriodClass: 'scalping' | 'intraday' | 'swing' | 'unknown';
  tradeFrequencyClass: 'low' | 'medium' | 'high' | 'unknown';
  riskProfile: 'low_drawdown' | 'balanced' | 'high_return' | 'unknown';
};
```

### Archive の基本仕様

- descriptor の組み合わせをセルとして扱う
- 各セルに上位 N 個体を保持する
- 類似個体が増えすぎた場合は、スコアが高いものを残す
- 全体ランキングとは別に保存する
- mutation / crossover の親候補として利用する

### Archive の評価軸

以下を総合して保存優先度を決める。

- surrogate score
- formal BT score
- drawdown
- trade count
- PF
- expectancy
- OOS score
- novelty score
- complexity penalty

---

## 実装対象 3: Surrogate Rescue Lane

### 目的

surrogate 3条件未達により正式 BT 候補が 0 件になる状態を避ける。  
ただし、ゲートを単純に緩和するのではなく、救済ルートを分ける。

### 正式 BT 候補の選抜方法

総合 score 上位だけではなく、以下のカテゴリ別に候補を正式 BT へ送る。

```ts
// 正式バックテスト候補の抽出方針
export const formalBtCandidatePolicy = {
  overallTopK: 3,
  noveltyTopK: 1,
  lowDrawdownTopK: 1,
  tradeCountSufficientTopK: 1,
  regimeSpecialistTopK: 1,
} as const;
```

### 救済ルート

| ルート | 条件 | 目的 |
|---|---|---|
| `normal_pass` | surrogate 主要条件をすべて通過 | 正攻法 |
| `near_miss_rescue` | 条件の一部のみ未達だが改善余地が明確 | 惜しい候補の救済 |
| `novelty_rescue` | 成績は弱いが構造が珍しい | 多様性維持 |
| `specialist_rescue` | 特定 regime でのみ強い | regime 別 elite 候補 |
| `kill` | 取引ゼロ、異常DD、破綻、ルックアヘッド疑い | 即除外 |

### 注意点

`rescue` は昇格ではない。  
あくまで正式 BT に進めるための候補選抜であり、本番採用とは無関係である。

---

## 実装対象 4: FailureReason に基づく Repair Mutation

### 目的

失敗理由を次世代の mutation 方針に変換し、ランダム変異だけに依存しない。

### failureReason の例

```ts
// 候補個体の失敗理由
export type EvolutionFailureReason =
  | 'trade_count_too_low'
  | 'drawdown_too_high'
  | 'pf_below_threshold'
  | 'expectancy_below_threshold'
  | 'regime_mismatch'
  | 'entry_too_strict'
  | 'entry_too_loose'
  | 'exit_too_early'
  | 'exit_too_late'
  | 'overfit_suspected'
  | 'data_quality_issue'
  | 'invalid_strategy_shape'
  | 'lookahead_suspected';
```

### repairHint の生成

failureReason から repairHint を生成する。

| failureReason | repairHint |
|---|---|
| `trade_count_too_low` | entry 条件を緩める、対象時間帯を広げる |
| `drawdown_too_high` | stop 条件、volatility filter、position sizing を見直す |
| `pf_below_threshold` | exit 改善、entry 精度改善、ノイズフィルタ追加 |
| `expectancy_below_threshold` | RR、損切り幅、利確幅を再設計する |
| `regime_mismatch` | regime filter を追加または変更する |
| `entry_too_strict` | 閾値を緩和する |
| `entry_too_loose` | trend / volatility / volume 系 filter を追加する |
| `exit_too_early` | trailing stop または time exit 条件を見直す |
| `exit_too_late` | 損切り、反対シグナル、最大保有時間を強化する |
| `overfit_suspected` | パラメータ数を減らし、ロジックを単純化する |
| `lookahead_suspected` | 使用データ時点と indicator 計算を検査する |

### mutation prompt に渡す情報

mutation agent には以下を渡す。

```md
## 親個体
- strategyId:
- hypothesis:
- parameters:
- behaviorDescriptor:

## 評価結果
- surrogateScore:
- formalBtScore:
- pf:
- maxDrawdown:
- tradeCount:
- expectancy:
- oosScore:

## 失敗理由
- failureReason:
- repairHint:

## 変異方針
- 失敗理由を直接修復すること
- パラメータを過度に増やさないこと
- 元の仮説の中核を最低1つ保持すること
- 変更点を JSON で説明すること
```

---

## 実装対象 5: 昇格ゲート

### 目的

親個体として使える候補と、本番候補として扱える候補を明確に分ける。

### 推奨ゲート

```text
unverified
  ↓
screening_passed
  ↓
surrogate_passed
  ↓
formal_bt_passed
  ↓
walk_forward_passed
  ↓
oos_passed
  ↓
validation_confirmed
  ↓
production_ready
```

### 状態ごとの扱い

| 状態 | 親利用 | UI表示 | 採用候補 |
|---|---:|---:|---:|
| `unverified` | 可 | 原則不可 | 不可 |
| `screening_passed` | 可 | 限定可 | 不可 |
| `surrogate_passed` | 可 | 限定可 | 不可 |
| `formal_bt_passed` | 可 | 可 | 条件付き |
| `walk_forward_passed` | 可 | 可 | 条件付き |
| `oos_passed` | 可 | 可 | 条件付き |
| `validation_confirmed` | 可 | 可 | 可 |
| `production_ready` | 可 | 可 | 可 |
| `rejected` | 原則不可 | 不可 | 不可 |

---

## 実装対象 6: 過剰最適化対策

### 必須制約

以下は必須。

- train / validation / test を分離する
- walk-forward validation を導入する
- OOS 検証を行う
- 最低取引回数を設定する
- スプレッド・手数料・スリッページを評価に含める
- パラメータ数にペナルティを与える
- 類似戦略を重複排除する
- final holdout は進化ループから隔離する

### 禁止事項

- final holdout を親選抜に使わない
- UI 上で surrogate のみ通過した個体を「確認済み」と表示しない
- PF だけで昇格させない
- 取引回数が少ない個体を高評価しない
- 成績改善のために検証条件を後から緩めない
- rejected 個体をそのまま親にしない

---

## 実装対象 7: novelty score

### 目的

既存個体と異なる振る舞いをする候補を一定割合で残す。

### novelty の算出要素

以下の差分を利用する。

- regime
- timeframe
- entry family
- exit family
- holding period
- trade frequency
- indicator family
- stop / take profit 構造
- signal timing
- drawdown pattern
- profit distribution

### 類似度の扱い

完全一致ではなく、近さをスコア化する。

```ts
// 類似度スコアの概念例
export type StrategySimilarityScore = {
  descriptorSimilarity: number;
  parameterSimilarity: number;
  tradePatternSimilarity: number;
  equityCurveSimilarity: number;
  totalSimilarity: number;
};
```

`totalSimilarity` が高すぎる場合は、同一系統として扱い、Archive 内で重複排除する。

---

## 出力仕様

実装後、smoke 実行ログで以下が確認できること。

```text
parentPoolSummary:
  confirmed:
  screeningPassed:
  currentPopulation:
  unverified:
  noveltySeed:
  rejected:

archiveSummary:
  totalCells:
  occupiedCells:
  elitesStored:
  duplicateRejected:

surrogateSummary:
  normalPass:
  nearMissRescue:
  noveltyRescue:
  specialistRescue:
  killed:

formalBtCandidateSummary:
  overallTopK:
  noveltyTopK:
  lowDrawdownTopK:
  tradeCountSufficientTopK:
  regimeSpecialistTopK:
  uniqueCandidates:

failureReasonCounts:
  trade_count_too_low:
  drawdown_too_high:
  pf_below_threshold:
  overfit_suspected:
  invalid_strategy_shape:

promotionSummary:
  surrogatePassed:
  formalBtPassed:
  walkForwardPassed:
  oosPassed:
  validationConfirmed:
  productionReady:
```

---

## PR 分割案

### PR#93: 親個体プール v1

- parentPoolPolicy を追加
- EdgeHypothesis / EvolutionBacktestRun / current population から親候補を集約
- ソース別件数をログ出力
- rejected を原則除外

### PR#94: Quality-Diversity Archive

- BehaviorDescriptor を定義
- descriptor ごとの archive cell を作成
- elite 保存・重複排除を実装
- archiveSummary をログ出力

### PR#95: Surrogate Rescue Lane

- normal pass 以外の rescue route を追加
- formal BT 候補をカテゴリ別に抽出
- formalBtCandidateSummary をログ出力

### PR#96: FailureReason → RepairMutation

- failureReason enum を整理
- repairHint 生成器を追加
- mutation prompt に failureReason / repairHint を注入

### PR#97: Promotion Gate

- promotion state を整理
- evolution_eligible と production_ready を分離
- UI / DB / ログ上の状態名を統一

---

## 完了条件

以下を満たしたら完了。

- smoke 実行で parentPoolSummary が確認できる
- mutation / crossover が既存通り成功する
- formal BT 候補が 0 件でも、その理由と rescue 候補数が観測できる
- Quality-Diversity Archive に descriptor 別 elite が保存される
- failureReason から repairHint が生成される
- confirmed と validation_confirmed の意味が混同されていない
- production_ready への昇格条件がコード上で明確になっている
- 過剰最適化を助長するショートカットが追加されていない

---

## 実装時の注意

- 既存の smoke テストを壊さない
- 既存 DB スキーマ変更が必要な場合は migration を明示する
- 大きな設計変更は小さな PR に分割する
- 進化ループ本体と評価器を密結合させない
- ログは人間が読んで判断できる粒度にする
- LLM 出力の JSON は必ず schema validation する
- validation error は握りつぶさず、failureReason として保存する
- 評価指標は追加してよいが、昇格条件の緩和は勝手に行わない

---

## 最重要判断基準

この進化ループは、強い個体を一体見つけるための仕組みではない。  
**異なる環境で生き残る複数の良個体を育てる仕組み** である。

そのため、実装判断に迷った場合は以下を優先する。

1. 多様性を残す
2. 失敗理由を保存する
3. 親利用と本番採用を分ける
4. 正式検証を厳格にする
5. 単一スコア最適化を避ける
6. 過剰最適化を防ぐ
7. 後から原因追跡できるログを残す

---

## エージェントへの最終指示

上記方針に従い、まずは PR#93 として **親個体プール v1** を実装すること。

実装前に現在の関連ファイルを確認し、既存設計に合わせて最小差分で追加する。  
既存の mutation / crossover / smoke 実行経路を壊さないこと。  
実装後は smoke を実行し、parentPoolSummary と formalBtCandidateSummary が観測できる状態にすること。

大規模な自己改変、進化器自身の自動改造、検証条件の緩和は行わない。  
今回の目的は、進化ループを暴走させることではなく、観測可能で修復可能な進化基盤にすることである。

