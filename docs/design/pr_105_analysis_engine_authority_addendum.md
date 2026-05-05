# PR #105 追加修正指示: Analysis Engine Authority + Surrogate Rescue 保護

## 位置づけ

この文書は、既存の **PR #105: OOS-aware PromotionGate v1** 用プロンプトに追記するための追加修正指示である。

PR #105 の目的は引き続き、PR #103 の OOS / Walk-forward 結果を PromotionGate に接続し、`validation_candidate` と `validation_confirmed` を分離できるようにすることである。

ただし、本追記により、以下を明確にする。

```text
評価の正本:
  analysis-engine / Python 側

Evolution layer:
  候補選抜 / adapter / mapper / summary / PromotionGate
```

Evolution layer 側で Walk Forward / Monte Carlo / Backtest を再実装しない。

---

## 最重要前提

現状、全候補を analysis-engine の正式BTへ投げると重くなる。

そのため Evolution 側には、正式BT候補を絞り込むための軽量スクリーニング / 振り分け機能がある。

この機能は削除・無効化・巻き戻ししてはいけない。

### 保護対象ファイル

以下を保護対象として扱う。

```text
src/side-b/evolution/surrogateRescuePolicy.ts
src/side-b/tests/evolution/surrogateRescue.test.ts
```

### 保護対象の主な関数 / 型

```text
selectFormalBtCandidatesWithRescue
FormalBtCandidateSummary
SurrogateRoute
RescueSelectionOverrides
```

### EvolutionLoop 側の接続

以下の流れを壊さない。

```text
EvolutionLoop
  ↓
buildRescueCandidates(...)
  ↓
selectFormalBtCandidatesWithRescue(...)
  ↓
formalBtCandidateSummary
  ↓
選抜された候補のみ runFormalBacktest / analysis-engine へ渡す
```

`formalBtCandidateSummary` は、全候補を正式BTに投げないための観測点である。  
PR #105 でこの summary を削除しない。

---

## Surrogate Rescue Lane の責務

`surrogateRescuePolicy.ts` は、正式BTの代替ではない。

目的は、正式BTに送る候補を選抜することである。

```text
やる:
  - normal_pass / near_miss / low_drawdown / trade_count / novelty / kill の分類
  - formal BT 候補数の抑制
  - normal_pass=0 世代でも rescue lane で候補を救済
  - route 別 summary の出力

やらない:
  - 正式BTの代替判定
  - OOS / Walk-forward の実行
  - Monte Carlo の実行
  - production 昇格判断
  - metrics の正本化
```

このPRで `surrogateRescuePolicy.ts` を「評価エンジンの重複」と誤認して削除しない。

これは **全件バックテストを避けるための軽量選抜層** であり、残すべき機能である。

---

## Analysis Engine を評価正本にする

Backtest / Walk Forward / Monte Carlo / Robustness 系評価は、Evolution layer に実装しない。

PR #105 では、analysis-engine 側の既存評価結果を受け取り、PromotionGate に接続する。

```text
analysis-engine / Python:
  - backtest 実行
  - screening backtest 実行
  - Walk Forward 実行
  - Monte Carlo 実行
  - trades / equity / PF / maxDD / Sharpe / returnPct 等の算出
  - robustness metrics の返却

Evolution layer / TypeScript:
  - 評価対象候補の選抜
  - analysis-engine 呼び出し adapter
  - result mapper
  - summary builder
  - PromotionGate への接続
  - GenerationReport / smoke 出力
```

---

## PR #103 実装の棚卸し指示

PR #105 の実装前に、PR #103 で追加された OOS / Walk-forward 関連ファイルを確認すること。

特に以下を確認する。

```text
src/side-b/evolution/oosWalkForwardPolicy.ts
src/side-b/evolution/oosEvaluationRunner.ts
src/side-b/evolution/*oos*
src/side-b/tests/evolution/*oos*
```

ファイル名は実コードを確認して正確に判断すること。

---

## PR #103 実装の許容範囲

以下は Evolution layer に残してよい。

```text
- OosValidationResult 型
- OosValidationSummary 型
- analysis-engine result を OosValidationResult に変換する mapper
- status / failureReason / route / sourceStage ごとの summary builder
- not_evaluated / unknown / insufficient_oos_data の分類
- PromotionGate に渡すための adapter
```

以下は残してよいが、責務を明示する。

```text
buildOosSplitWindowV1:
  analysis-engine に渡す評価期間を決めるだけなら許容
  Walk Forward の本格実装ではないことをコメントで明示
```

---

## PR #103 実装の修正対象

以下が Evolution layer 側に存在する場合は、修正・縮小・未使用化・削除を検討する。

```text
- Walk Forward fold を Evolution 側で本格生成している
- Walk Forward の pass / fail を Evolution 側で独自判定している
- Monte Carlo を Evolution 側で計算している
- Backtest metrics を Evolution 側で再計算している
- analysis-engine と別体系の閾値で OOS / WF を二重判定している
- trades / equity を Evolution 側で再集計している
```

ただし、削除する場合は既存テストと smoke の意味を壊さないこと。

既存の `oosValidationSummary` が消えないようにする。

---

## 推奨するリネーム / 分離

もし `oosWalkForwardPolicy.ts` が評価ロジックを持ちすぎている場合は、責務を以下へ分離する。

```text
src/side-b/evolution/analysisEngineRobustnessAdapter.ts
src/side-b/evolution/oosValidationResultMapper.ts
src/side-b/evolution/oosValidationSummary.ts
```

### analysisEngineRobustnessAdapter.ts

analysis-engine / Python 側の結果を取得する薄い adapter。

```text
責務:
  - analysis-engine endpoint を呼ぶ
  - timeout / error を扱う
  - not_evaluated / engine_error を返せるようにする

非責務:
  - Walk Forward の再実装
  - Monte Carlo の再実装
  - metrics 計算
```

### oosValidationResultMapper.ts

analysis-engine の raw result を Evolution layer の `OosValidationResult` に変換する。

```text
責務:
  - raw result の正規化
  - status / failureReasons への変換
  - candidateId / dslId / route / sourceStage との対応付け

非責務:
  - 指標の再計算
  - fold の再生成
  - 別閾値での二重判定
```

### oosValidationSummary.ts

`OosValidationResult[]` を `OosValidationSummary` に集計する。

```text
責務:
  - byStatus
  - byFailureReason
  - byRoute
  - bySourceStage
  - warnings

非責務:
  - OOS / WF / MC の実行
```

---

## Walk Forward / Monte Carlo の扱い

Walk Forward / Monte Carlo は、原則として Python 側または既存の分析エンジン側で扱う。

PR #105 で新しい外部ライブラリを安易に追加しない。

もしライブラリ導入が必要なら、このPRでは採用せず、別PRで以下を比較してから決める。

```text
- 既存 analysis-engine 実装を使う
- Backtesting.py / vectorbt / backtrader / NautilusTrader 等を使う
- 自前の軽量 adapter を使う
```

このPRでは、ライブラリ選定をしない。

```text
PR #105:
  既存 analysis-engine の結果を PromotionGate に接続する

別PR:
  Walk Forward / Monte Carlo 実装のライブラリ選定と analysis-engine 側改修
```

---

## PR #105 でやること

### やる

```text
- Surrogate Rescue Lane を保護する
- analysis-engine を評価正本として扱う
- PR #103 の OOS / WF 実装が Evolution 側に寄りすぎていないか確認する
- OOS / WF / MC の実行ロジックを Evolution 側に増やさない
- analysis-engine result → OosValidationResult mapper を整える
- OosValidationResult → PromotionGate の接続を実装する
- OOS passed / WF passed → validation_confirmed にする
- OOS failed / WF failed → hold / validation_candidate維持にする
- productionEligible=false を維持する
- smoke で formalBtCandidateSummary と oosAwarePromotionSummary の両方を確認する
```

### やらない

```text
- surrogateRescuePolicy.ts を削除しない
- formalBtCandidateSummary を削除しない
- Walk Forward を Evolution 側で再実装しない
- Monte Carlo を Evolution 側で再実装しない
- Backtest metrics を Evolution 側で再計算しない
- 新しいバックテストライブラリをこのPRで導入しない
- production_candidate へ自動昇格しない
- DB migration を追加しない
- EdgeStatus enum を変更しない
- StatusManager を変更しない
```

---

## 修正後の理想フロー

```text
population / generated DSL
  ↓
surrogate evaluateFitness
  ↓
surrogateRescuePolicy.ts
  ↓
formalBtCandidateSummary
  ↓
選抜候補のみ analysis-engine screening backtest
  ↓
formalBtVerifiedCandidates
  ↓
validation_candidate
  ↓
analysis-engine / Python robustness evaluation
  - OOS
  - Walk Forward
  - Monte Carlo 必要なら後続PR
  ↓
OosValidationResultMapper
  ↓
oosValidationSummary
  ↓
PromotionGate
  ↓
validation_confirmed
```

---

## テスト追加 / 修正要件

### Surrogate Rescue 保護テスト

以下を確認する。

```text
1. selectFormalBtCandidatesWithRescue が引き続き呼ばれる
2. formalBtCandidateSummary が GenerationReport に残る
3. normal_pass / rescue / killed の集計が消えない
4. formalBtTopK / RescueSelectionOverrides の既存挙動が壊れない
5. Surrogate Rescue Lane は OOS / WF の変更で削除されない
```

### Analysis Engine Authority テスト

以下を確認する。

```text
1. OOS / WF 結果は analysis-engine adapter 経由で渡される
2. Evolution 側で Walk Forward fold を新規生成しない
3. Evolution 側で Monte Carlo を計算しない
4. OosValidationResult mapper が raw result を正規化する
5. mapper / summary が metrics を再計算しない
6. analysis-engine error 時は not_evaluated / unknown / engine_error として GenerationReport に残る
```

### PromotionGate 接続テスト

以下を確認する。

```text
1. analysis-engine 由来の oos_passed が validation_confirmed になる
2. analysis-engine 由来の walk_forward_passed が validation_confirmed になる
3. oos_failed は rejected ではなく hold になる
4. walk_forward_failed は rejected ではなく hold になる
5. productionEligible は false のまま
6. invalid / fatal は OOS passed より優先される
```

---

## smoke 出力確認

smoke では、以下を必ず確認する。

```text
--- formalBtCandidateSummary ---
...

--- oosValidationSummary ---
...

--- promotionGateSummary ---
...

--- oosAwarePromotionSummary ---
...
```

`formalBtCandidateSummary` が消えていたら、このPRは失敗である。

`oosAwarePromotionSummary` が出ていても、`formalBtCandidateSummary` が消えていたら、軽量選抜層を壊している。

---

## PR本文に追記すること

```md
## Architecture Note
- Backtest / Walk Forward / Monte Carlo の評価正本は analysis-engine / Python 側とする
- Evolution layer は候補選抜 / adapter / mapper / summary / PromotionGate に限定する
- Surrogate Rescue Lane は全件正式BTを避けるための軽量選抜層であり、削除しない
- `surrogateRescuePolicy.ts` / `formalBtCandidateSummary` は維持した
- PR #105 では新規バックテストライブラリ導入は行わない

## Protected Existing Behavior
- `selectFormalBtCandidatesWithRescue` による正式BT候補選抜
- `formalBtCandidateSummary` の GenerationReport / smoke 出力
- normal_pass / near_miss / low_drawdown / trade_count / novelty / kill の分類

## Scope
- analysis-engine result を PromotionGate に接続
- OOS passed / WF passed を validation_confirmed に反映
- production_candidate 自動昇格なし
- DB migration なし
- EdgeStatus 変更なし
```

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

## 最重要判断基準

このPRでは、Evolution layer に評価エンジンを増やさない。

```text
残す:
  surrogateRescuePolicy.ts
  formalBtCandidateSummary
  候補選抜
  mapper
  summary
  PromotionGate

寄せる:
  Backtest
  Walk Forward
  Monte Carlo
  metrics 計算
  robustness 評価
  → analysis-engine / Python 側
```

PR #105 の成功条件は、OOS-aware PromotionGate を実装することだけではない。

同時に、全件正式BTを避けるための `surrogateRescuePolicy.ts` を壊さず、評価正本を analysis-engine 側に寄せることである。

