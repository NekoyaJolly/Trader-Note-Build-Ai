# ADK Orchestrator + RunLedger + StrategyDraft - Phase 0 棚卸しレポート

> **位置づけ**: WBS (`docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md`) の Phase 0 (前提固定 / 差分棚卸し) の成果物。  
> **対象**: 「現状 8 Job + SideBScheduler の責務」と「不可侵領域」「実装順序」の固定。  
> **後続**: Phase 1 (`AgentRun` / `AgentRunStep` / `StrategyDraft` の Prisma schema 追加)。

---

## 0. 結論サマリー

| 項目 | 現状 |
|---|---|
| 分離済み Job | **8 本** (`monitor`, `plan-generation`, `discovery`, `screening`, `full-validation`, `evolution`, `prompt-evolution`, `cleanup`) + 補助 (`evolution-carry-retention` は `CleanupJob` 経由) |
| Job 共通実行台帳 | **未実装** (`startedAt` / `finishedAt` / `summary` / `status` を統一的に永続化していない) |
| 起動入口 (Scheduler) の責務 | 起動 + 各 Job 個別の最終実行時刻 in-memory 管理 + `isEvolutionRunning` 排他フラグ + cTrader token 自動検出 |
| Evolution 候補の業務管理 | **未実装** (Evolution → FullValidation の handoff は `EdgeLedger` 直接、Draft lifecycle なし) |
| `JobCoordinator` | 実装済みだが **未使用** (Scheduler は Job を直接呼び出し) |
| 不可侵領域 | `docs/architecture/ADK_ADOPTION.md` §6 に既に明文化済み (本 PR で追記不要) |

---

## 1. 8 Job 責務表 (Task 0.1)

| Job | ファイル | 主エクスポート | 入力 | 戻り値 | 失敗時 | 触る DB | 依存サービス | 1 行責務 |
|---|---|---|---|---|---|---|---|---|
| Monitor | `src/side-b/jobs/tradeMonitoringJob.ts` | `run(config)` / `runWithServices(config, services)` | `SideBSchedulerConfig` | `JobResult { success, message }` | catch → `addError` + throw | `VirtualTrade` / `Plan` / `AITradeNote` | `MarketDataService` / `CronSimilarityService` | 1m 足の高安値で約定検証、`pending→open→closed` を進める |
| PlanGeneration | `src/side-b/jobs/planGenerationJob.ts` | `run(config)` / `runWithServices(config, services)` | `SideBSchedulerConfig` | `PlanGenerationRunReport { success, message, results[] }` | catch → `addError` (シンボル別個別継続) | `OHLCV` / `Plan` / `VirtualTrade` / `Research` | `MarketDataService` / `AIOrchestrator` | 執行足 + 上位足 OHLCV からプラン生成 → VirtualTrade 作成 |
| Discovery | `src/side-b/jobs/discoveryJob.ts` | `run(config)` | `SideBSchedulerConfig` (実体未使用) | `DiscoveryJobResult { noteCount, newHypothesesCount, lensInsightsCount, tokenUsage, skipped }` | catch → `addError`、skipped=true | `EdgeLedger` (仮説書き込み) | `DiscoveryAgent` / `aiNoteRepository` | 直近 7d の AI ノートを集計 → 新仮説 + Lens insights 生成 |
| Screening | `src/side-b/jobs/screeningJob.ts` | `run(config)` / `runWithOptions(config, options?)` | `SideBSchedulerConfig` (`screeningMaxPerRun`) | `ScreeningJobResult { processed, passed, rejected, notTestable, errors }` | catch → `addError`、仮説別 best-effort | `EdgeLedger` | `ScreeningOrchestrator` / `agentMemory` | unverified 仮説の事前 BT 評価 → `screening_passed/rejected` 遷移 |
| FullValidation | `src/side-b/jobs/fullValidationJob.ts` | `run(config)` | `SideBSchedulerConfig` (`fullValidationMaxPerRun`) | `FullValidationJobResult { processed, confirmed, rejected, notTestable, errors }` | catch → `addError`、仮説別個別継続 | `EdgeLedger` | `StrategistAgent` | screening_passed 仮説の本格検証 → `confirmed/rejected/not_testable` |
| Evolution | `src/side-b/jobs/evolutionJob.ts` | `run(config)` | `SideBSchedulerConfig` (`evolutionRegimes`, `evolutionGenerations`, ...) | `EvolutionJobResult { regimeReports, errors }` | catch → `errors[]` 記録、計数継続 | `EvolutionInstanceCarry` / `GenerationLesson` | `EvolutionLoop` / `CrossoverAgent` / `MutationAgent` / `DiversityEnforcer` / `StrategyPopulation` | 複数レジーム × N 世代の戦略 DSL 進化ループ |
| PromptEvolution | `src/side-b/jobs/promptEvolutionJob.ts` | `run(config)` | `SideBSchedulerConfig` (実体未使用) | `PromptEvolutionResult` (本体 `prompts/registry/promptEvolutionJob.ts` から pass-through) | catch → `addError` | `ExperimentalAgent` / `AgentPrompt` | `runPromptEvolutionCycle()` / `PromptMutationAgent` | 全エージェント experimental 評価 → 昇格候補抽出 + 新 experimental 生成 |
| Cleanup | `src/side-b/jobs/cleanupJob.ts` | `run(config)` | `SideBSchedulerConfig` (`planRetentionDays`, `tradeRetentionDays`) | `CleanupJobResult { executed, expiredResearchCount, oldPlansCount, oldTradesCount, carryRetention, error? }` | catch → `deps.addError`、`result.error` に記録 | `Research` / `Plan` / `VirtualTrade` / `EvolutionInstanceCarry` | `executeCleanup` / `EvolutionJob.runCarryRetention()` | 期限切れ Research + 古い Plan + 古い Trade 削除 + EvolutionCarry retention |

### 1.1 戻り値形の乖離 (Phase 3 で `JobResultEnvelope` に揃える対象)

| Job | 戻り値の特異点 |
|---|---|
| Monitor | `JobResult { success, message }` (データなし) |
| PlanGeneration | `results[]` (シンボル別) |
| Discovery | カウント中心 (`noteCount`, `newHypothesesCount`, ...) + `tokenUsage` |
| Screening / FullValidation | `processed/passed(confirmed)/rejected/notTestable/errors` |
| Evolution | `regimeReports: number` + `errors: string[]` |
| PromptEvolution | 構造不詳 (本体 pass-through) |
| Cleanup | `executed/...Count/carryRetention/error?` (最も複雑) |

### 1.2 共通項目の実装状況

| 項目 | 現状 |
|---|---|
| `startedAt` | **未記録** (Job 入口で時刻を保持しない) |
| `finishedAt` | **一部** (onCompleted コールバック経由で Scheduler 側で `lastXxxRun` を更新) |
| `status` | **bool のみ** (`success`、`skipped` は一部のみ) |
| `summary` | **一部** (`JobResult.message` あり、形式バラバラ) |
| `durationMs` | **未記録** (`JobCoordinator` 内で計測するがログのみ、戻り値に乗らない) |
| `nextAction` | **未実装** |
| `errorCode` | **未実装** (文字列 / Error / 配列が混在) |
| `idempotencyKey` | **未実装** |

---

## 2. SideBScheduler 残責務 (Task 0.2)

### 2.1 起動・停止
- `setInterval` で 8 Job 用に個別 IntervalId を保持
  - Monitor: 即時 + 1h
  - Plan: 1h チェック → `planIntervalHours` (既定 24h) で実行判定
  - Discovery: 1h チェック → 7d ガード
  - Screening: 1h チェック → 24h ガード (初回起動時は即時)
  - FullValidation: 1h チェック → 24h ガード (初回起動時は即時)
  - Evolution: 15m チェック → 24h ガード (`isEvolutionRunning` 二重実行防止)
  - PromptEvolution: 1h チェック → 30d ガード (`autoTriggerPromptEvolution`)
  - Cleanup: スケジューラ内で実行

### 2.2 feature flag / config 参照
- `config.enabled` (全体 ON/OFF)
- `config.symbols[]` / `config.timeframe` / `config.higherTimeframe`
- `auto*` フラグ: `autoGenerateNote`, `autoSummary`, `autoExpireTrades`, `autoCleanup`, `autoSimilarityCheck`, `autoScreening`, `autoFullValidation`, `autoEvolution`, `autoTriggerPromptEvolution`
- 保持期間 / 閾値: `planRetentionDays`, `tradeRetentionDays`, `similarityThreshold`, `screeningMaxPerRun`, `fullValidationMaxPerRun`, `evolutionRegimes`, `evolutionGenerations` 他

### 2.3 Job 呼び出し方
- **Coordinator 未使用**: Job は Scheduler から直接呼び出し
- private helper (`executeMonitorJob` / `executePlanJob` / `checkAndExecutePlan` 他) で wrap
- 排他制御は Scheduler 内 in-memory フラグ + EvolutionJob 側の onCompleted コールバック

### 2.4 in-memory state (Phase 7 で削除対象 / RunLedger 化候補)
- `isRunning: boolean`
- `isEvolutionRunning: boolean`
- `lastPlanRun: Map<string, Date>` (シンボル別)
- `lastMonitorRun?: Date`
- `lastDiscoveryRun?: Date`
- `lastScreeningRun?: Date`
- `lastFullValidationRun?: Date`
- `lastEvolutionRun?: Date`
- `lastPromptEvolutionRun?: Date`
- `lastCleanupRun?: Date`
- `errors: string[]` (最新 100 件、タイムスタンプ付き)

### 2.5 DB CRUD
- なし (Scheduler 自身は CTraderToken の最新 1 件取得のみ)
- 各 Job が自身で Prisma 経由 CRUD

### 2.6 候補管理 (StrategyDraft 相当)
- **なし**。Evolution → FullValidation の handoff は `EdgeLedger` 直接更新で「Draft」レイヤーが存在しない。
- Phase 4 で `StrategyDraftService` を新設し、Evolution 候補をここで受け止める。

---

## 3. JobCoordinator の現状

- `src/side-b/jobs/jobCoordinator.ts`: `run<T>(jobName, fn)` で同名 Job 実行中なら `null` 返却 (skip)
- 業務 state は持たない (running フラグ + ログのみ)
- **現状未使用** (Phase 3 で `JobPort` 化する際に「捨てるか」「ADK Wrapper の中で生かすか」を再判断)

---

## 4. types.ts / index.ts の公開 API

### `src/side-b/jobs/types.ts`
- `SideBJobName` (11 値): `'monitor' | 'plan-generation' | 'discovery' | 'screening' | 'full-validation' | 'evolution' | 'evolution-carry-retention' | 'prompt-evolution' | 'cleanup' | 'summary'`
- `SideBJobResult { success, message?, errors? }`
- `SideBJobRunner<TConfig, TResult> { name; run(config: TConfig): Promise<TResult> }`
- `SideBJobDeps { addError(msg); log(msg) }`

### `src/side-b/jobs/index.ts`
- `SideBScheduler` クラス
- `getSideBScheduler(config?)` (singleton)
- `resetSideBScheduler()` (テスト用)
- `SideBSchedulerConfig` / `JobResult` / `SchedulerStatus`

---

## 5. 不可侵領域 (Task 0.3) — 既存ドキュメントを再確認

WBS §17 (PR ごとの禁止事項) と `docs/architecture/ADK_ADOPTION.md` §6 (不可侵領域) に既に明文化済み。**本フェーズで追加文書化はしない**。

要点だけ抜粋:

| 領域 | 該当 |
|---|---|
| `PromptRegistry` | `src/side-b/prompts/` 周辺 |
| `SkillRegistry` API | `src/side-b/skills/` |
| `AgentLoop` / `PDCALoop` 内部 | `src/side-b/agent/pdcaLoop.ts` |
| `AIProvider` 内部 | OpenRouter ラッパー |
| `strategy_dsl` | `src/side-b/strategy_dsl/` |
| `EdgeLedger` 昇格判定 | `src/side-b/ledger/` |
| Lens 群 | `src/side-b/lenses/` |
| Evolution 探索アルゴリズム | `src/side-b/evolution/` |

加えて WBS §2.1 で:

```
既存Job → ADK SDK 直接依存            禁止
RunLedgerService → ADK SDK 直接依存   禁止
StrategyDraftService → ADK SDK 直接依存  禁止
SideBScheduler → AgentRunStep 直接CRUD  禁止
SideBScheduler → StrategyDraft 直接CRUD 禁止
```

---

## 6. 既存テスト baseline (Task 0.4)

| 計測 | 値 | 取得方法 | 取得日 |
|---|---|---|---|
| `tsc --noEmit` (本番 tsconfig) | **0 errors** | `npx tsc --noEmit` | 2026-05-17 (Phase 0 PR 時) |
| ESLint (`.` 全体) | **335 problems (129 errors / 206 warnings)** ※ ほぼ既存 e2e / tools の従来分 | `npx eslint .` | 2026-05-17 (Phase 0 PR 時) |
| Jest (side-b) | Step 4 完了時点で 128 suites / 1678 PASS / 4 skipped (`STEP_4_SUMMARY.md`) | `npm test -- --runInBand src/side-b` | 引き継ぎ値 (2026-05-14) |
| Jest (adk 領域) | 累計 226 cases all PASS (`ADK_ADOPTION.md` §7) | `npm test -- --runInBand src/side-b/adk` | 引き継ぎ値 (2026-05-14) |

> **方針**: Phase 0 PR では「baseline 値を悪化させない」ことだけを担保する。ESLint の既存違反数 (129/206) は本 WBS 範囲では解消しない (担当外、`STEP_0_CI_STATUS.md` §3.2 の別タスク扱い)。Phase 9 で side-b regression を取り直す。

---

## 7. 実装順序最終確認 (Task 0.5)

WBS §4 全 10 Phase を、**1 PR 1 Phase / マージ確認後に次 Phase 着手**で進める。

| Phase | PR タイトル目安 |
|---|---|
| 0 | `chore(orch): Phase 0 - jobs/scheduler 棚卸しと baseline` (本 PR、docs only) |
| 1 | `feat(orch): Phase 1 - AgentRun / AgentRunStep / StrategyDraft の Prisma schema 追加` |
| 2 | `feat(orch): Phase 2 - RunLedgerService 実装` |
| 3 | `feat(orch): Phase 3 - JobPort / JobResultEnvelope と既存 Job adapter` |
| 4 | `feat(orch): Phase 4 - StrategyDraftService 実装` |
| 5 | `feat(orch): Phase 5 - RunLedgerTraceSink adapter` |
| 6 | `feat(orch): Phase 6 - ADK Orchestrator Wrapper (Golden Path)` |
| 7 | `feat(orch): Phase 7 - SideBScheduler を起動入口に限定 + feature flag` |
| 8 | `feat(orch): Phase 8 - Run / Draft API + 最小 UI` |
| 9 | `test(orch): Phase 9 - 統合テスト / 失敗系 / 回帰` |
| 10 | `docs(orch): Phase 10 - Runbook + ADK_ADOPTION 更新 + Summary` |

混ぜない原則:
- 1 PR に複数 Phase の実装を混ぜない (WBS §17)
- 設計書の更新は実装 PR と同一でも別でも良い (`AGENTS.md` §5.1)

---

## 8. Phase 0 DoD チェック

- [x] 分離済み Job 一覧がある (§1)
- [x] Scheduler の残責務が把握されている (§2)
- [x] 既存テスト baseline が記録されている (§6)
- [x] 不可侵領域に対する git diff 禁止が明文化されている (§5、既存 `ADK_ADOPTION.md` §6 + WBS §17 を引用)

---

> **後続**: Phase 1 で `prisma/schema.prisma` に `AgentRun` / `AgentRunStep` / `StrategyDraft` の 3 model + status enum + unique index (`idempotencyKey`, `runId+stepName+attempt`, `candidateHash`) を追加する。
