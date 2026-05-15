# STEP 5 段階 2: Side-B ループ / 定期実行ジョブの swim-lane マップ

Side-B システム内で動いている **9 経路** のループ / 定期実行ジョブについて、`Trigger → Input → Agents → Output → DB → API → UI` のチェーンを実コードから抽出した一覧。Phase C で発覚した **C-5 (AI ノート / 仮想トレード / 比較ダッシュボードの数字不一致)** の解消に向けて、「どの数字がどの経路の出力に依存するか」を一望する起点として作成。

`STEP_5_AGENT_UI_MAPPING.md` (Phase C-bis) はエージェント単位の出力 → UI マッピング、本ドキュメントはタイムライン軸 (cron / API trigger → 出力 → 集計) の直交軸として位置づける。

調査時点: 2026-05-16 / main HEAD: `f605865` (PR #209 マージ後)

## 概要 — 9 経路の分類

| 系統 | 経路 | 駆動形態 |
|---|---|---|
| **Loop 系** (常駐型 / 状態駆動) | 1. agentLoop / 2. PDCALoop | API trigger / setTimeout 駆動 |
| **PDCA cron 系** (定期実行) | 3. Plan 生成 / 4. Trade 監視 | setInterval (時間ベース) |
| **検証パイプライン** | 5. Discovery / 6. Screening / 7. FullValidation | 週次 / 24h cron |
| **進化系** | 8. Evolution / 9. PromptEvolution | 24h / 30d cron |

「ループ」と「定期実行ジョブ」を区別すると **Loop 系 = 2 経路**、残りは「ジョブ」が正確。だが本ドキュメントは便宜上すべて経路として扱う。

---

## 経路 1. agentLoop (古典 PDCA エージェント)

- **Trigger**: API `POST /api/side-b/agent/start` で開始、`POST /api/side-b/agent/stop` で停止 (`sideBRoutes.ts` 経由)。直接の runOnce 系 API はリポジトリ内に存在せず、scheduler 連動なしの手動起動経路のみ
- **Input**: ユーザーゴール文字列、MCP ツール群
- **Agents**: `AgentLoop` (MCP tool + AI driver)
- **Output type**: `AgentResult` (response, toolCallHistory, tokenUsage, iterations)
- **DB write**: transient (DB 書き込みなし)
- **API**: `GET /api/side-b/agent/status`、`GET /api/side-b/agent/lessons`
- **UI**: `/side-b/agent`
- **備考**: 旧実装、PDCALoop に徐々に統合予定

## 経路 2. PDCALoop (Side-B 主軸)

- **Trigger**: `PDCALoop.start()` 呼出 → `setTimeout` で状態駆動的に `tick()`
- **Input**: AgentMemory の currentState、市場状況 (`isFXMarketOpen`)、TradeResult DB
- **Agents**: Research → Plan (`aiOrchestrator` 経由) → Reflection AI → Lesson
- **Output type**: `PDCATickResult` (state, action, nextCheckMs, details?)
- **DB write**: AgentMemory (transient in-memory) + TradeResult / Lesson へ通知
- **API**: `GET /api/side-b/agent/status`
- **UI**: `/side-b/agent` (thinking log, cycle count)
- **備考**: Strategy 修正フェーズは 4 時間ごと自動リトリガー

## 経路 3. Plan 生成 cron

- **Trigger**: `sideBScheduler.startPlanJob()` → 1 時間チェック → `config.planIntervalHours` (default 4h) ごと実行
- **Input**: OHLCV (`marketDataService`)、上位足 OHLCV (MTF)、`config.symbols`
- **Agents**: Research → Plan (`aiOrchestrator.generatePlan`)
- **Output type**: `PlanGenerationRunReport` (success, message, results[])
- **DB write**: `AITradePlan` (Prisma) + OHLCV (`ohlcvRepository`) + `VirtualTrade` (pending)
- **API**: `GET /api/side-b/plans`, `/api/side-b/plans/:id`, `/api/side-b/plans/today/:symbol`
- **UI**: `/side-b/dashboard` (プラン一覧)、プラン詳細
- **備考**: シンボル並列実行 (`for of config.symbols`)、ノートレード判断時は Trade 作成スキップ

## 経路 4. Trade 監視 cron

- **Trigger**: `sideBScheduler.startMonitorJob()` → 即時 + `monitorIntervalMs` (default 1h) ごと
- **Input**: pending/open VirtualTrade、1 分足 60 本 OHLCV (高安値ベース検証)
- **Agents**: `TradeVerificationService` (pending→open / open→closed 判定)、`ReflectionAI` (Note 生成)
- **Output type**: `JobResult` (processed, entries, exits, expired, notificationsSent)
- **DB write**: `VirtualTrade` (state 遷移) + `AITradeNote` (決済時)
- **API**: `GET /api/side-b/trades`, `/api/side-b/trades/:id`
- **UI**: `/side-b/trades` (トレード一覧、盤面)
- **備考**: 高安値ベース検証で終値のみより正確な約定判定

## 経路 5. Discovery 週次 cron

- **Trigger**: `sideBScheduler.startDiscoveryJob()` → 1 時間チェック → 7 日ごと実行 (Phase 4a)
- **Input**: `AITradeNote` (直近 7 日分、`findAITradeNotesInPeriod`)
- **Agents**: `DiscoveryAgent.analyze` (新規仮説 / レンズ insights 生成)
- **Output type**: `DiscoveryJobResult` (noteCount, newHypothesesCount, lensInsightsCount, tokenUsage)
- **DB write**: `EdgeHypothesis` (`unverified` で登録、`source: 'discovery'`)
- **API**: `GET /api/side-b/discovery/latest`、仮説そのものは `GET /api/side-b/hypotheses?status=unverified` (status クエリで `unverified`/`screening_passed`/`confirmed`/`rejected`/`not_testable` 等の任意 status をフィルタ可能)
- **UI**: `/side-b/dashboard` (discovery section)、`/side-b/hypotheses`
- **備考**: 新規仮説は EdgeLedger に自動登録 (`source: 'discovery'`)。screening 連鎖の起点

## 経路 6. Screening cron

- **Trigger**: `sideBScheduler.startScreeningJob()` → 1 時間チェック → 24h ごと (Phase 4b)
- **Input**: `EdgeHypothesis` (`status='unverified'`)、backtesting data
- **Agents**: `ScreeningOrchestrator.runScreening` (LLM 事前評価)
- **Output type**: `ScreeningJobResult` (processed, passed, rejected, notTestable, errors)
- **DB write**: `EdgeHypothesis.status: unverified → screening_passed / rejected / not_testable` (analysis-engine 失敗や symbols 欠損等で `EdgeLedger.markNotTestable` 経由)
- **API**: 専用 endpoint なし。`GET /api/side-b/hypotheses?status=screening_passed` 等で参照
- **UI**: `/side-b/validation` (仮説検証ダッシュボード)
- **備考**: 1 回最大 `screeningMaxPerRun` (default 10) 件処理

## 経路 7. FullValidation cron

- **Trigger**: `sideBScheduler.startFullValidationJob()` → 1 時間チェック → 24h ごと (Phase 4c)
- **Input**: `EdgeHypothesis` (`status='screening_passed'`)
- **Agents**: `StrategistAgent.validate` (Python BT + LLM 検証)。`GenerationReflectionAgent` は Evolution (多世代) 側で使用、本経路では呼ばれない
- **Output type**: `FullValidationJobResult` (processed, confirmed, rejected, notTestable, errors)
- **DB write**: `EdgeHypothesis.status: screening_passed → testing → confirmed / rejected / not_testable` (検証中は `testing` 経由、`oos_failed` は EdgeHypothesis status として未使用)
- **API**: `GET /api/side-b/hypotheses/:id/validation-status`
- **UI**: `/side-b/validation` (confirmed/rejected タブ)
- **備考**: 仮説間 10s cooldown (Python/LLM 保護)、`fullValidationMaxPerRun` (default 5)

## 経路 8. Evolution cron (世代交代)

- **Trigger**: `sideBScheduler.startEvolutionJob()` → 15 分間隔チェック → 24h ガードで 1 日 1 回 (Phase 5)
- **Input**: `StrategyPopulation` (`data/evolution/strategy-population.json`)、confirmed EdgeHypothesis、365 日分 OHLCV、NoveltyTracker
- **Agents**: `CrossoverAgent` → `MutationAgent` → `EvolutionLoop` (世代進化) → `GenerationReflectionAgent` (lesson)
- **Output type**: `EvolutionJobResult` (regimeReports, errors)
- **DB write**: `EvolutionInstanceCarry` (世代跨ぎ保持) + `GenerationLesson` (各世代の lesson)
- **API**: `GET /api/side-b/evolution/runs`, `/api/side-b/evolution/runs/:runId/candidates`, `/api/side-b/evolution/lessons`
- **UI**: `/side-b/evolution` (進化ループダッシュボード、generation tree)
- **備考**: Phase A で multi-generation 対応 (`config.evolutionGenerations` 未指定なら 1 = 従来動作)、`config.evolutionRegimes` で複数戦略体系を並列進化。**ここの population が C-1 第二段階の EURUSD 戦略残存元**

## 経路 9. PromptEvolution cron

- **Trigger**: `sideBScheduler.startPromptEvolutionJob()` → 1 時間チェック → 30 日ごと (Phase 6、デフォルト無効)
- **Input**: 全エージェントの experimental prompt 成績 (`experimental_candidates` テーブル)
- **Agents**: `PromptMutationAgent` (新 experimental 3 件/エージェント 生成) → 評価エージェント群
- **Output type**: `PromptEvolutionResult` (reports[] = agentName, newExperimentalIds, rejectedIds, promotionCandidates)
- **DB write**: `experimental_candidates` (新レコード + obsolete フラグ) + `PromptApproval` queue
- **API**: 専用 endpoint 未確認 (`approveCli.ts` 経由が主)
- **UI**: 未確認 (プロンプト管理 UI は別途)
- **備考**: 自動昇格なし、`approveCli.ts` で人間承認後に昇格

---

## 経路間依存関係 / 順序関係

```
Plan 生成 (3) → Trade 監視 (4): Plan が pending Trade を作成 → 監視が state 遷移
Trade 完了 (4) → PDCALoop (2): TradeCompleted 通知 → Reflection フェーズへ遷移
Trade 完了 (4) → Discovery (5): Note 蓄積 → 7 日分で週次仮説生成
Discovery (5) → Screening (6): unverified 仮説を screening_passed へ
Screening (6) → FullValidation (7): screening_passed を confirmed / rejected へ
FullValidation (7) → Evolution (8): confirmed 仮説が Evolution の seed 候補
Evolution (8) ⇄ PDCALoop (2): Evolution の lesson を thinking log に注入 (双方向)
全 cron 系 (3-8) → PDCALoop (2): pdcaLoop.notifyXxx() で状態/lessons 通知
PromptEvolution (9): 他経路に影響なし、独立
```

**注目すべき分岐**: EdgeHypothesis (仮説) は 経路 5 (Discovery 由来 `source=discovery`) と 経路 8 → 経路 6 → 経路 7 経由 (Evolution 由来、`source=ai_generated` 含む) の **2 経路で生成される**。

## C-5 (集計数字不一致) 解消への接続点

UI 各ページが見ている数字と、その起点となる経路:

| UI ページ | 表示している数字 | 起点経路 (推測) | 集計テーブル |
|---|---|---|---|
| `/side-b/dashboard` | 総仮説 / コンプリート / 直近検証成功率 | 経路 5 + 7 | `EdgeHypothesis` |
| `/side-b/trades` | 仮想トレード一覧、勝率 | 経路 3 + 4 | `VirtualTrade` |
| `/side-b/ai-notes` | AI ノート総数、outcome 分布 | 経路 4 (Reflection AI) | `AITradeNote` |
| `/side-b/comparison` | Side-A / Side-B 比較 | 複数経路を統合 | (集計クエリ要確認) |
| `/side-b/evolution` | Run 数、generation tree | 経路 8 | `EvolutionInstanceCarry` + `GenerationLesson` |
| `/side-b/validation` | 検証待ち / 検証中 / 確定 | 経路 6 + 7 | `EdgeHypothesis.status` |
| `/side-b/hypotheses` | 仮説一覧 | 経路 5 + 経路 7 経由 | `EdgeHypothesis` |

**仮説**: 数字不一致 (C-5) は以下のいずれか:
1. 各ページが **異なる DB テーブル** を集計している (例: `AITradeNote.outcome` vs `VirtualTrade.exitReason` で「成功」の定義がズレ)
2. 各ページが **同じテーブルだが異なる WHERE フィルタ** で集計している (例: 期間 / status / symbol の絞り方が違う)
3. UI 側で計算ロジックが重複し、結果がドリフトしている

C-5 解消の作業:
1. 各 UI ページが叩いている API を実コードで確認 (`src/frontend/app/side-b/*/page.tsx`)
2. 各 API の集計クエリを `src/side-b/routes/*` + repository / service 層で追跡
3. 「同じ概念の数字」が複数経路で計算されているか、ソース・オブ・トゥルースを明確化

これは別 PR / 別 KICKOFF で着手する。

## 現状確認できなかった項目 (未追跡)

- 経路 5/6 の専用 GET API (`/api/side-b/hypotheses` の status filter で代替できるかは要確認)
- 経路 9 PromptEvolution の UI 表示先
- 経路 8 ↔ 2 (Evolution ↔ PDCA) の lesson 注入経路の interface 型のみ定義、実実装の詳細
- PDCA 状態の DB 永続化有無 (in-memory のみ?)
- `CleanupJob` (PR-4) の具体的処理内容

## 関連ファイル

- `src/side-b/jobs/sideBScheduler.ts` (全 cron の管制塔)
- `src/side-b/jobs/{planGeneration,tradeMonitoring,discovery,screening,fullValidation,evolution,promptEvolution}Job.ts`
- `src/side-b/agent/{agentLoop,pdcaLoop}.ts`
- `src/side-b/evolution/EvolutionLoop.ts`
- `docs/architecture/STEP_5_AGENT_UI_MAPPING.md` (エージェント単位、直交軸)
- `docs/architecture/STEP_5_RUNTIME_AUDIT.md` (Phase A-F 集約、本ドキュメントの上位)
