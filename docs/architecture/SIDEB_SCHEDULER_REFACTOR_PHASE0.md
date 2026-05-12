# SIDEB_SCHEDULER_REFACTOR_PHASE0.md - 現状棚卸し

> **チケット**: Phase 0 (現状棚卸しと安全柵)
> **作成日**: 2026-05-12
> **対象**: `src/side-b/jobs/sideBScheduler.ts` (1940 行 / 77 KB)
> **方針**: 挙動変更なし、PR-1 以降の作業計画の基礎資料
> **計画書**: `docs/side-b/sideb_scheduler_refactor_agent_prompt.md`

---

## 1. 現状サマリ

`SideBScheduler` は当初「定期実行管理」だけを担う想定だったが、現在は以下 11 種の責務を直接抱えている (= 神クラス):

仮想トレード監視 / プラン生成 / Note 自動生成 / 類似度チェック / Discovery / Screening / FullValidation / Evolution / PromptEvolution / Cleanup / SummaryScheduler 起動 + 周辺 (cTrader / MarketData 初期化、PDCA 通知、エラー履歴、env 解釈・clamp)。

---

## 2. Public API 列挙 (互換維持の判定対象)

### 2.1 クラス本体 (`SideBScheduler`)

| メソッド | シグネチャ | 互換維持 | 備考 |
|---------|-----------|----------|------|
| `constructor` | `(configOverride?: Partial<SideBSchedulerConfig>)` | ✅ 必須 | env override + DEFAULT_CONFIG マージ。優先順位: configOverride > env > DEFAULT |
| `start` | `(): void` | ✅ 必須 | interval 群を起動。enabled=false なら何もしない |
| `stop` | `(): void` | ✅ 必須 | 全 interval を clear |
| `updateConfig` | `(newConfig: Partial<SideBSchedulerConfig>): void` | ✅ 必須 | 実行中ならいったん stop → start |
| `getStatus` | `(): SchedulerStatus` | ✅ 必須 | 形状を変えない。`errors`, `config`, `automation`, `summaryScheduler`, `lastDailyPlanRun`, `lastMonitorRun`, `marketStatus` を含む |
| `runDailyPlanNow` | `(): Promise<JobResult>` | ✅ 必須 | 手動実行用エンドポイント |
| `runMonitorNow` | `(): Promise<JobResult>` | ✅ 必須 | 手動実行用エンドポイント |
| `runScreeningNow` | `(options?: { ... }): Promise<...>` | ✅ 必須 | Phase 4b 縮小版スクリーニング |
| `runFullValidationNow` | `(): Promise<{ processed, confirmed, rejected, notTestable, errors }>` | ✅ 必須 | テスト直接検証あり (fullValidation.test.ts) |
| `runEvolutionNow` | `(): Promise<{ regimeReports: number; errors: string[] }>` | ✅ 必須 | テスト直接検証あり (evolutionMultiGen.test.ts) |
| `runPromptEvolutionNow` | `(): Promise<PromptEvolutionResult>` | ✅ 必須 | 月次プロンプト進化 |
| `runEvolutionCarryRetentionNow` | `(): Promise<{ deleted: number; error?: string }>` | ✅ 必須 | テスト直接検証あり (evolutionCarryRetention.test.ts) |
| `runDiscoveryNow` | `(): Promise<void>` | ✅ 必須 | 週次 Discovery 手動実行 |

### 2.2 モジュール関数 (singleton 管理)

| 関数 | シグネチャ | 互換維持 |
|------|-----------|----------|
| `getSideBScheduler` | `(config?): SideBScheduler` | ✅ 必須 |
| `resetSideBScheduler` | `(): void` | ✅ 必須 (テスト用) |

### 2.3 公開型 (`index.ts` から export)

| 型 | 互換維持 |
|----|----------|
| `SideBScheduler` (class) | ✅ 必須 |
| `SideBSchedulerConfig` | ✅ 必須 (Partial を引数で受けるため) |
| `JobResult` | ✅ 必須 (`runDailyPlanNow` / `runMonitorNow` の戻り値) |
| `SchedulerStatus` | ✅ 必須 (`getStatus` 戻り値) |

---

## 3. Private method 列挙 (Job 化対象)

| メソッド | 移行先 (PR-N) | 種別 |
|---------|--------------|------|
| `initCTraderDataSource` | (Scheduler に残す or 共通基盤へ移す要検討) | 初期化 |
| `startInternal` | Scheduler に残す | interval 登録のみ |
| `startMonitorJob` | Scheduler に残す | due 判定 + dispatch のみ |
| `startPlanJob` | Scheduler に残す | due 判定 + dispatch のみ |
| `startDiscoveryJob` | Scheduler に残す | dispatch のみ |
| `startScreeningJob` | Scheduler に残す | dispatch のみ |
| `startFullValidationJob` | Scheduler に残す | dispatch のみ |
| `startEvolutionJob` | Scheduler に残す | dispatch のみ |
| `startPromptEvolutionJob` | Scheduler に残す | dispatch のみ |
| `executeMonitorJob` | **PR-3 → TradeMonitoringJob** | 業務処理 |
| `checkAndExecutePlan` | **PR-3 → PlanGenerationJob** | 業務処理 |
| `runEvolutionMultiGen` | **PR-1 → EvolutionJob** | 業務処理 |
| `notifyPdcaEvolutionGeneration` | **PR-1 → EvolutionJob** | 業務処理 |
| `log` | jobCoordinator へ集約 (PR-1) | 共通 |
| `addError` | jobCoordinator へ集約 (PR-1)、scheduler の `errors[]` への記録は維持 | 共通 |

> **重要**: `executeMonitorJob` と `checkAndExecutePlan` は名前は `start*` ではないが、業務本体を直接実装している (1300〜1500 行付近)。テストから `(scheduler as any).executeMonitorJob()` で**直接呼ばれている** (similarity.test.ts L199, 239, 263, 275, 301, 317, 330) ため、Phase 4 で Job 化する際は **薄い delegation を残す** か、**テストを新 Job へ移す** 必要がある。

---

## 4. テスト 4 ファイルの検証内容と依存

### 4.1 `sideBScheduler.similarity.test.ts` (342 行)

**検証対象**:
- `autoSimilarityCheck` / `similarityThreshold` の config 反映 (3 ケース)
- `executeMonitorJob()` の挙動 (5 ケース): 類似度チェック実行 / 無効時スキップ / 0 件時継続 / エラー時継続 / 複数シンボル
- 市場休場時のスキップ (1 ケース)
- データ取得失敗時のスキップ (1 ケース)

**mock 対象**:
- `cronSimilarityService` (clas), `MarketDataService` (class), `marketHours.isFXMarketOpen`/`getMarketStatusJST`
- `virtualTradeService` 全関数, `repositories.{findVirtualTrades, updateTradeToOpen, closeTrade, planRepository.findAll}`
- `orchestrator/aiOrchestrator`

**Scheduler に対する破壊的アクセス**:
- `(scheduler as any).marketDataService = mockMarketDataService` ← private field 直接書き換え
- `(scheduler as any).cronSimilarityService = mockCronSimilarityService` ← 同上
- `(scheduler as any).executeMonitorJob()` ← private method 直接呼び出し

**リファクタ時の対応**:
- Job constructor で `marketDataService` / `cronSimilarityService` を **依存注入できる形** にする (`new TradeMonitoringJob({ marketDataService, cronSimilarityService })`)
- テストは Job 単体テストへ移す

### 4.2 `sideBScheduler.fullValidation.test.ts` (265 行、6 ケース)

**検証対象** (`runFullValidationNow()`):
- `edgeLedger.findByStatus('screening_passed')` 取得 + StrategistAgent.validate 集計
- `fullValidationMaxPerRun` での件数制限
- verdict 別カウント (`confirmed` / `rejected` / `not_testable` / `insufficient_data` / 例外時 `errors`)
- 対象 0 件時の早期 return
- `findByStatus` 失敗時の addError 経路
- `pdcaLoop.notifyValidationBatchComplete('full_validation', result)` の呼び出し

**mock 対象**: `edgeLedger`, `strategistAgent`, `pdcaLoop`, `marketHours`, `MarketDataService`, `AIOrchestrator`, `summarySchedulerService`, `cronSimilarityService`, `repositories`, `virtualTradeService`, `aiNoteRepository`

**特殊事項**: クールダウン 10 秒を `setTimeout` 即時解決でモック (`mockSleepToInstant`)

**リファクタ時の対応**:
- PR-2 で `FullValidationJob` に移行。集計形状・PDCA 通知 key (`'full_validation'`) を維持
- mock 対象を `FullValidationJob` 側に移す

### 4.3 `sideBScheduler.evolutionMultiGen.test.ts` (681 行、22 ケース)

**検証対象** (`runEvolutionNow()` の dispatch logic):
- `evolutionGenerations=1` で従来単世代経路 (`EvolutionLoop.runOneGeneration` 直接呼び出し、`multiGenerationRunner` は呼ばない)
- `evolutionGenerations>=2` で `runMultiGenerationEvolutionV1` 経由、generations 伝播
- env 解釈 (5 種): `EVOLUTION_GENERATIONS`, `EVOLUTION_ADAPTIVE_BUDGET`, `EVOLUTION_QD_ARCHIVE`, `EVOLUTION_QD_PARENT_LIMIT`, `AUTO_EVOLUTION`
- 不正値 (範囲外整数、小数、想定外文字列) の warning + DEFAULT_CONFIG
- configOverride で範囲外の値 (0 or 99) を clamp (max=5)
- 優先順位: configOverride > env > DEFAULT_CONFIG
- multi-gen で 1 regime 失敗時の他 regime 継続
- Phase E: `pdcaLoop.notifyEvolutionGenerationComplete` を各世代終了時に呼ぶ (N regime × M gen 回 / 単世代 1 回 / 例外時 errors[] 記録)

**mock 対象**: `edgeLedger`, `StrategistAgent`, `CrossoverAgent`, `MutationAgent`, `StrategyPopulation`, `DiversityEnforcer`, `SurrogateFitnessSimulator`, `defaultOosBacktestRunner`, `EvolutionLoop` (with `runOneGeneration` mock), `multiGenerationRunner` (with `runMultiGenerationEvolutionV1` mock, `MULTI_GENERATION_DEFAULTS` exposed), `pdcaLoop`, `marketHours`, `MarketDataService`, `AIOrchestrator`, `cronSimilarityService`, `summarySchedulerService`, `repositories`, `virtualTradeService`, `aiNoteRepository`

**リファクタ時の対応**:
- PR-1 で `EvolutionJob` に移行。clamp / env 解釈は Job 側へ持ち込む
- mock 対象を `EvolutionJob` 側に移す
- `runOneGeneration` / `runMultiGenerationEvolutionV1` の呼び出し回数・引数を検証する仕組みを維持

### 4.4 `sideBScheduler.evolutionCarryRetention.test.ts` (180 行、5 ケース)

**検証対象** (`runEvolutionCarryRetentionNow()`):
- `evolutionInstanceCarryRepository.deleteOlderThan(14)` の呼び出しと戻り値
- 削除件数 > 0 のとき `console.info` で本番でも Cloud Logging に出るログ (PR #142 Copilot review #1)
- 削除件数 = 0 のとき `console.info` を呼ばない (ノイズ抑制)
- 例外時に `{ deleted: 0, error: ... }` を返しつつ `scheduler.getStatus().errors` に記録 (addError 経路)
- production NODE_ENV でも `console.info` が動く (`this.log` の no-op 問題対応)

**mock 対象**: `evolutionInstanceCarryRepository.deleteOlderThan`、+ 上記 evolutionMultiGen と同じ重い依存群

**リファクタ時の対応**:
- PR-1 の `EvolutionJob` 内に `runCarryRetention` を相当ロジックとして配置するか、別 Job (CleanupJob 寄り) にするかは要検討
- `console.info` 経路は維持 (`this.log` の production no-op 問題を踏まえ、本番 Cloud Logging に出すため明示的 `console.info` で実装されている)
- `scheduler.getStatus().errors` への記録は維持必要 → JobCoordinator から Scheduler の `addError` を呼ぶ仕組みが必要

---

## 5. 全テストで共通の mock 対象 (= リファクタ後も維持すべき差し替えポイント)

| カテゴリ | 対象 | 用途 |
|---------|------|------|
| **マーケット情報** | `utils/marketHours` (`isFXMarketOpen`, `getMarketStatusJST`) | 市場開閉判定 |
| **AI 処理** | `agents/StrategistAgent`, `agents/DiscoveryAgent`, `agents/CrossoverAgent`, `agents/MutationAgent`, `orchestrator/aiOrchestrator` | LLM 呼び出し系 |
| **進化系** | `evolution/StrategyPopulation`, `evolution/DiversityEnforcer`, `evolution/EvolutionLoop`, `evolution/multiGenerationRunner`, `evolution/analysisEngineRobustnessAdapter`, `strategy_dsl/SurrogateFitnessSimulator` | 重い ML 依存 |
| **永続化** | `ledger.edgeLedger`, `repositories.{findVirtualTrades, updateTradeToOpen, closeTrade, planRepository}`, `repositories/aiNoteRepository`, `backend/repositories/evolutionInstanceCarryRepository` | DB アクセス |
| **市場データ** | `services/marketDataService`, `services/cronSimilarityService` | 外部 API |
| **トレード** | `services/virtualTradeService` (`expirePendingTrades`, `monitorEntryConditions`, `monitorPositions`, `createTradeFromPlan`) | trade lifecycle |
| **通知** | `agent.pdcaLoop` (`notifyAnalysisComplete`, `notifyStrategyComplete`, `notifyTradeCompleted`, `notifyValidationBatchComplete`, `notifyEvolutionGenerationComplete`) | PDCA 通知 |
| **サマリ** | `services/summarySchedulerService` (`start`, `stop`, `getStatus`) | 週次・月次サマリ |

→ **Job 化後も、これらは Job constructor 経由で差し替え可能にする** (依存注入)。

---

## 6. 互換維持メソッドの確定リスト (Phase 6 完了時に検査)

リファクタ完了後、以下が破壊されていないこと:

```ts
// Public API (= テスト + 他コードからの呼び出し対象)
new SideBScheduler(config?: Partial<SideBSchedulerConfig>)
scheduler.start(): void
scheduler.stop(): void
scheduler.updateConfig(config: Partial<SideBSchedulerConfig>): void
scheduler.getStatus(): SchedulerStatus  // 形状維持
scheduler.runDailyPlanNow(): Promise<JobResult>
scheduler.runMonitorNow(): Promise<JobResult>
scheduler.runScreeningNow(options?): Promise<...>
scheduler.runFullValidationNow(): Promise<{ processed, confirmed, rejected, notTestable, errors }>
scheduler.runEvolutionNow(): Promise<{ regimeReports: number; errors: string[] }>
scheduler.runPromptEvolutionNow(): Promise<PromptEvolutionResult>
scheduler.runEvolutionCarryRetentionNow(): Promise<{ deleted: number; error?: string }>
scheduler.runDiscoveryNow(): Promise<void>

// Module functions
getSideBScheduler(config?): SideBScheduler
resetSideBScheduler(): void

// Types
type SideBSchedulerConfig
type JobResult
type SchedulerStatus
```

`getStatus().errors[]` に各 Job のエラーが集約されること (= `addError` 経路を JobCoordinator から呼べる必要あり)。

---

## 7. private method 直接呼び出しの一時 delegation

テストから `(scheduler as any).executeMonitorJob()` のように private method を直接叩いている箇所がある。完全に Job 化した後、これらは以下のいずれかで救出:

- **A 案 (推奨)**: テストを新 Job 単体テストへ移す (Phase 4 注意点に明記された方針)
- **B 案 (一時的)**: Scheduler に `executeMonitorJob` の薄い delegation を残す (`(this.jobs.monitor as any).run()` を呼ぶだけ)

**判断基準**: テストロジック側を簡単に新 Job 用に書き換えられるなら A、テスト構造を大幅変更しないと壊れるなら B を経由してから移行。

---

## 8. リファクタ後のディレクトリ構造 (計画書 §完了後の理想構造 を踏襲)

```
src/side-b/jobs/
  sideBScheduler.ts              # 時刻管理・dispatch・stop・status のみ
  types.ts                       # SideBJobName, SideBJobResult, SideBJobRunner 等
  jobCoordinator.ts              # 排他制御・runId・ログ集約・エラー記録 (業務ロジックなし)
  sideBJobRegistry.ts            # job 名 → runner の登録 (必要なら)
  planGenerationJob.ts           # PR-3
  tradeMonitoringJob.ts          # PR-3
  discoveryJob.ts                # PR-4
  screeningJob.ts                # PR-2
  fullValidationJob.ts           # PR-2
  evolutionJob.ts                # PR-1 (carryRetention も内包候補)
  promptEvolutionJob.ts          # PR-4 (既存 prompts/registry/promptEvolutionJob.ts の薄いラッパーで可)
  cleanupJob.ts                  # PR-4
  summaryJob.ts                  # PR-4 (summarySchedulerService を橋渡し)
  index.ts                       # 公開 export
  __tests__/                     # 新規 Job 単体テスト群
    evolutionJob.test.ts         # PR-1
    fullValidationJob.test.ts    # PR-2
    screeningJob.test.ts         # PR-2
    tradeMonitoringJob.test.ts   # PR-3
    planGenerationJob.test.ts    # PR-3
    cleanupJob.test.ts           # PR-4
    sideBScheduler.dispatch.test.ts  # PR-5 (Scheduler 自体の dispatch logic 検証)
```

既存テスト 4 ファイル (`src/side-b/tests/sideBScheduler.*.test.ts`) はリファクタ後、**「互換 API が新 Job を呼ぶ」だけを確認する薄いテスト**に縮小する (詳細は Job 単体テストへ移行)。

---

## 9. PR 分割計画 (計画書 §進め方の推奨 を踏襲)

| PR | Phase | 内容 |
|----|-------|------|
| **PR-1** | Phase 1+2 | Job 共通基盤 (`types.ts` / `jobCoordinator.ts` / 必要なら `sideBJobRegistry.ts`) + EvolutionJob 切り出し + `evolutionMultiGen.test.ts` 互換維持 |
| **PR-2** | Phase 3 | FullValidationJob / ScreeningJob 切り出し + `fullValidation.test.ts` 互換維持 |
| **PR-3** | Phase 4 | TradeMonitoringJob / PlanGenerationJob 切り出し + `similarity.test.ts` 互換維持 (executeMonitorJob 救出) |
| **PR-4** | Phase 5 | Cleanup / Discovery / PromptEvolution / Summary 整理 |
| **PR-5** | Phase 6+7+8 | Scheduler 最終スリム化、ADK 境界 (`EvolutionWorkflowRunner` interface)、テスト最終整理 |

各 PR 完了時に以下を確認:
- `npm test -- src/side-b/tests/sideBScheduler.*.test.ts` 全 pass
- 該当 PR で追加した Job 単体テスト全 pass
- `npx tsc --noEmit -p tsconfig.json` 0 errors (本番)
- (任意) `npx tsc --noEmit -p tsconfig.audit.json` の件数が PR-1 と同じか減少

---

## 10. 注意点・落とし穴

### 10.1 evolutionCarryRetention の `console.info` 経路

PR #142 Copilot review #1 で「`this.log()` は production NODE_ENV で no-op になるため、Cloud Logging に出ない」問題が対応済み。`runEvolutionCarryRetentionNow` 内で削除件数 > 0 のときに **直接 `console.info` を呼んでいる** ことが要件 (`evolutionCarryRetention.test.ts` で検証)。Job 化後もこの経路を維持する必要がある。

### 10.2 `executeMonitorJob` の private 直接呼び出し

`similarity.test.ts` で `(scheduler as any).executeMonitorJob()` を 6 箇所で呼んでいる。Phase 4 で TradeMonitoringJob に移行する際、**最小限の delegation か新 Job 単体テストへの全面移行か**を選ぶ必要がある。判断は PR-3 着手時。

### 10.3 PDCA 通知の key

| 場所 | 通知 method | 第一引数 |
|------|------------|----------|
| `runFullValidationNow` | `notifyValidationBatchComplete` | `'full_validation'` |
| `runEvolutionMultiGen` 各世代終了時 | `notifyEvolutionGenerationComplete` | (引数複数、Phase E で追加) |

通知 key を変えると既存テストが落ちる + Cloud 側の集計が壊れる。Job 化時も key 維持。

### 10.4 env 解釈の集中

現状 `readEvolutionEnvOverrides()` (約 250 行付近) で 5 種類 env を解釈し、`parseEnvInt` / `parseEnvBool` で厳密整数判定 + warning を出している。PR-1 で `EvolutionJob` 側に持ち込む際、parseEnvInt/Bool の挙動 (`'2.9'` / `'2abc'` / `'yes'` を warning + 無視) を維持する必要がある。`evolutionMultiGen.test.ts` の "PR #138 Copilot review 対応" describe 内で 4 ケース検証されている。

### 10.5 clamp の範囲

`evolutionGenerations` は 1〜5 に clamp。0 や 99 を渡すと scheduler 側で clamp して動く挙動が `evolutionMultiGen.test.ts` で検証されている。Job 側に移しても同じ範囲・同じ警告ログを保つ。

---

## 11. 完了条件 (Phase 0 DoD)

- [x] Public API 一覧 (§2)
- [x] private method 一覧と移行先 (§3)
- [x] 4 テストファイルの検証内容と mock 依存 (§4)
- [x] 共通 mock 対象 (§5)
- [x] 互換維持メソッド確定リスト (§6)
- [x] private 直呼び出しの一時 delegation 方針 (§7)
- [x] リファクタ後ディレクトリ構造 (§8)
- [x] PR 分割計画 (§9)
- [x] 注意点・落とし穴 (§10)
- [x] **挙動変更なし** (本書は調査のみ、コードは触っていない)

---

## 12. 次ステップ

PR-1 (Phase 1+2: Job 共通基盤 + EvolutionJob 切り出し) に着手する。新規ブランチ `feature/sideb-scheduler-refactor-pr1` で作業。
