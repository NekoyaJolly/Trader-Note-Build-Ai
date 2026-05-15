# STEP 5 段階 2: エージェント出力 ↔ UI マッピング表 (実体ベース)

設計書 `docs/design/DESIGN_DOC_autonomous_trading_architecture.md` §5 に定義された 9 エージェントについて、「出力データ型 / 永続化先 (Prisma モデル) / 公開 API / UI 表示先」を **実コードで確定** した対応表。STEP 5 (段階 2 運用動作完成) の Phase C-bis 検証アクションとして作成。

調査時点: 2026-05-15 / main HEAD: `380daac` (PR #202 マージ後)

調査範囲:
- `src/side-b/agents/` `src/side-b/services/` `src/side-b/lenses/`
- `src/side-b/routes/` `src/side-b/controllers/`
- `src/frontend/app/side-b/`
- `prisma/schema.prisma`

---

## 実体マッピング表

| # | エージェント (§5.x) | 出力データ型 | 永続化先 | 公開 API | UI 表示先 | 設計書原案からのズレ |
|---|---|---|---|---|---|---|
| 1 | **Market Observer** (§5.1) | `LensFeatureSnapshot` (`Map<string, LensFeature>`) | transient (任意で `AITradeNote.lensSnapshot` に埋め込み) | なし (集計のみ `GET /api/side-b/stats/overview`) | `/side-b/dashboard` (集計表示) | ✅ 一致 |
| 2 | **Hypothesis Generator** (§5.2) | `HypothesisGeneratorOutput` (hypotheses[] + noveltyClaim) | `EdgeHypothesis` テーブル (status=`unverified` で挿入) | `POST /api/side-b/hypotheses/*` (validationRoutes.ts) | `/side-b/hypotheses` | ✅ 一致 |
| 3 | **Strategy Thinker** (§5.3) | `PlanAIOutput` (Strategy: entryConditions / exitConditions / riskManagement) | **`AITradePlan` テーブル** | `POST /api/side-b/plans` (sideBRoutes.ts:189) | `/side-b/agent` (Plan 表示) | ⚠️ 設計書原案「`EdgeHypothesis.strategyDsl` に保存?」は誤、実体は `AITradePlan` |
| 4 | **Devil's Advocate** (§5.4) | `DevilsAdvocateOutput` (failureScenarios[3] + weakestAssumption + recommendation) | transient (専用永続化なし) | **なし** (orchestrator 内部利用のみ) | **なし** (戦略検証フロー統合、独立 UI 表示先なし) | ⚠️ 設計書原案の API / UI 表示先は **未実装** |
| 5 | **Strategist Agent** (§5.5 / Phase 4c) | `PromotionVerdict` (verdict: confirmed/rejected/not_testable + interpretation) | **`EdgeHypothesis.status` + `confirmationInterpretation` を in-place 更新** | `POST /api/side-b/hypotheses/:id/validate` | `/side-b/validation` | ⚠️ 設計書原案「`StrategyValidationResult` テーブル」は存在しない、実体は `EdgeHypothesis` 内 |
| 6 | **Backtester Agent** (§5.6 / Phase 4c) | `ConsolidatedValidationReport` (4 ツール統合: screening / walkForward / monteCarlo / buyAndHold) | **`EdgeHypothesis.fullValidationReport`** (Json フィールド) | なし (StrategistAgent 内部呼び出し) | `/side-b/validation` (詳細結果表示) | ⚠️ 専用 API なし、StrategistAgent 経由 |
| 7 | **Reflection AI** (§5.7) | `ReflectionOutput` (lessons[] + overallScore + improvementSuggestions) | **`AITradeNote` + `GenerationLesson`** (両方に書き込み) | なし (PDCA ループ内部のみ、`pdcaLoop.ts` から呼出) | `/side-b/ai-notes` | ⚠️ `GenerationLesson` への書き込みが設計書原案に未記載 (追加要素) |
| 8 | **Discovery AI** (§5.8) | `WeeklyDiscoveryReport` (lensInsights[] + newHypotheses[] + hintsForHG[]) | transient (新仮説のみ `EdgeHypothesis` に追加挿入) | `GET /api/side-b/discovery/latest` | **`/side-b/dashboard`** (discovery section) | ⚠️ 設計書原案「`/side-b/hypotheses` フィルタ」は誤、実体は `/side-b/dashboard` |
| 9 | **Mutation / Crossover Agent** (§5.9 / Phase 5A) | `StrategyDSL[]` (戦略 JSON DSL 配列) | **`Strategy` + `StrategyVersion`** | `GET /api/side-b/evolution/runs/:runId/candidates` | `/side-b/evolution` | ⚠️ 設計書原案「`EvolutionCandidate` テーブル」は存在しない、実体は `Strategy` 系 |

---

## 実装ファイル詳細

| エージェント | 実装ファイル |
|---|---|
| Market Observer | `src/side-b/lenses/LensAggregator.ts` |
| Hypothesis Generator | `src/side-b/agents/HypothesisGeneratorAgent.ts` |
| Strategy Thinker | `src/side-b/services/planAIService.ts` (class: `PlanAIService`) |
| Devil's Advocate | `src/side-b/agents/DevilsAdvocateAgent.ts` |
| Strategist Agent | `src/side-b/agents/StrategistAgent.ts` |
| Backtester Agent | `src/side-b/agents/BacktesterAgent.ts` |
| Reflection AI | `src/side-b/services/reflectionAIService.ts` |
| Discovery AI | `src/side-b/agents/DiscoveryAgent.ts` |
| Mutation Agent | `src/side-b/agents/MutationAgent.ts` |
| Crossover Agent | `src/side-b/agents/CrossoverAgent.ts` |

---

## 残未確定セル (実コードで結論を出せなかった項目)

1. **Strategy Thinker と AITradeNote の紐付け方法**: PlanAIService の出力が `AITradePlan` に入るのは確認できたが、その先 `AITradeNote` との関係 (例: Plan ID 経由で結合表示するのか、Note 内に複製するのか) が設計書と実装で曖昧
2. **Devil's Advocate の orchestrator 呼出パス**: 専用 API がない (orchestrator 内部のみ) ため、どのエンドポイント経由で誘発されるかが要追跡
3. **Reflection AI と `GenerationReflectionAgent` の役割重複**: ReflectionAIService と GenerationReflectionAgent (別エージェント) が両方とも learning 抽出を行う。両者の明確な分担が不明
4. **`/side-b/validation` の表示分割**: StrategistAgent の判定結果と BacktesterAgent のレポートをどう分割表示するかが UI 仕様不明

(Discovery AI の新仮説自動登録経路は `src/side-b/agents/DiscoveryAgent.ts:340-362` で `llmOutput.newHypotheses[]` を反復 → `this.ledger.create({..., source: 'discovery'})` で挿入していることをコードで確認済のため、初稿の「未確定」リストから除外した。)

これらは Phase D の不足ポイント集計に合流する候補。

---

## 主な発見 (設計書原案 → 実体)

設計書原案の「?」マーク 6 箇所のうち、**4 箇所が実体とズレ**ていた:

| # | 設計書原案 (推測) | 実体 |
|---|---|---|
| 3 (Strategy Thinker 永続化) | `EdgeHypothesis.strategyDsl?` | **`AITradePlan` テーブル** |
| 4 (Devil's Advocate API / UI) | `/api/side-b/...?` / `/side-b/hypotheses 詳細?` | **両方とも未実装** |
| 5 (Strategist Agent 永続化) | `StrategyValidationResult?` | **`EdgeHypothesis.status + confirmationInterpretation`** |
| 8 (Discovery AI UI) | `/side-b/hypotheses (フィルタ)?` | **`/side-b/dashboard` (discovery section)** |
| 9 (Mutation/Crossover 永続化) | `EvolutionCandidate?` | **`Strategy` + `StrategyVersion`** |

設計書側の更新と、Phase D の不足ポイントへの追記対象。

---

## Phase D への引き継ぎ事項

本マッピング表から「不足ポイント」として分類した観察事実:

- **Devil's Advocate** が公開 API / UI 表示先を持たない (`Phase D` 候補: 中程度修正 — orchestrator 経由でも閲覧手段が欲しい)
- **Reflection AI と GenerationReflectionAgent の役割重複** (`Phase D` 候補: 設計判断要)
- ~~**Discovery AI の新仮説自動登録経路**~~ — `DiscoveryAgent.ts:340-362` で `this.ledger.create({..., source: 'discovery'})` で挿入していることを確認済 (Phase C-bis 内で実装根拠を確定)
- **`/side-b/validation` の表示分割仕様** (`Phase D` 候補: 設計判断要)
