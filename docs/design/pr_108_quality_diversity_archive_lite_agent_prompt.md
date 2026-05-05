# PR #108: Quality-Diversity Archive Lite エージェント用プロンプト

## 0. あなたの役割

あなたは `Trader-Note-Build-Ai` の実装エージェントです。

PR #108 では、進化ループに **Quality-Diversity Archive Lite** を追加してください。

目的は、単にスコア上位だけを残すのではなく、**性質の違う有望個体を cell ごとに保持し、複数世代の進化で収束しすぎることを防ぐ** ことです。

ただし、今回の PR は Lite 版です。DB migration、EdgeStatus enum 変更、production_candidate 自動昇格、本格的な MAP-Elites 永続化は行いません。人類はなぜ毎回「全部入り」に突撃したがるのか分かりませんが、今回は小さく勝ちます。

---

## 1. 現在地

直近までに以下が完了済みです。

- PR #95: ParentPool v1
- PR #96: Surrogate Rescue Lane / `formalBtCandidateSummary`
- PR #97: `BehaviorDescriptorLite` + Novelty Score
- PR #98: EdgeHypothesis → StrategyDSL 逆変換 + parent pool 統合
- PR #100: FailureReason → RepairHint v1
- PR #101: Promotion Gate
- PR #102: RepairOutcome Telemetry
- PR #103 / #105: analysis-engine を正本にした OOS / Walk-forward 接続、OOS-aware PromotionGate
- PR #106: Multi-generation Evolution Run
- PR #107: Adaptive Repair / Mutation Budget v1
  - `adaptiveRepairBudgetPolicy.ts` 追加
  - `multiGenerationRunner.ts` に adaptive decision / summary 接続
  - `EvolutionLoop.ts` は `mutationBudgetAllocation` を受領し、v1 では観測ログのみ
  - Copilot 指摘 5 件対応済み
  - `43 suites / 529 tests pass`

PR #108 では、PR #97 の `BehaviorDescriptorLite` を利用して、**diverse elite を軽量 archive 化** します。

---

## 2. 作業前の必須確認

### 実行場所

すべての CLI はリポジトリルートで実行してください。

```bash
cd /Users/jolly_app/projects/Trader-Note-Build-Ai
```

### ブランチ作成

```bash
git checkout main
git pull origin main
git checkout -b feat/pr-108-quality-diversity-archive-lite
```

### 先に必ず確認するファイル

以下を読んでから実装してください。

```bash
sed -n '1,260p' src/side-b/evolution/behaviorDescriptorLite.ts
sed -n '1,260p' src/side-b/evolution/surrogateRescuePolicy.ts
sed -n '1,260p' src/side-b/evolution/parentPoolPolicy.ts
sed -n '1,260p' src/side-b/evolution/multiGenerationRunner.ts
sed -n '1,220p' src/side-b/evolution/adaptiveRepairBudgetPolicy.ts
sed -n '1,220p' src/side-b/evolution/EvolutionLoop.ts
```

`BehaviorDescriptorLite` の実フィールド名は、必ず現コードを正として使ってください。存在しないフィールド名を想像で使わないでください。想像実装はだいたい地獄の入り口です。

---

## 3. この PR のゴール

### 3.1 実装するもの

1. `qualityDiversityArchiveLite.ts` を新設する
2. `BehaviorDescriptorLite` から deterministic な archive cell key を作る
3. GenerationReport / verified candidate / promotion candidate などから archive candidate を抽出する
4. cell ごとに quality score が高い代表個体を保持する
5. 同じ cell に複数候補が来た場合は、品質基準で置換する
6. multi-generation runner で世代ごとに archive を更新する
7. archive summary を `MultiGenerationEvolutionReport` に出す
8. smoke CLI に `--quality-diversity-archive` オプションと summary 出力を追加する
9. 可能なら archive elite を次世代の親候補に少量注入する
10. テストで archive の deterministic 性、cell replacement、summary、既存挙動非破壊を固定する

### 3.2 実装しないもの

- DB migration
- `EdgeStatus` enum 変更
- archive の DB 永続化
- production_candidate 自動昇格
- OOS / WF metrics の再計算
- analysis-engine 以外での Walk-forward 再実装
- formal BT 全件再実行
- Surrogate Rescue Lane の削除、縮小、上書き
- Adaptive Repair Budget の route quota 実反映

---

## 4. 設計方針

### 4.1 Quality-Diversity Archive Lite の意味

今回の archive は、厳密な MAP-Elites の完全実装ではありません。

Lite 版として、以下だけを行います。

- 行動特性を粗い cell に分類する
- 各 cell に、その cell で最も品質が高い候補を 1 件保持する
- 世代をまたいで archive を持ち越す
- archive の多様性、更新、置換、空振りを summary として観測する
- enabled のときだけ、少量の archive elite を次世代の親候補に混ぜる

つまり、**進化の材料をスコア一辺倒にしないための保険**です。

### 4.2 cell key の作り方

`BehaviorDescriptorLite` から deterministic な cell key を作ってください。

例:

```ts
regime|timeframe|direction|entryClass|exitClass|tradeFrequencyClass
```

ただし、実フィールド名は `behaviorDescriptorLite.ts` を読んで合わせてください。

要件:

- 同じ DSL / 同じ descriptor なら同じ key
- key の構成順は固定
- undefined / unknown は明示的に `unknown` 扱い
- 数値の微差で cell が爆発しないよう、粗いカテゴリだけを使う
- `dsl.id` は cell key に含めない
- quality score は cell key に含めない

### 4.3 quality score の優先順位

archive の代表個体を選ぶ quality score は deterministic にしてください。

推奨優先順位:

1. formal BT passed
2. OOS confirmed / OOS passed 相当の観測がある
3. profit factor
4. drawdown の低さ
5. trade count が最低基準を満たす
6. surrogate score
7. novelty score

ただし、既存型に存在しない値を無理に作らないでください。

推奨の実装方針:

- `computeQdArchiveQualityScoreV1(candidate)` を作る
- formal BT metrics / validation metrics / surrogate score など、入手可能な値だけ使う
- 欠損値は 0 または neutral に寄せる
- fatal / DSL missing / invalid DSL は archive に入れない
- 同点の場合は deterministic tie-breaker を使う
  - `qualityScore` 降順
  - `formalBtPassed=true` 優先
  - `tradeCount` 降順
  - `dsl.id` 昇順

---

## 5. 追加ファイル案

### 5.1 新規: `src/side-b/evolution/qualityDiversityArchiveLite.ts`

以下のような責務を持たせてください。

```ts
// 型名は現コードと整合するよう調整してよい
export interface QualityDiversityArchiveCandidateV1 { ... }
export interface QualityDiversityArchiveCellV1 { ... }
export interface QualityDiversityArchiveStateV1 { ... }
export interface QualityDiversityArchiveUpdateSummaryV1 { ... }
export interface QualityDiversityArchiveSummaryV1 { ... }

export function buildQdArchiveCellKeyV1(...): string;
export function computeQdArchiveQualityScoreV1(...): number;
export function createEmptyQualityDiversityArchiveV1(...): QualityDiversityArchiveStateV1;
export function updateQualityDiversityArchiveV1(...): QualityDiversityArchiveStateV1;
export function summarizeQualityDiversityArchiveV1(...): QualityDiversityArchiveSummaryV1;
export function selectQualityDiversityArchiveParentsV1(...): StrategyDSL[];
```

コメントは日本語で書いてください。

### 5.2 テスト: `src/side-b/tests/evolution/qualityDiversityArchiveLite.test.ts`

最低限、以下をテストしてください。

1. 同じ descriptor から同じ cell key が生成される
2. `dsl.id` が違っても behavior が同じなら同じ cell になる
3. behavior が違えば別 cell になる
4. 同じ cell では quality score が高い候補が代表になる
5. quality score 同点なら deterministic tie-breaker になる
6. fatal / invalid / DSL missing 系は archive に入らない
7. `maxCells` を超える場合は deterministic に制限する
8. `selectQualityDiversityArchiveParentsV1` は cell 重複を避けて返す
9. archive が空なら空配列を返す
10. summary に `cells`, `inserted`, `replaced`, `skipped`, `coverageRatio` が出る
11. input を mutation しない
12. OOS / WF metrics を再計算しない

---

## 6. multiGenerationRunner への接続

### 6.1 options 追加

`MultiGenerationEvolutionOptions` に以下を追加してください。

```ts
/** PR #108: Quality-Diversity Archive Lite を有効化するか。default false。 */
qualityDiversityArchive?: boolean;

/** PR #108: archive から次世代へ注入する親数。default 2。 */
qualityDiversityArchiveParentLimit?: number;
```

### 6.2 report 追加

`MultiGenerationEvolutionReport` に以下を追加してください。

```ts
qualityDiversityArchiveSummary?: QualityDiversityArchiveSummaryV1;
qualityDiversityArchiveUpdates?: QualityDiversityArchiveUpdateSummaryV1[];
```

### 6.3 世代ループの更新

`runMultiGenerationEvolutionV1` で以下を行ってください。

1. `qualityDiversityArchive=true` のときだけ archive state を初期化
2. 各世代の `GenerationReport` 完了後、archive を更新
3. 次世代の `runOneGeneration` に archive elite parent を少量渡す
4. `qualityDiversityArchive=false` のときは完全に既存挙動と同じ

擬似コード:

```ts
let qdArchiveState = createEmptyQualityDiversityArchiveV1(...);

for (...) {
  const qdParents = qdEnabled
    ? selectQualityDiversityArchiveParentsV1(qdArchiveState, { limit })
    : [];

  const callArgs = { ... };
  if (qdEnabled) {
    callArgs.qualityDiversityArchiveParents = qdParents;
  }

  const report = await input.runOneGeneration(callArgs);

  if (qdEnabled) {
    const update = updateQualityDiversityArchiveV1(qdArchiveState, report, ...);
    qdArchiveState = update.nextState;
    qdUpdates.push(update.summary);
  }
}
```

実コードでは既存の `runOneGeneration` 型、`GenerationReport` 型に合わせてください。

---

## 7. EvolutionLoop への接続

`RunOneGenerationOptions` に以下を追加してください。

```ts
/** PR #108: Quality-Diversity Archive から渡された親候補。v1 では少量注入のみ。 */
qualityDiversityArchiveParents?: StrategyDSL[];
```

`EvolutionLoop.runOneGeneration` 内で、parent pool を作った後、archive parents を少量だけ親候補に混ぜてください。

要件:

- `qualityDiversityArchiveParents` 未指定なら完全に既存挙動
- 重複 DSL ID は除外
- 注入数は最大 2 件程度
- archive parent は formal BT 対象を増やすためではなく、mutation / crossover の材料として使う
- `parentPoolSummary` は壊さない
- 追加で `GenerationReport.errors` または `warnings` に 1 行だけ観測ログを残す

ログ例:

```txt
[info] quality diversity archive parents injected: 2 (v1 low-volume diversity injection)
```

`GenerationReport` に `qualityDiversityArchiveInjectionSummary` を追加しても構いません。ただし、既存テストの更新範囲を増やしすぎないようにしてください。

---

## 8. smoke CLI への接続

`scripts/evolution-pdca-smoke.ts` にオプションを追加してください。

```bash
--quality-diversity-archive
--qd-parent-limit 2
```

出力例:

```txt
--- qualityDiversityArchiveSummary ---
{
  "enabled": true,
  "cells": 4,
  "inserted": 4,
  "replaced": 1,
  "selectedParents": 2,
  "coverageRatio": 0.4,
  "warnings": []
}
```

multi-generation 時のみ意味を持つオプションとして扱ってください。単世代で指定された場合は warning 表示でもよいですが、落とさないでください。

---

## 9. 既存機能の保護条件

以下は絶対に壊さないでください。

### 9.1 Surrogate Rescue Lane は保護

以下の既存責務を消さないでください。

- `surrogateRescuePolicy.ts`
- `formalBtCandidateSummary`
- `normal_pass / near_miss / low_drawdown / trade_count / novelty_rescue / kill` の route 観測
- 全件正式 BT 回避の軽量選抜層

QD Archive は、Surrogate Rescue Lane の代替ではありません。

### 9.2 analysis-engine を評価正本にする

OOS / WF / formal BT の評価は analysis-engine 側を正本にしてください。

Evolution 側で Walk-forward や Monte Carlo を再実装しないでください。

### 9.3 PromotionGate / productionEligible を変えない

今回の PR で以下を変更しないでください。

- `productionEligible` の判定
- `validation_confirmed` への昇格条件
- `rejected` への降格条件
- DB migration
- EdgeStatus enum

### 9.4 PR #107 の Adaptive Budget を壊さない

以下を維持してください。

- `adaptiveRepairBudget=false` が default
- enabled のときだけ decision / summary 出力
- `productionEligibleChanged=false` の不変条件
- `MutationBudgetAllocation` を受けても v1 では観測中心
- Copilot 修正済みの `applyBudgetGuards` 不変条件

---

## 10. テスト要件

最低限、以下を追加・更新してください。

### 10.1 archive policy 単体テスト

```bash
npx jest src/side-b/tests/evolution/qualityDiversityArchiveLite.test.ts --silent
```

必須観点:

- cell key deterministic
- replacement deterministic
- maxCells deterministic
- invalid / fatal skip
- summary fields
- parent selection
- input immutable

### 10.2 multiGenerationRunner 統合テスト

`src/side-b/tests/evolution/multiGenerationRunner.test.ts` に追加。

必須観点:

1. `qualityDiversityArchive=false` default では summary が undefined
2. `qualityDiversityArchive=true` で generation ごとに archive update が出る
3. 2 世代目以降に `qualityDiversityArchiveParents` が `runOneGeneration` に渡る
4. archive enabled でも `adaptiveRepairBudgetSummary` が壊れない
5. archive enabled でも `productionEligibleByGeneration` は変わらない
6. archive が空でも落ちない

### 10.3 EvolutionLoop 接続テスト

可能なら `evolutionLoop.test.ts` に追加。

必須観点:

- `qualityDiversityArchiveParents` 未指定なら既存挙動
- 指定時に duplicate DSL ID は除外
- 指定時に mutation / crossover の parent source に少量混ざる
- formal BT 対象数を不必要に増やさない

### 10.4 smoke CLI パーステスト

既存テスト構造がある場合は追加。

- `--quality-diversity-archive`
- `--qd-parent-limit 2`
- unknown argument は従来通り error

---

## 11. 検証コマンド

### 実行場所

すべてリポジトリルートで実行してください。

```bash
cd /Users/jolly_app/projects/Trader-Note-Build-Ai
```

### 型チェック

```bash
npx tsc --noEmit -p tsconfig.json
```

### 関連テスト

```bash
npx jest src/side-b/tests/evolution/ src/side-b/tests/strategy_dsl/ src/side-b/tests/agents/ --silent
```

### smoke

初回 push 前に 1 回だけ実行してください。
Copilot 修正後は、DB / env / analysis-engine HTTP / smoke 出力形式に触った場合だけ再 smoke してください。

```bash
set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts \
  --regime breakout \
  --top-k 3 \
  --generations 3 \
  --quality-diversity-archive \
  --qd-parent-limit 2 \
  2>&1 | tail -120
```

既存運用通り、smoke は時間がかかる可能性があります。

---

## 12. PR 作成

### commit message

```bash
git add -A
git commit -m "feat(evolution): PR #108 Quality-Diversity Archive Lite"
```

### push

```bash
git push -u origin feat/pr-108-quality-diversity-archive-lite
```

### PR title

```txt
PR #108: Quality-Diversity Archive Lite
```

### PR body に含めること

- Summary
- 追加ファイル
- multi-generation runner への接続
- EvolutionLoop への archive parent low-volume injection
- smoke 結果
- productionEligible / DB migration / OOS 再計算を変更していないこと
- Surrogate Rescue Lane を保護していること

---

## 13. Copilot レビュー対応

PR 作成後は、いつも通り `pr-copilot-loop` を起動してください。

Copilot 指摘は、妥当なら修正してください。

特に出やすい指摘:

- cell key に undefined が混ざる
- maxCells 制限が insertion order 依存
- quality score の tie-breaker が不安定
- input array / archive state を mutation している
- `qualityDiversityArchive=false` 時にも report shape が変わる
- OOS / WF metrics を Evolution 側で再計算している
- archive parent 注入で formal BT 対象が増える
- warnings が世代をまたいで累積する

修正後は以下を実行してください。

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/side-b/tests/evolution/ src/side-b/tests/strategy_dsl/ src/side-b/tests/agents/ --silent
```

smoke の再実行は、修正が DB / env / analysis-engine HTTP / smoke 出力形式に触った場合のみで構いません。

---

## 14. 完了条件

この PR は、以下を満たせば完了です。

- `qualityDiversityArchiveLite.ts` が追加されている
- QD archive cell key が deterministic
- cell ごとの elite replacement が deterministic
- multi-generation runner に archive summary が出る
- enabled 時のみ archive が動く
- disabled 時は既存挙動と同等
- archive elite parent が少量だけ次世代に渡る
- formal BT 全件化していない
- Surrogate Rescue Lane が残っている
- OOS / WF を Evolution 側で再実装していない
- productionEligible / DB migration / EdgeStatus を変更していない
- 型チェック pass
- 関連 jest pass
- smoke で `qualityDiversityArchiveSummary` が観測できる
- Copilot レビューがあれば対応済み

---

## 15. 注意

今回の PR は「勝てる戦略を作る」PR ではありません。

これは、勝てる可能性のある探索空間を潰さないための PR です。

スコア上位だけを残す進化は、見た目は賢そうでもすぐ同じ顔の候補ばかりになります。人間社会と同じです。なので、cell ごとに性質の違う elite を残し、次世代に少量だけ混ぜてください。

ただし、品質の低いものを多様性という名目で甘やかさないでください。多様性は免罪符ではありません。

品質と多様性の両方を、Lit