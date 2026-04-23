# Phase 6.7c — プロンプト改訂(12エージェント)

> 親: `phase_6_7_overview.md`
> 範囲: 12エージェントのプロンプト改訂、market_observer 廃止
> 依存: `phase_6_7a_infrastructure.md` および `phase_6_7b_bt_layer.md` 完了
> 次: なし(Phase 6.7 最終段階)

---

## 0. このサブフェーズのゴール

インフラ整備(6.7a)と即時BT層(6.7b)が揃った前提で、**プロンプトを BT層前提の新しい責務に沿って書き換える**。

### 原則

1. **グローバル層に引き上げるものは各プロンプトから削除**(重複排除)
2. **責務の再定義**が必要なエージェントは本文を書き直す(局所的な修正では不十分)
3. **変更はすべて experimental として Registry に登録し、成績を見てから active 昇格**(一部例外あり)
4. **Phase 6.7c 完了時点で、各エージェントの active プロンプトが新しい構造に揃う**

---

## 1. エージェント改訂サマリー

| # | エージェント | 改訂レベル | 優先度 |
|---|---|---|---|
| 1 | **Strategy Thinker** (`strategy_thinker`) | **大改訂**(scenarios=0禁止、wait_for_trigger、BT前提) | ★★★ |
| 2 | **HypothesisGenerator** (`hypothesis_generator`) | **大改訂**(新規発見降ろし、BT投入可能な仮説に) | ★★★ |
| 3 | **Discovery** (`discovery`) | **中改訂**(レンズ統計専門家に純化) | ★★ |
| 4 | **Strategist** (`strategist`) | 小修正 | ★ |
| 5 | **DevilsAdvocate** (`devils_advocate`) | **中改訂**(BT結果反証に変更) | ★★ |
| 6 | **TrendSpecialist** (`trend_specialist`) | 中改訂(共通テンプレート化、境界ケース追加) | ★★ |
| 7 | **OscillatorSpecialist** (`oscillator_specialist`) | 同上 | ★★ |
| 8 | **VolatilityVolumeSpecialist** (`volatility_volume_specialist`) | 同上 | ★★ |
| 9 | **MutationAgent** (`mutation`) | 中改訂(BT即時検証前提) | ★ |
| 10 | **CrossoverAgent** (`crossover`) | 中改訂(同上) | ★ |
| 11 | **PromptMutationAgent** (`prompt_mutation`) | 中改訂(グローバル保護、Registry マクロ対応) | ★ |
| 12 | **MetaEvolutionAgent** (`meta_evolution`) | 小修正(グローバル保護) | ★ |
| — | `market_observer.md` | **削除**(Phase 6.7a で実施) | — |

---

## 2. Strategy Thinker 改訂(最優先)

### 2.1 責務再定義

**旧**: Market Analyst + レンズ + 候補仮説 → 自己反証 → 戦略化  
**新**: 上記 + **scenarios=0 禁止、wait_for_trigger 活用、BT前提のDSL出力**

### 2.2 削除する記述(3箇所)

現行 `strategy_thinker.md` の以下の記述は**全て削除**(単なる追記では衝突するため):

- ステップ1 末尾の「候補が空の場合は『新規仮説がないため、確信度の高いトレードは見送る』と判断し、シナリオ 0 個でノートレード推奨としてください」
- 戦略の基本特徴 5. 「見送り判断 — 条件が揃わなければシナリオ0個(ノートレード)もあり」
- 制約 「`scenarios` は 0〜3個。条件が揃わなければ 0個(ノートレード推奨)」

### 2.3 追加する記述(案、最終文面は実装時に詰める)

```markdown
## シナリオ出力の絶対原則

- **`scenarios` は必ず 1 個以上**。0 個で逃げるのは禁止
- ただし「今すぐ成行エントリー」だけが scenario ではない:
  - **現時点では条件未充足だが、条件Xが満たされたらエントリー** = `entry.type: "wait_for_trigger"`
  - **上昇してしまっているが押し目で買う**
  - **下限サポート到達待ち**
- 相場がある限り、必ず何らかのシナリオが存在する(観察継続も戦略)
- 条件が極めて曖昧でも、最低1つは wait_for_trigger で具体化せよ

## wait_for_trigger の使い方

`entry.type: "wait_for_trigger"` は以下の場合に使う:
- 現時点では成行/指値のどれも最適ではない
- しかし特定の複合条件(価格+指標+時間等)が揃えば高確度でエントリーできる

出力例:
{{WAIT_FOR_TRIGGER_EXAMPLE}}  ← 具体例をマクロで注入(実装時に用意)

## パラメータ範囲の指定

確信が持てない数値パラメータは**範囲指定**で出してよい:
{
  "parameters": {
    "rsi_period": { "kind": "range", "min": 9, "max": 21, "step": 2, "default": 14 }
  }
}
これはBTレイヤーがスイープして最適値を探す。固定値より範囲のほうが確実なら範囲で出す。

## BT前提の表現制約

あなたの出力は **DSLBacktestAdapter に自動で流れてバックテストされる**。このため:
- conditions は **機械判定可能** な形式であること
- 未来情報を参照する条件(例: "翌日の高値")は禁止
- 曖昧な自然言語条件("相場が落ち着いたら"等)は禁止、必ずレンズ特徴量で表現
```

### 2.4 出力スキーマの変更点

- `entry.type` に `"wait_for_trigger"` を追加
- `entry.triggerConditions` / `entry.maxWaitBars` / `entry.executionType` を追加(type='wait_for_trigger'時のみ)
- `parameters` フィールドを scenario に追加(省略可、範囲指定を許容)

### 2.5 後方互換

- 既存の `limit/market/stop` は維持
- 既存 `scenarios` 配列が 0 件を返しうる実装が orchestrator にあれば、**エラーとして扱う**よう修正(6.7b §6.3 と整合)

### 2.6 deploy 戦略

**2段階デプロイ**:

1. 新 strategy_thinker を `experimental` で Registry 登録
2. variantSelector 20% で流す
3. 1週間運用、scenarios=0 率 と BT通過率を比較
4. 新版が勝っていれば `active` に昇格(人間承認)
5. 旧版は `deprecated` に

ただし Strategy Thinker は現状 Registry 接続されていないため、**まず Registry 接続を実装**してから experimental 投入する。

### 2.7 実装タスク

| # | タスク |
|---|---|
| 2-1 | 新 `strategy_thinker.md` ドラフト作成(Phase 6.7c 実装時) |
| 2-2 | `planAIService.ts` を Registry 接続に改修(現状 loadPrompt 直読み) |
| 2-3 | variantSelector 接続 |
| 2-4 | `WAIT_FOR_TRIGGER_EXAMPLE` マクロ定義 |
| 2-5 | experimental で Registry 登録 |
| 2-6 | 1週間観察後、人間承認で active 昇格 |

---

## 3. HypothesisGenerator 改訂(優先度 ★★★)

### 3.1 責務再定義

**旧**: まだ誰も気づいていない偏りを新規発見する  
**新**: 現在スナップショット + 専門家分析 + Discovery示唆から、**BTに投げる価値がある仮説候補**を出す

### 3.2 削除する記述

- 「まだ誰も気付いていない偏り」という表現
- 禁止事項「文献でよく見るテクニカル戦略の組み合わせ(ゴールデンクロス、RSIダイバージェンス等)を提案しない」(**組み合わせとして使うのは許容**に緩和)
- 禁止事項「有名な戦略名(タートル、ピラミッディング等)を使わない」(Phase 7 SMC と矛盾するため)
- Phase 4b の `fixed_pips` / `swing_point` 不可記述(死文)
- ステップ3「既存仮説と比較して意味的に新規」判定(LLMに任せるには難しすぎる、BT が最終判定する)

### 3.3 残す記述

- ステップ0: 専門家分析の統合(`specialistAnalyses`)
- ステップ1: レンズ出力を物理量カテゴリで分類
- ステップ2: 異なるカテゴリから組み合わせる
- 最低2条件の組み合わせ原則
- JSON 出力スキーマの骨格

### 3.4 書き換える記述

- 役割宣言: 「新規発見」→「BTで検証可能な優位性候補の抽出」
- 禁止事項を緩和し、単独使用のみ禁止、組み合わせは許可
- 0個許容の意味を明確化: 「新規性が乏しい」→「現状から BT 適格な仮説が抽出できない極めて稀なケース」

### 3.5 追加する記述

```markdown
## BT前提の仮説形式

あなたの出す仮説は後工程で **StrategyDSLに変換されバックテストされる**。このため:
- `conditions[]` は機械判定可能(lens + feature + op + value)
- 組み合わせの指標は単独では機能しないと言われている古典的なものでも OK(例: RSI, ゴールデンクロス)
  - 重要なのは **組み合わせること** と **検証可能なこと**
- 「新規性」より「BTで勝てる可能性」を重視
- 以下は引き続き禁止:
  - 単一レンズ・単一特徴量のみに依存した仮説
  - 「なんとなく」「直感的に」等、市場構造に根差さない曖昧な理由
  - 未来情報を参照する条件

## Discovery からの示唆の扱い

入力に `discoveryHints` が含まれる場合:
- これは週次レンズ統計から Discovery エージェントが抽出したヒント
- 有効だと示唆されているレンズ組み合わせ方向を優先的に検討する
- ただし Discovery の示唆を機械的にコピーしてはいけない(既に仮説になっている)
- あくまで「探索の方向づけ」として使う
```

### 3.6 実装タスク

| # | タスク |
|---|---|
| 3-1 | 新 `hypothesis_generator.md` ドラフト |
| 3-2 | 入力型に `discoveryHints` フィールドを追加(既存 `specialistAnalyses` と並列) |
| 3-3 | experimental で Registry 登録(HG は既に Registry 接続済み、variantSelector 経由) |
| 3-4 | 2週間観察後、BT 通過率 と 仮説生成率 を比較、人間承認で active 昇格 |

---

## 4. Discovery 改訂(優先度 ★★)

### 4.1 責務再定義

**旧**: 週次レンズ統計から新規仮説候補を生成(`newHypotheses`)  
**新**: **複数レンズの統計的有効性分析、HGへのヒント生成**(仮説自身は生成しない)

### 4.2 将来の拡張(Phase 7 以降)

ダウ理論・ワイコフ・SMC・エリオット波動等、複雑な理論レンズが追加されていく。Discovery はそれらの**統計的有効性を分析する専門家**として位置づけ。

### 4.3 主要な変更点

- **`newHypotheses` 出力を削除**、代わりに `hintsForHG[]` 出力を追加
- 入力に**BT結果の統計**を追加(レンズ組み合わせ × BT通過率の集計)
- `interpretations` は維持だが、出力先を「HGが読むヒント」と明示

### 4.4 出力スキーマ案

```json
{
  "interpretations": [
    { "lensCombination": ["dow_theory", "volatility_regime"], "winRateDelta": 0.12, "sampleSize": 45, "interpretation": "..." }
  ],
  "hintsForHG": [
    {
      "promisingDirection": "low volatility + uptrend phase middle で押し目買い",
      "lensFocusAreas": ["volatility_regime", "dow_theory"],
      "rationale": "直近12週のBTでこの組み合わせが勝率+15%"
    }
  ],
  "weeklyNote": "今週の全体所感(200文字以内)"
}
```

### 4.5 実装タスク

| # | タスク |
|---|---|
| 4-1 | 新 `discovery.md` ドラフト |
| 4-2 | Discovery の入力型を拡張(BT結果統計を受け付け) |
| 4-3 | Registry 接続(現状 loadPrompt 直読み、variantSelector も未接続) |
| 4-4 | HG が `discoveryHints` を受け取るよう orchestrator 更新(§3 と連動) |
| 4-5 | experimental で登録、月次ジョブで観察 |

---

## 5. Strategist 改訂(優先度 ★、小修正)

### 5.1 変更点

現状のプロンプトは比較的クリーンだが、**入力が戦略BT結果にも拡張される**ため、以下を追加:

- 入力に `kind: 'hypothesis' | 'strategy'` が含まれることを明示
- strategy の場合、解釈観点が若干異なる(BT成績、最適化後パラメータの妥当性等)

### 5.2 軽微な修正

- 「空配列の場合は `"actionableInsights": []` と明示してください」の冗長表現を削除
- `interpretation` の文字数下限を 2-4 文 → 3-6 文に緩和(失敗要因を書き切れるように)

### 5.3 実装タスク

| # | タスク |
|---|---|
| 5-1 | 新 `strategist.md` ドラフト(小修正、experimentalなしで直接置き換え可能) |
| 5-2 | StrategistAgent コード側で入力 union を受け付ける(6.7b §5-4 と連動) |
| 5-3 | Registry active を直接更新(影響小) |

---

## 6. DevilsAdvocate 改訂(優先度 ★★)

### 6.1 現状の問題

- Strategy Thinker の自己反証と役割重複
- **`scenarios=0 時には発動しない**(orchestrator:436 で scenario ループ内のため)
- `recommendation.action: "proceed | modify | abandon"` は越権(反証専任なら判断を返すべきでない)

### 6.2 新責務案

**旧**: 戦略に対して負けシナリオ3つを文章で生成  
**新**: **BT結果を受けて、戦略の弱点を特定**

- 入力に `dslResult` と `toolResults[]` を追加
- 「BTで見つからなかった弱点」を指摘(例: 出来高薄い時間帯の挙動、スプレッド拡大期の挙動、レジーム変化時の挙動)
- `recommendation.action` は削除(最終判断は orchestrator が下す)

### 6.3 代替案(保守的)

BT結果前提に変えると影響範囲が広い。保守的には:
- **現状維持、scenario単位反証のまま**
- scenarios=0 が禁止されたことで、DevilsAdvocate は必ず発動するようになる
- BT結果対応は Phase 7 以降で検討

### 6.4 人間承認待ち事項

<<< 人間承認ゲート C1 >>>
**DevilsAdvocate の役割変更をするか、現状維持か**。BT層が動き始めてから実績を見て決める案も有力。

### 6.5 実装タスク(どちらを選んでも)

| # | タスク |
|---|---|
| 6-1 | 現状維持なら: プロンプト小修正(`recommendation.action` を外す、`scenarios=0 時は発動しない旨を明示的に書く`) |
| 6-2 | 役割変更なら: 新 `devils_advocate.md` 大幅書き換え、入力型拡張、orchestrator 呼び出し位置変更 |

---

## 7. 専門家3本の共通テンプレート化(優先度 ★★)

### 7.1 共通ルールのグローバル化

専門家3本に共通する内容は、以下の2系統に分ける:

#### グローバル層(`__global__`)に入れるもの

既に 6.7a §1.3 で定義済みの内容に加えて、専門家共通を補強:

- confidence の下げ方(欠損・矛盾・不明瞭時は 0.3 以下)
- 無データ時は `"no_data"` / `null` で明示
- 担当領域外の判定をしない(責務境界遵守)

#### 専門家共通テンプレート(`_specialist_common.md`、新規)

専門家固有だが3本に共通する内容:

```markdown
# 専門家共通ルール

## 必ず含める出力フィールド
- `interpretation`: **80文字以上** の日本語解釈。どの特徴量のどの値で判定したかを明示
- `confidence`: 0.0〜1.0、グローバルルールに従う

## 境界ケースの扱い
- 明瞭な判定ができない → 低 confidence + `interpretation` で「判定困難な理由」を明示
- レンズ特徴量の欠損 → `no_data` / `null` で明示
- 他専門家と矛盾しそうな判定 → 気にせず自分の領域で判断する(矛盾統合は上位エージェントの責務)

## 担当領域の境界
- 自分の担当外のフィールドは出さない
- 担当外に関する示唆は `interpretation` にも書かない
- 参考情報として渡された他レンズの値は、自分の判定の補助に使うだけ
```

### 7.2 各専門家プロンプトの変更点

#### 共通変更
1. 共通ルール部分を削除(グローバル層+共通テンプレートに移管)
2. **境界ケースの出力例を1つ追加**(低 confidence / no_data / 矛盾時)
3. レンズ名のハードコードを**可能な範囲で**抽象化(完全抽象化は難しいので、「現在のレンズ」として参照)

#### Trend Specialist 固有
- 境界ケース例: dow_theory は uptrend だが MA が綺麗に並んでいない
- confidence を下げる場面の具体を追加

#### Oscillator Specialist 固有
- 境界ケース例: RSI が 50 近辺で方向感なし
- 閾値(RSI 70/30, Stochastic 80/20)は**指針**であって、強トレンド中は調整していい旨を明示
- `divergence` に**隠れダイバージェンス** をオプションで追加検討(Phase 7 で判断)

#### VolatilityVolume Specialist 固有
- 境界ケース例: normal regime で breakoutRisk の判定指示
- `breakoutRisk` の normal 時の指針を明示

### 7.3 SMC 専門家の Phase 7 での追加

Phase 7 で追加する SMC 専門家も、**グローバル層+共通テンプレート+SMC固有** の3層構造で作る。本フェーズで共通テンプレートを整備することで、Phase 7 での追加コストが大幅減る。

### 7.4 実装タスク

| # | タスク |
|---|---|
| 7-1 | `_specialist_common.md` 新設(Registry に `__specialist_common__` として登録) |
| 7-2 | specialistCommon.ts を拡張:global + specialist_common + agent local の3層合成 |
| 7-3 | 各専門家プロンプトから共通部分を削除、固有部分のみ残す |
| 7-4 | 境界ケース出力例を各専門家に1つずつ追加 |
| 7-5 | experimental で登録、variantSelector で観察 |

---

## 8. 進化系4本の改訂(優先度 ★)

### 8.1 mutation / crossover(DSL変異)

#### 共通変更
- **BT層への接続を明示**: 「あなたの出力は即時BTで検証される」と記載
- **生成個数を明示**: mutation は 3-5 個、crossover は 1 個
- **機械判定可能性の強調**: DSL スキーマ準拠を明示

#### mutation 固有
- 変異の種類に **SL/TP の変異** を追加(現状なし)
- **regime_target の変異** は引き続き禁止(単一レジーム前提)

#### crossover 固有
- 交配パターンの例を増やす(現状1つ → 3つに)

### 8.2 prompt_mutation

#### 変更点
- **グローバル変異禁止** を明示: `__global__` / `__specialist_common__` は変異対象外
- **Registry マクロ対応**: 「入力の `currentPrompt.content` に `{{KEY}}` が残っている場合、それはマクロプレースホルダ。変異してはいけない(展開は実行時に行われる)」
- 3案多様性の具体例を追加

### 8.3 meta_evolution

#### 変更点
- **グローバル/共通テンプレート保護**: `__global__` / `__specialist_common__` への add / modify / deprecate 提案禁止を明記
- `proposals[].initialPrompt` はローカル部分のみ(グローバルは自動継承)を明示
- Phase 7 SMC 追加時のガイドライン(共通テンプレート使用)を追記

### 8.4 実装タスク

| # | タスク |
|---|---|
| 8-1 | mutation.md / crossover.md 改訂(既存が短すぎるので追記中心) |
| 8-2 | prompt_mutation.md にグローバル保護指示を追加 |
| 8-3 | meta_evolution.md にグローバル/共通テンプレート保護を追加 |
| 8-4 | `PromptMutationAgent` のコード側でも `__global__` / `__specialist_common__` を除外(二重防御) |

---

## 9. 推奨デプロイ戦略

### 9.1 変更の優先度とデプロイ順序

| 順序 | 対象 | デプロイ方式 |
|---|---|---|
| 1 | Strategist(小修正) | active 直接更新 |
| 2 | 専門家3本 | experimental → variantSelector → 1〜2週間観察 → 昇格 |
| 3 | Discovery | experimental → 月次ジョブで観察 → 昇格 |
| 4 | HG | experimental → variantSelector → 2週間観察 → 昇格 |
| 5 | Strategy Thinker | Registry 接続後 experimental → 1週間観察 → 昇格(最重要のため慎重に) |
| 6 | DevilsAdvocate | 現状維持か役割変更かを5以後に判断 |
| 7 | 進化系4本 | active 直接更新(Registry 接続済みは experimental) |

### 9.2 ロールバック戦略

- experimental デプロイの場合、variantSelector が自動で即時中止判定(§4-5 variantSelector `shouldReject`)
- active 直接更新の場合、Git から元プロンプトに戻せば Registry で再 seed される
- 重要プロンプト(Strategy Thinker)は**デプロイ前に旧版をバックアップ**(seed 時に `notes: "pre-phase-6.7c backup"` で deprecated として保存)

---

## 10. Phase 6.7c の完了判定

- [ ] グローバル層(`__global__`)が運用されている(6.7a から引き継ぎ)
- [ ] 専門家共通テンプレート(`__specialist_common__`)が運用されている
- [ ] 12エージェント全てが新構造(global + 共通テンプレート[該当のみ] + local)で動作
- [ ] `scenarios=0` 出力が月次 5% 未満(overview §6 の成功判定指標)
- [ ] HG が `discoveryHints` を受け取れる
- [ ] Discovery が `hintsForHG` を出せる
- [ ] `market_observer.md` が削除されている
- [ ] PromptMutation / MetaEvolution がグローバル/共通テンプレートを保護する(テスト通過)
- [ ] 運用観察2週間で重大問題なし

---

## 11. 人間承認ゲート

| # | 承認ポイント | タイミング |
|---|---|---|
| C1 | DevilsAdvocate の役割変更するか現状維持か | Phase 6.7b 完了後、BT 実績を見て |
| C2 | 新 Strategy Thinker active 昇格 | 1週間観察後 |
| C3 | 新 HG active 昇格 | 2週間観察後 |
| C4 | 新 Discovery active 昇格 | 月次ジョブ1回通過後 |
| C5 | 専門家3本の active 昇格 | 2週間観察後 |
| C6 | 共通テンプレート `__specialist_common__` の初版文面 | 実装前 |
| C7 | 進化系プロンプト active 更新 | 実装前(小修正) |

---

## 12. 推定作業量

- プロンプトドラフト12本: 3 日
- Registry 接続の未実装エージェント対応: 1 日
- グローバル/共通テンプレート注入機構のテスト: 1 日
- experimental デプロイと variantSelector 設定: 1 日
- 観察期間中のモニタリングと調整: 2〜4 週間

**合計(実装): 約 6 日** + 観察期間

---

## 13. Phase 6.7 全体完了 → Phase 7 へ

Phase 6.7a / 6.7b / 6.7c 全てが完了し、overview §6 の成功判定指標を満たしたら、運用観察期間を 2〜4 週間設け、問題がなければ **Phase 7 (SMC)** に進む。

Phase 7 での主な作業(予告):
- SMC レンズの追加(Order Block, FVG, Liquidity Sweep 等)
- SMC 専門家エージェントの追加(本フェーズで整備した共通テンプレートを使用)
- HG / Discovery / Strategy Thinker が SMC レンズを扱えるよう入力拡張(プロンプト文面は基本変えない)
- SMC 用のテスト戦略のBT
