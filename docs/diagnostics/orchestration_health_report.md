# AI オーケストレーション健全性診断レポート

> 診断日: 2026-04-30
> 診断対象: 本番(Supabase / `rmsylwmqxyeqgplysqoa`) + コードベース `main` + 作業ブランチ `fix/backend-lint-hardening`
> 診断者: Claude Code (Opus 4.7, 1M context)
> 種別: 調査・診断のみ(コード修正なし)

---

## 0. Executive Summary

- **稼働確認できたエージェント**: 12 中 **4 体のみ**(`hypothesis_generator` / `trend_specialist` / `oscillator_specialist` / `volatility_volume_specialist`)
- **死蔵またはトラッキング無効**: 8 体(`strategy_thinker` / `strategist` / `devils_advocate` / `discovery` / `mutation` / `crossover` / `prompt_mutation` / `meta_evolution`)。プロンプト本体は active として DB に存在するが Registry 経由ではないため使用記録が一切残らない。完全死蔵の `market_observer` は seed 時点で除外済み。
- **PDCA-1(プロンプト進化)**: ✗ **完全停止**。`PromptVersion.status='experimental'` は **0 件**、`rejected` も **0 件**、`PromptAbTestResult` も **0 件**。`autoTriggerPromptEvolution=false` のため自動実行はされず、CLI 経由でも 1 度も走っていない。
- **PDCA-2(戦略進化)**: ✗ **第4段階で止まっている**。仮説 72 件のうち **66 件(92%)が `not_testable`**、いずれも *「Materialization失敗: atr_multiple SL を要求されたが ATR が取得できない」* という同一の例外で詰まっている。**`screening_passed` / `testing` / `confirmed` / `rejected` のいずれにも到達した仮説は 0 件**。
- **重大問題**: **8 件**(後述 §5)
- **軽微問題**: **6 件**(後述 §5)

### 3 行サマリー

1. プロンプト進化サイクルは **発火経路すら存在しない**(autoTrigger off + CLI 未実行 + 0 experimental)。Registry に乗っているのは 4 体だけで、残り 8 体は active プロンプトを 4/25 に sync しただけで以後何も起きていない。
2. 戦略進化サイクルは仮説生成までは回っている(178 回呼び出し / 72 仮説)が、**スクリーニングの materialize 段階で 100% 失敗**しており、Strategist / 4 ツール検証 / EdgeLedger 昇格はすべて 0 件。
3. プラン生成パイプラインは 1 日 1 件で稼働中だが、**直近 14 日のプランの半分は scenarios=0 / tokenUsage=0**(no-trade判断 or cached)、残り半分も全て `overallConfidence=0` で Devil's Advocate が abandon している模様。

---

## 1. エージェント別棚卸し

### サマリー表(直近の Registry 経由呼び出し統計)

| エージェント | 取得経路 | usageCount | avgScore | last_called | 判定 |
|---|---|---|---|---|---|
| `hypothesis_generator` | Registry + variantSelector | 178 | 0.6464 | 2026-04-30 09:38 | 現役 |
| `oscillator_specialist` | Registry + variantSelector | 129 | 0.7087 | 2026-04-30 09:37 | 現役 |
| `volatility_volume_specialist` | Registry + variantSelector | 133 | 0.7508 | 2026-04-29 03:14 | 現役 |
| `trend_specialist` | Registry + variantSelector | 189 | 0.5462 | 2026-04-29 03:14 | 現役、avgScore 低い |
| `strategy_thinker` | loadPrompt 直読み | 0(記録なし) | 0 | n/a | 暗黙稼働(planAIService 経由) |
| `strategist` | loadPrompt 直読み | 0 | 0 | n/a | 暗黙稼働(ただし screening_passed 仮説 0 件のため発火していない可能性大) |
| `devils_advocate` | loadPrompt 直読み | 0 | 0 | n/a | 暗黙稼働(orchestrator §5) |
| `discovery` | loadPrompt 直読み | 0 | 0 | n/a | 暗黙稼働(週次)、ただし source='discovery' 仮説 0 件 |
| `mutation` | loadPrompt 直読み | 0 | 0 | n/a | 死蔵(EvolutionLoop は autoEvolution=false) |
| `crossover` | loadPrompt 直読み | 0 | 0 | n/a | 死蔵(EvolutionLoop は autoEvolution=false) |
| `prompt_mutation` | loadPrompt 直読み | 0 | 0 | n/a | 死蔵(autoTriggerPromptEvolution=false) |
| `meta_evolution` | loadPrompt 直読み | 0 | 0 | n/a | 死蔵(`AgentRestructureProposal` 0 件) |

> **重要**: 「死蔵」は「コードに存在しないこと」ではなく、**現在のフラグ設定下では発火経路に到達しない** という意味。

### 1.1 `strategy_thinker`

- **稼働状況**: `planAIService.ts:337` 経由で 1 日 1 回呼ばれる(直近 30 日で 60 件のプラン生成 = 60 回呼び出し相当)
- **取得経路**: `loadPrompt('strategy_thinker', { CORE_TRADING_RULES, MACRO_ENVIRONMENT_RULES, MTF_ANALYSIS_RULES })` の単純呼び出し。Registry / variantSelector を通らない
- **マクロ展開**: 3 種(現状唯一マクロを使用しているエージェント)
- **入力**: `PlanAIInput`(research / userPreferences / higherTF / lensSnapshot / candidateHypotheses / specialistAnalyses)
- **出力**: `{ scenarios: AITradeScenario[], marketAnalysis, overallConfidence, warnings }` を `AITradePlan` として保存
- **直近 14 日の出力傾向**:
  - 10 プラン中 **5 件が scenarios=0, tokenUsage=0**(no-trade or cached)
  - 残り 5 件は scenario_count=1, **全て `overallConfidence=0`**, `warning_count=5`(Devil's Advocate が全て abandon している可能性)
- **問題点**:
  - [Critical] usageCount/avgScore が一切記録されない(Registry 未接続)→ プロンプト品質の経時観測が不能
  - [Major] `overallConfidence=0` が連続している原因が観測できない(DA の abandon かもしれないが、`marketAnalysis.tradeable` の可能性もあり、現状は分からない)
  - [Minor] マクロ展開を Registry に統合する場合、`{{CORE_TRADING_RULES}}` が未展開で LLM に渡る潜在バグが残る(`docs/design/phase6_prompt_audit.md` §5.4)

### 1.2 `strategist`

- **稼働状況**: 0 回(production DB 上に呼び出し記録なし)
- **取得経路**: `loadPromptWithGlobal('strategist')` — Registry 未接続
- **発火条件**: `sideBScheduler.runFullValidationNow()` が `screening_passed` 仮説をピックして呼ぶ
- **問題点**:
  - [Critical] **screening_passed 仮説が 0 件** のため Strategist は構造的に発火不能
  - [Critical] ScreeningOrchestrator での materialize が 100% 失敗(§2.4)。これが直接原因
- **コード自体は健全**: `validate()` の決定論的判定 + LLM 解釈の二段構成は設計通り

### 1.3 `devils_advocate`

- **稼働状況**: orchestrator §5 で scenario ループ内 `await this.devilsAdvocate.critique(scenario, ...)` として呼ばれる(loadPrompt 直読み、記録なし)
- **scenarios=0 出力時の挙動**: ループ自体回らないため発動しない(設計通り)
- **直近 14 日の発動推定**: 5 プラン × 平均 1 シナリオ = ~5 critique 呼び出し
- **観測可能性**: ✗ DA の `recommendation.action` 分布(abandon / modify / ok)が DB に記録されていない。`AITradePlan.warnings` に `Devil's Advocate(abandon|modify): ...` 文字列でしか残らない
- **問題点**:
  - [Major] DA 判定の集計が手動 SQL でしかできない(`warnings` のテキスト grep)
  - [Major] 直近のプランが全て confidence=0 で警告 5 件付き → DA が常に abandon している可能性が極めて高いが、検証手段がない

### 1.4 `discovery`

- **稼働状況**: 週次ジョブ(`sideBScheduler.startDiscoveryJob`)で 7 日間隔起動。`SIDE_B_SCHEDULER_ENABLED=true` の本番では稼働しているはず
- **EdgeLedger への書き込み**: `DiscoveryAgent.analyze` 内で新仮説を `source='discovery'` で create する設計
- **実態**: **`source='discovery'` の仮説は DB 上 0 件**。すべて `ai_generated`(72/72)
- **考えられる原因**:
  - LLM 出力で `newHypotheses=[]` が続いている(対象ノートが少ない週は十分あり得る — AITradeNote は週 9-28 件しか生成されていない)
  - `isDuplicate` で全て弾かれている
  - LLM 失敗で空応答に倒している
- **`hintsForHG` の扱い**: ✗ **Discovery が生成した `hintsForHG` は WeeklyDiscoveryReport の中で返されるだけで、永続化されず HG にも届かない**(orchestrator は HG に discoveryHints を渡していない、`HypothesisGeneratorAgent.generate({ ... })` 引数を確認、§2.7)
- **問題点**:
  - [Major] Discovery → HG ハンドオフが**接続されていない**。HG 側の `discoveryHints?: JsonValue` 入力フィールドは定義されているが orchestrator が渡さない
  - [Minor] Discovery の出力(report)が DB に保存されないため、何が生成されたか確認できない

### 1.5 `hypothesis_generator`

- **稼働状況**: 直近 178 回呼び出し / avgScore=0.6842(active)
- **入出力スキーマ**: `HypothesisGeneratorInput` / `HypothesisGeneratorOutput`(`agents/HypothesisGeneratorAgent.ts:46-58, 105-130`)
- **入力に含まれる項目**: `symbol, timeframe, lensSnapshot, existingHypotheses, specialistAnalyses?, discoveryHints?`
- **orchestrator から実際に渡されている項目**: `symbol, timeframe, lensSnapshot, existingHypotheses, specialistAnalyses` のみ。**`discoveryHints` は渡されない**(`aiOrchestrator.ts:379-391`)
- **登録された仮説数**: 72 件、すべて `source='ai_generated'`
  - `category` 分布: structure 28 / volatility 21 / time 15 / correlation 4 / positioning 2 / level 2
  - 直近 7 日(2026-04-23 ～ 04-30)で 72 件生成 — つまりほぼ全部直近に生成された
- **スキーマ違反検出**: `validateHypothesisGeneratorOutput`(同ファイル :136 以降)で zod 風手書きバリデート、架空レンズ名チェックあり
- **問題点**:
  - [Critical] **72 件中 66 件が screening 段階で `not_testable`** に倒される(理由は §2.4 で詳述)。HG が指定する `defaultRiskManagement.stopLoss.type='atr_multiple'` に対し materialize 側が ATR を取得できない
  - [Major] HG の avgScore=0.6842 は構造バリデーション通過率の合成スコアであって、**生成された仮説が実際にエッジとして機能するか** は何ら測れていない
  - [Minor] `discoveryHints` 経路が未接続(§2.7)

### 1.6 `trend_specialist`

- **稼働状況**: 直近 189 回呼び出し / avgScore=0.5716(active、3 専門家の中で最低)
- **取得経路**: Registry + variantSelector(`agents/specialists/TrendSpecialist.ts` + `specialistCommon.ts:174` で `selectVariant`)
- **問題点**:
  - [Major] 3 専門家中 avgScore が最も低い(0.57 vs 0.74/0.78)。スキーマ違反 or interpretation 80 文字未満が多発している可能性 — ただし Phase 6 改訂前のプロンプト品質課題として既知

### 1.7 `oscillator_specialist`

- **稼働状況**: 直近 129 回 / avgScore=0.7380
- **取得経路**: Registry + variantSelector
- **問題点**: 大きな問題なし

### 1.8 `volatility_volume_specialist`

- **稼働状況**: 直近 133 回 / avgScore=0.7801(3 専門家中最高)
- **取得経路**: Registry + variantSelector
- **問題点**: 大きな問題なし

### 1.9 `mutation`(DSL 変異)

- **稼働状況**: ✗ 稼働ゼロ
- **発火条件**: `sideBScheduler.startEvolutionJob` → `runEvolutionNow` → `EvolutionLoop.runOneGeneration`。**`autoEvolution=false`(既定)** なので呼ばれない
- **`StrategyPopulation` の永続ファイル**: `data/evolution/strategy-population.json` は **存在しない**(`.gitkeep` のみ)。一度も生成されていない
- **問題点**:
  - [Major] 戦略 DSL の進化ループ(Phase 5)は機能していない。設計はあるが運用上は完全停止

### 1.10 `crossover`

- 同上(EvolutionLoop 内、autoEvolution off により未稼働)

### 1.11 `prompt_mutation`

- **稼働状況**: ✗ 稼働ゼロ
- **発火条件**: `sideBScheduler.startPromptEvolutionJob` → `runPromptEvolutionNow` → `runPromptEvolutionCycle`。**`autoTriggerPromptEvolution=false`(既定)** なので呼ばれない
- **手動トリガー痕跡**: なし(experimental が 0 件であることがその証拠)
- **問題点**:
  - [Critical] PDCA-1 の中核エージェント。これが回らない限り experimental → 昇格サイクルは生まれない

### 1.12 `meta_evolution`

- **稼働状況**: ✗ 稼働ゼロ
- **`AgentRestructureProposal` 件数**: **0 件**
- **発火**: `agents/metaEvolutionCli.ts` 経由の手動 CLI のみ。本番では `npx ts-node` を打つ運用は確認できず
- **問題点**:
  - [Minor] 設計通り「人間が手動で発火」なので即時の問題ではないが、Phase 6 完了後に 1 度も使われていない事実は記録すべき

---

## 2. エージェント間ハンドオフ診断

### 2.1 専門家 3 体 → HypothesisGenerator

| 観点 | 状態 |
|---|---|
| 期待形式 | `specialistAnalyses: { trend?, oscillator?, volatilityVolume? }` |
| 実態 | `runAllSpecialists` の戻り値を orchestrator が直接渡す(`aiOrchestrator.ts:362-391`) |
| 型整合 | TS 上 OK |
| 脱落 | `runAllSpecialists` 内 `Promise.allSettled` で個別失敗を許容、`filled` ログで何個埋まったか観測可能 |
| 観測可能性 | コンソールログのみ(DB 永続化なし) |

**判定**: ✓ 機能している

### 2.2 HypothesisGenerator → orchestrator → Plan AI / EdgeLedger

| 観点 | 状態 |
|---|---|
| 期待 | `candidateHypotheses` を Plan AI に渡し、新規候補を EdgeLedger に create |
| 実態 | `aiOrchestrator.ts:402-410` で `edgeLedger.create()` を best-effort で実行(72 件成功) |
| 上流出力 vs 下流入力 | `genResult.output.hypotheses.length` と `createInputs.length` の差は通常ゼロだが、`isDuplicate` で間引かれる可能性あり |
| 観測可能性 | `[Orchestrator] 新規仮説登録: N個` ログのみ |

**判定**: ✓ 機能している

### 2.3 Plan AI → DSLBacktestAdapter(StrategyBacktesterAgent)

| 観点 | 状態 |
|---|---|
| 期待 | scenarios → `scenarioToStrategyDSL` → `DSLBacktestAdapter.runBacktest` |
| 実態 | `aiOrchestrator.ts:447-463` で実行されるが、**結果は in-memory のみ** で DB 保存されない(返り値の `AITradePlanWithOptionalBacktest.strategyBacktest` は API レスポンスでしか見えない) |
| 観測可能性 | ✗ 後追い不可。`StrategyBacktestRun` テーブルへの書き込みなし(直近 30 日 0 件、最後の書き込みは 2026-04-18) |

**判定**: △ 動いているが**結果が永続化されない**。Phase 4c 4 ツール検証(WF/MC/BAH)結果が完全に失われる

### 2.4 ScreeningOrchestrator → MaterializationService(HG → ledger.markScreeningPassed の経路)

| 観点 | 状態 |
|---|---|
| 期待 | unverified 仮説を screening して `screening_passed` or `rejected` に遷移 |
| 実態 | **ALL 66 件が `not_testable`** で停止。statusNote: *「Materialization失敗: atr_multiple SL を要求されたが ATR が取得できない」* |
| 原因 | `MaterializationService.ts:201` — `getAtrFromSnapshot` が `volatility_regime` レンズの `atr` 特徴量を読みに行くが、screening 経路で渡される `lensSnapshot` がそもそも `volatility_regime` を含んでいない or `atr` フィールドを持っていない |
| 起動経路 | `sideBScheduler.runScreeningNow` 内で `agentMemory.getCurrentLensSnapshot(symbol)` を取り出して `screeningOrchestrator.runScreening(hypothesisId, { lensSnapshot })` に渡している(`sideBScheduler.ts:629-633`) |
| 仮説 | screening 時点では agentMemory に記録された snapshot のうち `volatility_regime.features.atr` が undefined のものを掴んでいる、もしくは別シンボルの snapshot を掴んでいる可能性あり |

**判定**: ✗ **戦略進化サイクル PDCA-2 のボトルネック**。これが解決しないと screening_passed → testing → confirmed の連鎖が一切発生しない

### 2.5 ValidationTool 結果 → Strategist 解釈

| 観点 | 状態 |
|---|---|
| 実態 | `Strategist.validate()` の発火条件は「screening_passed 仮説の存在」 |
| screening_passed 件数 | 0 件 |
| 結果 | Strategist は構造的に呼ばれない(`StrategistAgent` 0 usage で整合) |

**判定**: ✗ 上流(2.4)が詰まっているため発火不能

### 2.6 Strategy Thinker scenarios=0 時の Devil's Advocate 抑止

| 観点 | 状態 |
|---|---|
| 期待 | scenarios=0 のとき DA は呼ばれない(設計通り) |
| 実態 | `aiOrchestrator.ts:470` の `for (const scenario of scenariosWithId)` で scenarios=0 ならループ自体スキップ |

**判定**: ✓ 設計通りの抑止が効いている

### 2.7 Discovery → HypothesisGenerator(`discoveryHints`)

| 観点 | 状態 |
|---|---|
| 期待 | Discovery 週次レポートの `hintsForHG` が次のプラン生成サイクルで HG に渡る |
| 実態 | `HypothesisGeneratorInput.discoveryHints?: JsonValue` フィールドは定義済み(:123)だが、**`aiOrchestrator.ts:379-391` で渡していない**。Discovery のレポートは scheduler でログ出力されるのみで永続化もされない |
| ハンドオフペアの脱落 | 100%(構造的に未接続) |

**判定**: ✗ **未配線の死蔵ハンドオフ**

---

## 3. PDCA-1(プロンプト進化サイクル)診断

### 3.1 段階別件数(直近 30 日)

| 段階 | 件数 | 状態 |
|---|---|---|
| 提案(`PromptMutationAgent.proposeImprovements`) | 0 | ✗ |
| Registry 登録(experimental) | 0 | ✗ |
| variantSelector 抽選(experimental が選ばれる) | 0 | ✗ |
| 即時中止(`shouldReject`) | 0 | n/a |
| 人間承認(`approveCli` で active 昇格) | 0 | ✗ |
| active 昇格 | 0(初期 sync 12 件は 4/25 に一括人手 sync) | ✗ |
| reject | 0 | ✗ |
| ABTestRunner 実行(`PromptAbTestResult` 件数) | 0 | ✗ |

**統計**: `PromptVersion` 26 行(active 12 + deprecated 12 + 専用 active 2)。すべて `createdBy='human'` で `mutation` 由来は 0 件。

### 3.2 周回判定

- **総合**: ✗ **完全停止**
- **詰まりポイント**: 起点の `PromptMutationAgent` が呼ばれていない(`autoTriggerPromptEvolution=false` + 手動 CLI も未実行)
- **原因仮説**:
  - 1. 自動トリガーが既定 false で、ユーザー(Nekoさん)が CLI から `runPromptEvolutionNow` を 1 度も叩いていない
  - 2. `runPromptEvolutionCycle` 自体は実装済みで、4 月 25 日の 12 体一括 sync 以外、稼働した形跡なし
- **副次的問題**: 仮にこのサイクルを起動しても、Registry 未接続の 8 体については **avgScore がそもそも記録されないため `promotionCandidates` 判定が成立しない**(`active.avgScore > 0` チェックを通らない)

---

## 4. PDCA-2(戦略進化サイクル)診断

### 4.1 段階別件数(直近 30 日)

| 段階 | 件数 | 状態 |
|---|---|---|
| HG 仮説生成(178 calls / 72 hypotheses) | 178 / 72 | ✓ |
| HG → EdgeLedger create(`source='ai_generated'`) | 72 | ✓ |
| Discovery 経由の仮説生成(`source='discovery'`) | 0 | ✗ |
| Strategy Thinker 戦略化(`AITradePlan` 生成) | 60(直近30日) | ✓(うち約半数は scenarios=0) |
| StrategyBacktesterAgent 即時 BT(in-memory のみ) | 不明(永続化されない) | △ |
| Devil's Advocate critique | 推定 ~5 件(scenarios>0 なプラン分) | ✓ |
| ScreeningOrchestrator 評価 | 66 件 → **全て `not_testable`** | ✗ |
| WalkForward / MonteCarlo / BuyAndHold 検証 | StrategyBacktestRun: 直近30日 0 件、累計 45 件(2026-04-18 のみ) | ✗ |
| Strategist 解釈(`fullValidationReport` 永続化) | 0 件 | ✗ |
| `screening_passed` 仮説 | 0 件 | ✗ |
| `confirmed` 仮説 | 0 件 | ✗ |
| `rejected` 仮説 | 0 件 | ✗ |
| 実運用判断(`VirtualTrade` 作成) | 137 closed + 66 expired + 1 pending | ✓ |
| エントリー結果分布 | take_profit 24 / stop_loss 113(勝率 18%) | ✓(観測中) |
| AITradeNote 自動生成 | 直近 4 週で約 30 件 | ✓ |
| `recordObservation` フィードバック反映 | 観測ありの仮説 5 件 / 観測総数 ~12 件 | △(極めて疎) |

### 4.2 BT ツール別実行履歴(累計、`StrategyBacktestRun` テーブル)

| ツール / 実行ソース | 実行数 | 最終実行 |
|---|---|---|
| manual / stage1 | 39 | 2026-04-18 |
| walkforward / stage1 | 6 | 2026-04-18 |
| screening | 0 | n/a |
| montecarlo(`MonteCarloRun` テーブル全体) | 2 | n/a |
| walkforward(`WalkForwardRun` テーブル全体) | 1 | n/a |

> ※ `StrategyBacktesterAgent` が orchestrator §4d で実行する 4 ツール検証は `StrategyBacktestRun` に書き込まないため、上記には反映されていない。直近 30 日の `StrategyBacktestRun` 書き込みは **0 件**。

### 4.3 通過率(計算可能なもののみ)

- ScreeningOrchestrator: 66 / 66 失敗 → **通過率 0%**(全件 materialize エラーで not_testable)
- 戦略進化ループ: そもそも未稼働(autoEvolution=false)

### 4.4 周回判定

- **総合**: ✗ **第4段階(screening / 検証)で完全停止**
- **詰まりポイント**:
  1. `MaterializationService.calculateStopLossPercent` が `volatility_regime` レンズの `atr` 特徴量を要求するが、screening 経路の `lensSnapshot` にそれが入っていない(§2.4)
  2. その結果、後続の 4 ツール検証(WF/MC/BAH/Screening)に到達する仮説がゼロ
  3. `StrategistAgent.validate` も発火せず、`fullValidationReport` も書かれない
  4. `confirmed` への昇格条件(PF>1.5 etc.)を満たすかどうかの議論以前
- **観測フィードバックは存在するが疎**: VirtualTrade 137 件の決済 → AITradeNote 自動生成 → `findMatching` で当該 lens snapshot に該当する仮説に `recordObservation` する設計は機能しているが、**5 仮説 / 12 観測** にすぎない(観測した snapshot が unverified 6 件としか一致していない)

---

## 5. 検出された問題一覧

### 重大問題(動作していない、データ整合性違反等)

1. **[Critical-1] Materialization 段階で 100% 失敗(PDCA-2 全体停止)**
   - 場所: `src/side-b/bridge/MaterializationService.ts:201, 232`
   - 場所(原因の上流): `sideBScheduler.ts:629-633`(`agentMemory.getCurrentLensSnapshot(symbol)` で取得した snapshot に ATR が入っていない)
   - 現象: ScreeningOrchestrator.runScreening を呼ぶたびに `MaterializationError("atr_multiple SL を要求されたが ATR が取得できない")` で例外。66/66 失敗
   - 推奨アクション: ScreeningOrchestrator の lensSnapshot 渡し方を見直す。`agentMemory.getCurrentLensSnapshot` が **直近のプラン生成時のものを保持** しているが、screening ジョブはそれと別シンボル/別タイミングで動くため、`volatility_regime.atr` が入っていない可能性が高い。screening 専用の lens 計算を別途実行するか、agentMemory から ATR を分離した取得経路を作るか、HG が `atr_multiple` 以外の SL タイプを許容するかの 3 択

2. **[Critical-2] PDCA-1 が 1 度も発火していない**
   - 場所: `src/side-b/jobs/sideBScheduler.ts:173`(autoTriggerPromptEvolution=false)
   - 現象: experimental 0 件 / rejected 0 件 / abtest 0 件。`PromptMutationAgent.proposeImprovements` を呼ぶ経路に到達した形跡なし
   - 推奨アクション: 手動で 1 度 `runPromptEvolutionNow()` を実行して experimental を生成 → variantSelector が抽選するか観察。avgScore が記録される 4 体以外は `promotionRatio` 判定が成立しないため、まずは Registry 接続済み 4 体だけでサイクル動作確認

3. **[Critical-3] Registry 接続が 4 体のみ(8 体は使用記録なし)**
   - 場所: `strategy_thinker / strategist / devils_advocate / discovery / mutation / crossover / prompt_mutation / meta_evolution`
   - 現象: usageCount=0 / avgScore=0 のまま。プロンプト品質を経時観測する手段がない
   - 推奨アクション: 設計書通り段階的に Registry 接続を拡大するか、せめて `recordUsage` を呼び出す薄いラッパーを各エージェントに足すか議論する(ただし scoringFunctions の追加実装が必要)

4. **[Critical-4] StrategyBacktesterAgent の結果が永続化されない**
   - 場所: `src/side-b/agents/StrategyBacktesterAgent.ts:200-219`
   - 現象: `aiOrchestrator.generatePlan` で 4 ツール検証を実行するが、結果は in-memory の `StrategyBacktesterRunResult` に入るだけで DB 保存されない。`StrategyBacktestRun` への書き込みは直近 30 日 0 件
   - 推奨アクション: `AITradePlan` に新しい関連テーブルを追加するか、`StrategyBacktestRun` に書き込む経路を整備する。現状は plan 生成時の BT 結果が API レスポンスで一度返るのみで、後追いができない

5. **[Critical-5] `not_testable` 仮説が 66 件溜まり続けている**
   - 場所: `EdgeHypothesis` テーブル
   - 現象: HG が新規仮説を作るたびに同じエラーで not_testable に倒される。すでに 66 件、HG は今後も生成し続けるため雪だるま式に増える
   - 推奨アクション: Critical-1 解決後、過去の 66 件を `unverified` に戻して再 screening するかどうか判断(prod write 操作になるので Nekoさん の承認必須)

6. **[Critical-6] 直近 14 日のプランが overallConfidence=0 で連続**
   - 場所: `AITradePlan` テーブル直近 10 件
   - 現象: scenarios>0 のプラン全てで `overallConfidence=0` + 警告 5 件。Devil's Advocate が全件 abandon している可能性が極めて高い
   - 推奨アクション: 直近のプランの `warnings` 内容を sample 確認する(本診断ではテキスト確認まではしていない)。DA が常に abandon を返す状態は本番運用上の致命傷

7. **[Critical-7] Discovery → HG ハンドオフが未配線**
   - 場所: `src/side-b/orchestrator/aiOrchestrator.ts:379-391`(HG.generate 呼び出し時に discoveryHints を渡していない)
   - 現象: HG 入力フィールド `discoveryHints?` は存在し、プロンプト側もそれを参照する記述あり(`prompts/hypothesis_generator.md:36-38`)。にも関わらず orchestrator で渡されない。Discovery は WeeklyDiscoveryReport を生成するが永続化もされない
   - 推奨アクション: orchestrator に Discovery レポートのキャッシュ機構(memory or DB)を入れて HG に渡す経路を追加。ただし設計判断が必要なため Nekoさん に確認

8. **[Critical-8] EvolutionLoop / StrategyPopulation が 1 度も走っていない**
   - 場所: `data/evolution/strategy-population.json` 不在
   - 現象: Phase 5 の DSL 進化ループが完全死蔵。autoEvolution=false 既定 + 手動実行痕跡なし
   - 推奨アクション: 短期的には不問にしてよい(設計上「コスト大なので意図的に手動」)。ただし「設計に存在するが運用されていない機能」として明文化する

### 軽微問題

1. **[Minor-1] `trend_specialist` の avgScore が 0.5716 と低い** — 他 2 専門家(0.74/0.78)と比べて改善余地。プロンプト見直しで対処可能(Phase 6 改訂で議論)

2. **[Minor-2] DevilsAdvocate の判定分布が DB 集計できない** — 警告テキストでしか残らない。集計用フィールドが欲しい

3. **[Minor-3] `recordObservation` フィードバックが極めて疎** — 5 仮説 / 12 観測のみ。findMatching の閾値 or 仮説の conditions 厳格度が原因の可能性。現状は HG が「具体的すぎる」conditions を生成して live snapshot に当たらないのかも

4. **[Minor-4] Discovery レポート(`WeeklyDiscoveryReport`)が永続化されない** — sched はログ出力のみ。過去の Discovery 出力を後追いできない

5. **[Minor-5] `MetaEvolutionAgent` は手動 CLI のみ。本番で使われていない** — 設計通りだが Phase 6 完了から 8 日経過しても 1 度も使われていない事実は記録すべき

6. **[Minor-6] `AITradePlan.overallConfidence` を DA が更新しない** — シナリオ単位の `confidence` は DA で 20 に下げるが、プラン全体の `overallConfidence` は Plan AI 出力のままで矛盾が生じやすい

---

## 6. 観測可能性の評価

### 不足している計測箇所

- **Strategy Thinker のプロンプト品質観測**: usageCount/avgScore が一切記録されない
- **Devil's Advocate の判定分布**: abandon/modify/ok の DB 集計手段がない
- **StrategyBacktesterAgent の per-plan 4 ツール検証結果**: in-memory のみで永続化なし
- **Discovery レポート**: コンソールログ以外に痕跡がない
- **ScreeningOrchestrator の失敗詳細**: `EdgeHypothesis.statusNote` に文字列が入るだけで構造化されていない
- **Plan の no-trade 判断理由**: scenarios=0 / tokenUsage=0 が突発的に発生する原因が DB から再構成できない(キャッシュヒットなのか Plan AI が空応答したのか不明)

### ログ密度が薄い箇所

- 専門家 → HG → Strategy Thinker のチェーン全体で「上流から何個もらって下流に何個渡したか」のメトリクスが console.log のみ
- Phase 4c 4 ツールの per-tool durationMs が `ValidationToolResult.durationMs` には入るが集計されない

### メトリクス可視化が必要な箇所

- `EdgeHypothesis.status` の遷移ログ(現状は最新ステータスのみ保存、履歴なし)
- `PromptVersion.avgScore` の経時変化(現状は単純平均で上書き、履歴なし)

---

## 7. 推奨アクション(優先度順、Nekoさん の承認が必要)

> 注: これらは推奨であり、Nekoさん の同意なしに実装しません。

### 緊急(動いていないものを動かす)

1. **Critical-1 を解決して PDCA-2 を再開**
   - ScreeningOrchestrator の `lensSnapshot` 渡し方を見直し、`volatility_regime.atr` が確実に入る経路で screening を実行する
   - 過去 66 件の not_testable 仮説の救済方針を決める(prod write を伴うため別タスク)

### 重要(精度向上に直結)

2. **Critical-6 を解決して overallConfidence=0 連続を解消**
   - Devil's Advocate の判定が常に abandon になっている原因を特定。プロンプト or scenario 構造の問題か、DA の閾値が厳しすぎるか
   - DA 判定分布を集計可能にする(`AITradePlan` または別テーブルに `devilsAdvocateVerdicts: Json` を足す)

3. **Critical-2 を解決して PDCA-1 を一度回す**
   - 手動で `runPromptEvolutionNow()` を 1 度叩いて、Registry 接続済み 4 体に experimental を生成
   - variantSelector の 20% 抽選が走るかを 1 週間程度観測
   - その上で「他 8 体を Registry に接続するか」を意思決定

4. **Critical-7 を解決して Discovery を活かす**
   - orchestrator から HG への `discoveryHints` 経路を配線
   - 同時に Discovery レポートを永続化(新テーブル or `AgentMemory` 拡張)

### 改善(中長期)

5. **Critical-4 / Minor-4 解決**: StrategyBacktester / Discovery の結果を DB 保存
6. **Minor-3**: HG conditions の厳格度を緩めるか、findMatching の許容度を上げる
7. **Critical-3**: Registry 接続の段階拡大(まず scoring function を 8 体分追加するかの議論から)
8. **Critical-8 / Minor-5**: 死蔵機能(EvolutionLoop / MetaEvolution)を Phase 7 までに「保留 or 廃止」を明示

### 次に取るべき 1 アクション(最重要)

**Critical-1 の根本原因調査** — Materialization が 100% 失敗している原因が「lensSnapshot に ATR が入っていない」のか「getCurrentLensSnapshot が別シンボルを掴んでいる」のか、まずコード調査と DB 上の lensSnapshot 内容確認を行う。これが解決しない限り PDCA-2 は永久に第4段階で詰まる。

---

## 8. 付録

### 8.1 実行した SQL クエリ一覧

```sql
-- 各エージェントの version 状態分布
SELECT "agentName", "status", COUNT(*) AS count, AVG("avgScore"), SUM("usageCount"), MAX("updatedAt")
FROM "PromptVersion" GROUP BY "agentName", "status";

-- 各エージェントの実行 footprint
SELECT "agentName", SUM("usageCount"), AVG("avgScore"), SUM("successCount"), MAX("lastUsedAt")
FROM "PromptVersion" GROUP BY "agentName";

-- 直近 60 日で active 昇格した version
SELECT "agentName", "version", "status", "approvedAt", "approvedBy", "avgScore", "usageCount"
FROM "PromptVersion" WHERE "approvedAt" > NOW() - INTERVAL '60 days' ORDER BY "approvedAt" DESC;

-- experimental / rejected version 検索
SELECT * FROM "PromptVersion" WHERE "status" IN ('experimental','rejected');

-- A/B テスト結果
SELECT "agentName", COUNT(*), MIN("testedAt"), MAX("testedAt") FROM "PromptAbTestResult" GROUP BY "agentName";

-- EdgeHypothesis 状態分布
SELECT "status", "category", "source", COUNT(*) FROM "EdgeHypothesis"
GROUP BY "status", "category", "source";

-- not_testable 理由
SELECT "statusNote", COUNT(*) FROM "EdgeHypothesis" WHERE "status" = 'not_testable' GROUP BY "statusNote";

-- AITradePlan 直近
SELECT id, "createdAt", "tokenUsage", jsonb_array_length("scenarios"::jsonb), "overallConfidence", array_length("warnings", 1)
FROM "AITradePlan" WHERE "createdAt" > NOW() - INTERVAL '14 days' ORDER BY "createdAt" DESC;

-- StrategyBacktestRun 集計
SELECT "source", "stage", "status", COUNT(*), MAX("createdAt") FROM "StrategyBacktestRun" GROUP BY "source", "stage", "status";

-- VirtualTrade
SELECT "status", COUNT(*) FROM "VirtualTrade" GROUP BY "status";
SELECT "exitReason", COUNT(*) FROM "VirtualTrade" WHERE "status" = 'closed' GROUP BY "exitReason";

-- AITradeNote 週次
SELECT DATE_TRUNC('week', "createdAt") AS week, COUNT(*) FROM "AITradeNote" GROUP BY week ORDER BY week DESC;

-- AgentRestructureProposal
SELECT "status", COUNT(*), MIN("proposedAt"), MAX("proposedAt") FROM "AgentRestructureProposal" GROUP BY "status";

-- 観測ありの仮説
SELECT id, "observationCount", "winCount", "lossCount", "lastObservedAt", "lastTestedAt"
FROM "EdgeHypothesis" WHERE "observationCount" > 0;
```

### 8.2 主要 grep / コード参照箇所

- 12 エージェントの実装位置: `docs/design/phase6_prompt_audit.md` 参照(2026-04-24 時点の調査と整合)
- variantSelector: `src/side-b/prompts/registry/variantSelector.ts:46`
- runPromptEvolutionCycle: `src/side-b/prompts/registry/promptEvolutionJob.ts:75`
- ScreeningOrchestrator: `src/side-b/bridge/ScreeningOrchestrator.ts`
- MaterializationService の例外: `src/side-b/bridge/MaterializationService.ts:198-203`
- aiOrchestrator の HG/specialists 呼び出し: `src/side-b/orchestrator/aiOrchestrator.ts:351-417`
- aiOrchestrator の StrategyBacktester: `:447-463`
- aiOrchestrator の Devil's Advocate: `:465-489`
- sideBScheduler の各ジョブ起動: `src/side-b/jobs/sideBScheduler.ts:347-383`
- autoTriggerPromptEvolution 既定値: `:173`
- autoEvolution 既定値: `:166`
- aiNoteService の recordObservation: `src/side-b/services/aiNoteService.ts:202-217`
- DiscoveryAgent.analyze の hintsForHG 出力: `src/side-b/agents/DiscoveryAgent.ts:351-365`

### 8.3 本診断で**意図的に行わなかったこと**

- 本番 DB への INSERT/UPDATE/DELETE/TRUNCATE/ALTER(全クエリ SELECT のみ)
- `AITradePlan.warnings` の中身テキスト確認(diagnostic 容量との兼ね合い、必要なら別タスク)
- LLM API ログの直接確認(本番で取れていない可能性が高い)
- Phase 6 設計書の修正提案(調査範囲外)
- コード修正・リファクタリング提案の実装

---

> 本レポートは現状観察に基づく診断結果であり、推奨アクションの実装は Nekoさん の承認後に別タスクとして実施する。
