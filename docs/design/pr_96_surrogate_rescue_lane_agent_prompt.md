# 実装指示: PR #96 Surrogate Rescue Lane

## 位置づけ

この文書は **PR #96 専用の実装指示** である。

PR #95 では、親個体プール v1 により `formal_bt_passed / current_population / novelty_seed` の3系統から mutation / crossover の親候補を取得できるようになった。

PR #96 では、次の問題を扱う。

> mutation / crossover によって候補は生成されているが、surrogate 評価の主要条件を通過できず、正式バックテスト候補が 0 件になる世代がある。

本PRの目的は、surrogate 条件そのものを安易に緩和することではない。  
正式BTへ送る候補抽出ルートを複数化し、`normal_pass = 0` の世代でも、理由付きで rescue 候補を観測・選抜できるようにする。

---

## 目的

既存の進化ループを壊さず、正式バックテスト候補の選抜を以下のように拡張する。

- surrogate 主要条件をすべて通過した候補は `normal_pass` として扱う
- 一部条件のみ未達の候補は `near_miss_rescue` として救済候補にできる
- 成績は弱くても構造的に新しい候補は `novelty_rescue` として救済候補にできる
- drawdown が低い候補は `low_drawdown_rescue` として救済候補にできる
- trade count が十分な候補は `trade_count_rescue` として救済候補にできる
- 明確に危険または不正な候補は `kill` として除外する

---

## このPRでやること

### 実装する

- Surrogate Rescue Lane の分類ロジック
- formal BT 候補抽出ポリシー
- `formalBtCandidateSummary` のログ出力
- rescue された候補の reason / route の保存またはレポート反映
- smoke CLI での観測
- 単体テスト

### 実装しない

- EdgeStatus enum の変更
- DB migration
- EdgeHypothesis → StrategyDSL 逆変換
- QualityDiversityArchive 本体
- BehaviorDescriptor のDB保存
- FailureReason 13分類化
- production_ready 昇格処理
- surrogate 閾値の恒久的な緩和
- final holdout / OOS / walk-forward の追加

---

## 前提

PR #95 の実装により、GenerationReport には `parentPoolSummary` が追加されている。

PR #96 では、同様に `formalBtCandidateSummary` を GenerationReport または smoke 出力で観測できるようにする。

PR #95 の設計方針は維持する。

- 既存 mutation / crossover 経路を壊さない
- DB障害時も世代継続できるようにする
- 例外や不足は summary に残す
- 実装スコープを小さく保つ

---

## 推奨ファイル構成

既存構成に合わせること。候補としては以下。

```text
src/side-b/evolution/surrogateRescuePolicy.ts
src/side-b/tests/evolution/surrogateRescue.test.ts
```

既存の surrogate / promotion candidate 抽出ロジックが別ファイルにある場合は、その近くに配置すること。

`EvolutionLoop.ts` に直接大きなロジックを書かない。  
`EvolutionLoop.ts` は orchestration のみに留める。

---

## 型定義

### SurrogateRoute

```ts
// surrogate 評価後、正式BT候補として扱う経路
export type SurrogateRoute =
  | 'normal_pass'
  | 'near_miss_rescue'
  | 'novelty_rescue'
  | 'low_drawdown_rescue'
  | 'trade_count_rescue'
  | 'kill';
```

### FormalBtCandidatePolicyV1

```ts
// 正式BT候補のカテゴリ別抽出数
export const formalBtCandidatePolicyV1 = {
  overallTopK: 3,
  nearMissTopK: 1,
  noveltyTopK: 1,
  lowDrawdownTopK: 1,
  tradeCountSufficientTopK: 1,
} as const;
```

### FormalBtCandidateSummary

```ts
// 正式BT候補抽出の観測用サマリ
export type FormalBtCandidateSummary = {
  normalPass: number;
  nearMissRescue: number;
  noveltyRescue: number;
  lowDrawdownRescue: number;
  tradeCountRescue: number;
  killed: number;
  uniqueCandidates: number;
  duplicateRemoved: number;
  fallbackApplied: boolean;
  fallbackReason: string | null;
};
```

### RescuedFormalBtCandidate

既存の `EvolutionPromotionCandidate` に route を追加できる場合は、既存型を拡張する。  
難しい場合は、PR #96 内部だけで使う別型を用意する。

```ts
// rescue 経路付きの正式BT候補
export type RescuedFormalBtCandidate = {
  candidateId: string;
  dslId: string;
  route: SurrogateRoute;
  score: number;
  reason: string;
  rankInRoute: number;
};
```

---

## 抽出方針

### 1. normal_pass

既存の surrogate 条件をすべて満たした候補。  
既存の promotion candidate 抽出ロジックがある場合、それを最優先で尊重する。

このPRでは surrogate 閾値を緩和しない。

### 2. near_miss_rescue

主要条件のうち、1つだけ未達の候補を救済対象にする。

例:

- PF は少し足りないが、trade count と drawdown は条件内
- drawdown は少し超過したが、PF と trade count は良い
- trade count はやや不足だが、PF と drawdown が良い

実コードに surrogate 条件の個別判定結果が存在しない場合は、既存スコア・メトリクスから v1 として近似する。

### 3. novelty_rescue

現時点では BehaviorDescriptor 本体を実装しない。  
そのため v1 では、以下のいずれかで簡易 novelty を扱う。

- candidateHash が既存 formal BT 候補と重複しない
- DSL id / structure hash が既存候補と重複しない
- entry / exit / indicator family の簡易文字列が既存候補と異なる
- 上記が難しい場合は、score 上位以外からランク分散で1件選ぶ

PR #96 の novelty は厳密でなくてよい。  
目的は、総合スコア上位だけに候補が偏らないようにすることである。

### 4. low_drawdown_rescue

PF や期待値が弱くても、drawdown が相対的に小さい候補を1件拾う。

これは将来の defensive strategy の素材になる可能性があるため。

### 5. trade_count_rescue

取引回数が十分な候補を1件拾う。

取引回数が少ない高PF個体より、多少弱くても検証可能なサンプル数を持つ個体を正式BTに送る価値がある。

### 6. kill

以下は救済しない。

- StrategyDSL schema validation に失敗
- 取引回数が 0
- 明らかな異常値
- maxDrawdown が破綻レベル
- analysis-engine error
- dsl_missing
- lookahead suspected 相当の理由がある

---

## 重複排除

複数ルートで同じ候補が選ばれる可能性があるため、必ず重複排除する。

優先順位は以下。

```text
normal_pass
  > near_miss_rescue
  > low_drawdown_rescue
  > trade_count_rescue
  > novelty_rescue
```

同じ `dsl.id` または `candidateHash` が複数ルートに現れた場合、優先順位の高い route を採用する。

`duplicateRemoved` を `formalBtCandidateSummary` に記録する。

---

## EvolutionLoop への統合

既存の流れを大きく変えない。

想定フロー:

```text
population 評価
  ↓
elites 抽出
  ↓
parentPool 構築
  ↓
removeWorst
  ↓
mutation / crossover
  ↓
新候補を population に追加
  ↓
formal BT 候補抽出
    - normal_pass
    - near_miss_rescue
    - novelty_rescue
    - low_drawdown_rescue
    - trade_count_rescue
    - kill
  ↓
formalBtCandidateSummary を report に追加
```

既存の `promotionCandidates` がある場合、PR #96 では以下のどちらかにする。

### 推奨A

既存 `promotionCandidates` の生成関数を内部で拡張し、route 情報を付与する。

### 代替B

既存 `promotionCandidates` は維持し、別途 `formalBtCandidates` / `formalBtCandidateSummary` を追加する。

大きな型変更が必要になる場合は、代替Bを選ぶ。

---

## smoke 出力

`scripts/evolution-pdca-smoke.ts` に以下を出す。

```text
--- formalBtCandidateSummary ---
{
  "normalPass": 0,
  "nearMissRescue": 1,
  "noveltyRescue": 1,
  "lowDrawdownRescue": 1,
  "tradeCountRescue": 1,
  "killed": 3,
  "uniqueCandidates": 4,
  "duplicateRemoved": 1,
  "fallbackApplied": true,
  "fallbackReason": "normal_pass=0; rescue lanes used"
}
```

`normalPass = 0` でも、rescue により `uniqueCandidates > 0` になれば成功。  
ただし、全候補が kill 条件に該当する場合は `uniqueCandidates = 0` を許容し、その理由を `fallbackReason` または summary に残す。

---

## テスト要件

`surrogateRescue.test.ts` に以下のテストを追加する。

### 必須テスト

1. normal pass が存在する場合、優先的に正式BT候補へ入る
2. normal pass が 0 件でも near_miss_rescue が選ばれる
3. low_drawdown_rescue が drawdown 最小候補を拾う
4. trade_count_rescue が trade count 十分な候補を拾う
5. novelty_rescue が総合上位以外から候補を拾う
6. kill 条件に該当する候補は rescue されない
7. 同一候補が複数routeに入った場合、重複排除される
8. duplicateRemoved が summary に反映される
9. normalPass=0 かつ rescue 使用時に fallbackApplied=true になる
10. rescue 候補が 0 件の場合も例外を投げず summary に理由を残す

---

## 実装制約

- `any` を使わない
- 既存型で足りない場合は最小の type を追加する
- StrategyDSL は必ず schema validation する
- validation error は握りつぶさない
- route / reason はログまたは report から追えるようにする
- DB migration はしない
- 既存テストを壊さない
- 大きな refactor はしない

---

## 禁止事項

- surrogate 閾値を単純に下げない
- rescue 候補を `confirmed` 扱いしない
- rescue 候補を production candidate として扱わない
- EdgeStatus enum を変更しない
- EdgeHypothesis を親ソースに入れない
- QualityDiversityArchive を実装しない
- OOS / walk-forward をこのPRで追加しない
- DB schema を変更しない
- failed candidate を無条件に救済しない

---

## 完了条件

以下を満たしたら PR #96 完了。

- `formalBtCandidateSummary` が GenerationReport または smoke 出力で観測できる
- `normalPass = 0` でも rescue route により候補抽出が可能
- 全候補 kill の場合も落ちず、理由が summary に残る
- rescue route ごとの件数が分かる
- duplicateRemoved が観測できる
- rescue 候補と normal pass 候補が区別されている
- rescue 候補は昇格扱いされていない
- 既存 mutation / crossover / parentPool 経路が壊れていない
- 対象テストが通る
- smoke 実行で formalBtCandidateSummary が確認できる

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
- Surrogate Rescue Lane を追加
- normal_pass / near_miss_rescue / novelty_rescue / low_drawdown_rescue / trade_count_rescue / kill を分類
- formalBtCandidateSummary を smoke / GenerationReport で観測可能にした

## Scope
- DB migration なし
- EdgeStatus enum 変更なし
- EdgeHypothesis → StrategyDSL 逆変換なし
- QualityDiversityArchive なし
- production_ready 昇格なし

## Verification
- npx tsc --noEmit -p tsconfig.json
- npx jest src/side-b/tests/evolution/ src/side-b/tests/strategy_dsl/ src/side-b/tests/agents/ --silent
- set -a && . ./.env && set +a && npx tsx scripts/evolution-pdca-smoke.ts --regime breakout --top-k 3

## Smoke Observations
- parentPoolSummary:
- formalBtCandidateSummary:
```

---

## 最重要判断基準

PR #96 の目的は、弱い候補を無理やり合格させることではない。

目的は、正式BT候補 0 件という状態を、以下のように分解して観測可能にすることである。

```text
本当に候補がないのか
惜しい候補はあるのか
低DD候補はあるのか
取引回数が十分な候補はあるのか
構造的に新しい候補はあるのか
危険なので kill すべき候補ばかりなのか
```

このPRでは、`rescue = 昇格` ではない。  
`rescue = 正式BTで確認する価値がある候補として送る` という意味に限定する。

実装判断に迷った場合は、以下を優先する。

1. surrogate 閾値を緩めず、候補抽出ルートを増やす
2. rescue と normal pass を明確に分ける
3. rescue 理由を summary に残す
4. 全候補 kill でも落とさず理由を残す
5. 既存 parentPool / mutation / crossover 経路を壊さない
6. DB migration や status enum 変更を避ける
7. PR #96 のスコープを小さく保つ

---

## エージェントへの最終指示

まず現在の正式BT候補抽出ロジック、promotion candidate 抽出ロジック、surrogate score の構造を確認すること。

その上で、最小差分で `surrogateRescuePolicy.ts` を追加し、既存の `EvolutionLoop.ts` に統合すること。

このPRで目指すのは、自律進化の完成ではない。  
正式BT候補が 0 件になる世代を、`normal_pass / rescue / kill` に分解して観測可能にすることである。

実装後は、型チェック、対象テスト、smoke を実行し、PR本文に `formalBtCandidateSummary` の実測ログを貼ること。

