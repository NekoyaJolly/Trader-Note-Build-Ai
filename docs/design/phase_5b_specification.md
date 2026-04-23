# フェーズ5B 仕様書(設計ドラフト): 進化ループ候補と Phase 4c 精密検証の接続

> **ステータス**: 未実装、設計ドラフト
> **期間目安**: 1-2週間(設計固まり次第)
> **目的**: Phase 5A で生成される `EvolutionPromotionCandidate` を、Phase 4c の精密検証パイプラインに接続する
> **前提**: Phase 5A 完了、Phase 4c 完了、運用観察による品質評価済み
> **位置付け**: Phase 5A で意図的に切り離した「自動昇格」機能を、意味論を壊さない形で再導入する

---

## 0. このフェーズの位置付け

### 0.1 背景

Phase 5A の設計判断として、進化ループ内での **自動 confirmed 昇格を停止** した。これにより:

- ✅ confirmed の意味論が保たれた(全 confirmed が Phase 4c を通っている)
- ✅ Phase 4c との役割分担が明確になった
- ❌ 進化ループ由来の優秀な戦略が confirmed まで届かない状態になった

Phase 5B の目的は、**進化ループの成果を confirmed まで導く経路を再構築する** こと。ただし Phase 5 旧仕様のように安易に自動昇格させるのではなく、Phase 4c の精密検証を通す形で。

### 0.2 設計の前提条件

Phase 5B の設計に入る前に、以下の運用観察データが揃っていることが望ましい:

1. Phase 5A で `EvolutionPromotionCandidate` が何件/日 発生しているか
2. candidate の品質は実運用でどう評価されるか(目視レビューで)
3. Phase 4c のフル検証に耐えられる candidate がどのくらいの割合か
4. Phase 4c の処理能力(日次検証件数の上限)との整合性

データなしに設計すると、再び意味論が壊れるか、スループットが現実的でない実装になる。

---

## 1. このフェーズのゴール

Phase 5A の `EvolutionPromotionCandidate` を、Phase 4c のフル検証(WF/MC/BH)を通して confirmed まで導く経路を実装する。

要件:

- 進化ループ由来と人間/Discovery 由来の confirmed が **同じ検証経路** を通る
- 進化ループのスループット(日々生成される candidate 数)と Phase 4c の処理能力が整合する
- 進化由来であることがメタデータで識別可能(UI 表示含む)
- 既存 Phase 4a/4b/4c の仕組みを壊さない

---

## 2. 主要な設計判断事項

実装前に確定すべき設計判断を列挙する。運用データと議論を経て確定する。

### 判断1: candidate の EdgeLedger 登録方針

4つの選択肢:

#### 選択肢A: unverified として登録 → Phase 4b スクリーニング経由

```
EvolutionPromotionCandidate 
  → EdgeLedger.create({ status: 'unverified', source: 'evolution', ... })
  → 既存の ScreeningOrchestrator が拾う
  → screening_passed
  → Phase 4c StrategistAgent
  → confirmed or rejected
```

**メリット**:
- 既存フローに完全に乗る
- 全仮説が同じパスを通る(設計的に綺麗)
- Phase 4b の軽量スクリーニングで弱い candidate を早期除外

**デメリット**:
- Phase 4b の Side-A BacktestService が DSL を受け付けられるか? (MaterializationService が DSL 対応していない可能性)
- 実装前に MaterializationService の DSL 対応可否を確認する必要

#### 選択肢B: screening_passed として直接登録

```
EvolutionPromotionCandidate
  → EdgeLedger.create({ status: 'screening_passed', source: 'evolution', screeningResult: { ... 進化ループでの TS バックテスト結果 ... } })
  → 既存の StrategistAgent(Phase 4c)が拾う
  → confirmed or rejected
```

**メリット**:
- 進化ループ内の TS バックテスト結果を screening 相当と見なす
- Phase 4b をスキップできる

**デメリット**:
- `screening_passed` の意味論が「Phase 4b の Side-A BT を通った」から揺らぐ
- 他 AI との議論で過去に否定された案(作業ログ.txt より)
- **この選択肢は避けるべき**

#### 選択肢C: 専用ステータス(`evolution_candidate`)を新設

```
EvolutionPromotionCandidate
  → EdgeLedger.create({ status: 'evolution_candidate', source: 'evolution', ... })
  → 専用ジョブが拾う
  → Phase 4c StrategistAgent(TradeNote materialize をスキップするパス)
  → confirmed or rejected
```

**メリット**:
- ステータス意味論が明確(進化由来の検証待ちであることが一目瞭然)
- 人間由来 screening_passed と混在しない

**デメリット**:
- 新ステータス追加で StatusManager の修正範囲が広がる
- StrategistAgent に「TradeNote 不要パス」を追加する改修が必要

#### 選択肢D: 登録せず JSON レポートのまま

```
EvolutionPromotionCandidate
  → data/evolution/strategy-population.json にとどまる
  → UI で別セクション「進化候補」として表示
  → 人間が手動で EdgeLedger に昇格させるボタンを設置
```

**メリット**:
- EdgeLedger に手を入れない
- 人間の目によるフィルタが入る
- 実装が最小

**デメリット**:
- 自動化されない(人間のボトルネック)
- 進化ループの価値が半減

### 判断2: EdgeSource 型への 'evolution' 追加

現状、Phase 5A 旧実装では `source='backtest'` として EdgeLedger に登録されていた(type に 'evolution' が含まれていなかった)。

**Phase 5B で対応すべきこと**:

1. `EdgeSource` 型に `'evolution'` を追加
2. 既存データの source を 'backtest' から 'evolution' に修正するマイグレーション(過去に登録された進化由来仮説がある場合のみ)
3. UI 側で source 別の表示・フィルタを追加

マイグレーションは最小限。過去に進化由来仮説がゼロ件なら、型追加のみで完了。

### 判断3: Phase 4c との接続実装方式

StrategistAgent 側で DSL / EvolutionPromotionCandidate をどう受け取るか:

#### 方式α: MaterializationService で DSL → TradeNote 変換

DSL を TradeNote に materialize してから Phase 4c に渡す。

**課題**:
- MaterializationService は MachineReadableCondition を変換する実装
- DSL(より表現力の高い構造)を MachineReadableCondition に変換できるか?
- `dslEdgeMapper.ts`(Phase 5A で残置)を使って DSL → MachineReadableCondition が可能

#### 方式β: Python ツール群に DSL を直接渡す

WalkForwardTool, MonteCarloTool, BuyAndHoldTool が DSL を直接受け取れるよう改修。

**メリット**:
- 変換の損失がない
- DSL の表現力を活かせる

**デメリット**:
- Phase 4c のツール群の入力仕様変更が必要
- Python 側も DSL パース実装が必要

#### 方式γ: 進化ループ専用の検証経路を新設

Phase 4c の検証エージェントを流用しつつ、進化ループ専用の入力経路を追加:

```
EvolutionPromotionCandidate → SpecialMaterializationPath → Phase 4c Python ツール群
```

**メリット**:
- Phase 4c の共通コードを再利用できる
- 既存の MaterializationService を改修せずに済む

**デメリット**:
- 経路が2系統になる複雑さ

### 判断4: スループット設計

進化ループが日々生成する candidate 数と、Phase 4c の処理能力の整合性:

- 進化ループ(autoEvolution=true 想定): 1日 数十〜数百 candidate 生成の可能性
- Phase 4c の日次検証上限: 現状 5件 / 日
- **明らかなボトルネック**

解決策の候補:
- 進化ループ側で「特に有望な candidate のみ昇格させる」フィルタ追加
- Phase 4c の処理能力拡張(Python コンテナの並列化)
- 両方のハイブリッド

### 判断5: UI 表示

Phase 4d の仮説一覧・詳細で進化由来仮説をどう表示するか:

- source='evolution' バッジ表示(既に Phase 4d で実装済み、使うか使わないか)
- フィルタで「進化由来のみ表示」オプション追加
- 進化候補セクション(Phase 4c 検証前の中間状態)の表示

---

## 3. 実装の進め方(案)

### 3.1 段階的アプローチ

全部一気に実装せず、段階的に:

**ステップ1: 運用観察フェーズ(数週間〜数ヶ月)**
- Phase 5A 完了後、Phase 6 着手前の運用観察期間
- 進化ループを手動トリガーで月1-2回実行
- candidate の件数・品質を目視レビュー
- この期間のデータで判断1-5を確定

**ステップ2: 最小実装(選択肢 D 相当)**
- candidate を JSON に残したまま、UI で手動昇格ボタン設置
- 人間の判断を通過した candidate のみ EdgeLedger 登録
- 動作確認、品質観察

**ステップ3: 自動化(選択肢 A または C)**
- ステップ2 で品質が十分なことを確認できたら、自動化に進む
- 選択肢 A(既存フロー流用)を第一候補、問題があれば選択肢 C(専用ステータス)

### 3.2 選択肢 A を採用した場合の実装スコープ

最も実装が小さい選択肢 A を想定したスコープ:

1. `EdgeSource` 型に 'evolution' 追加
2. Phase 5A `EvolutionLoop` から `EdgeLedger.create()` を呼ぶパスを追加(ただし `markConfirmed` は呼ばない)
3. `MaterializationService` で DSL 仮説を変換できるよう拡張(`dslEdgeMapper` を活用)
4. テスト追加
5. 既存 Phase 4b スクリーニングジョブが拾うことを確認

---

## 4. スコープ外(このフェーズでも扱わない)

- 進化ループの LLM プロンプト進化(Phase 6.3)
- 新しいレンズ種(Phase 6.1, 6.2)
- 実発注ゲート(Phase 7 以降)
- 日次サマリーシステム(別フェーズ)

---

## 5. 制約事項

### 5.1 守るべき制約

- **confirmed の意味論を壊さない**: 全 confirmed が Phase 4c を通っている保証を維持
- **Phase 4a/4b/4c の既存コードに破壊的変更を加えない**: 拡張のみ許容
- **既存テストを壊さない**: 回帰ゼロ

### 5.2 リスク

- スループット問題: Phase 4c の処理能力不足で candidate が滞留する可能性
- 品質問題: 進化由来 candidate が Phase 4c で高頻度に rejected される可能性(これ自体は悪いことではないが、LLM コストが無駄になる)
- 設計選択の後戻り: 判断1-5 の選択を間違えると、Phase 5A 同様に仕様書書き直しになる

---

## 6. Phase 5A からの引き継ぎ情報

### 6.1 Phase 5A 側で既に準備済みのもの

- `EvolutionPromotionCandidate` 型(必要なメタデータ含む)
- `dslEdgeMapper.ts`(DSL → MachineReadableCondition 変換、残置済み)
- 昇格判定基準(学習 PF > 1.5, 検証 PF > 1.3, 過学習 < 0.3)
- GenerationReport の保存(JSON レポートとして)

### 6.2 Phase 5B で追加・変更するもの

- `EdgeSource` 型への 'evolution' 追加
- EdgeLedger 登録パス(選択肢に応じた実装)
- UI 側のフィルタ・表示(Phase 4d の拡張)
- テスト

---

## 7. 開始の判断基準

Phase 5B に着手するタイミング:

### 7.1 着手推奨のシグナル

- 運用観察で「進化ループ由来の有望 candidate が定期的に生成されている」ことが確認できた
- Phase 4c の処理能力に余裕がある、または拡張計画がある
- Phase 6 のサブフェーズで急ぎのものがない

### 7.2 着手を保留すべきシグナル

- 進化ループが手動でも回されていない(そもそも価値検証されていない)
- Phase 4c のスループットが逼迫している
- Phase 6 のプロンプト進化(Phase 6.3)が進化ループに影響する可能性がある(こちらを先にやるべき)

---

## 8. 未確定事項

以下は Phase 5B 着手時に確定する:

- 判断1(candidate の EdgeLedger 登録方針): A / C / D のいずれか
- 判断3(Phase 4c との接続実装方式): α / β / γ のいずれか
- 判断4(スループット設計): 具体的な数値調整
- 実装期間: 選択肢により 1-2週間〜4-6週間

---

## 9. Phase 5B 着手前のチェックリスト

着手する前に、以下が明確になっていること:

- [ ] 運用観察で進化ループ候補の数と品質が把握できている
- [ ] Phase 4c の処理能力(日次検証上限)が現状と将来で明確
- [ ] EdgeSource 型拡張の DB 影響が評価済み
- [ ] MaterializationService の DSL 対応可否が検証済み(dslEdgeMapper の動作確認)
- [ ] 選択肢 A/C/D のうち採用するものが決定
- [ ] Phase 6 の進行状況と干渉しないタイミング
