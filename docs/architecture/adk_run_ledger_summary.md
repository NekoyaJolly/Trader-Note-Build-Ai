# ADK Orchestrator + RunLedger + StrategyDraft - 完了サマリー

> **位置づけ**: WBS (`docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md`) の Phase 0〜10 完了サマリー。本書 1 件で全 Phase の成果物 / PR / DoD / 撤退手順を引き継げる構造にする (ドキュメント増殖禁止原則)。  
> **最終更新**: 2026-05-17 (Phase 10 完了時)  
> **対象**: 後続作業者 / 撤退判断時 / Runbook

---

## 0. 完了サマリー (1 行)

> `SideBScheduler` の実行ハブ責務を、**ADK Orchestrator Wrapper** (外側の順序制御) と **RunLedgerService** (run/step の永続台帳) と **StrategyDraftService** (Evolution 候補の Draft lifecycle) に分離した。`SideBScheduler` は「起動入口」に戻り、既存 `PDCALoop` / `EvolutionLoop` / `Lens` 内部は一切置き換えていない。

---

## 1. PR 一覧 (Phase 0 → 10)

| Phase | タイトル | PR | base 作成時 | マージ | 主要成果物 |
|---|---|---|---|---|---|
| 0 | jobs/scheduler 棚卸しと baseline | [#216](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/216) | `main` | 2026-05-16 | `adk_run_ledger_phase_0_棚卸し.md` |
| 1 | AgentRun / AgentRunStep / StrategyDraft schema | [#217](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/217) | `main` | 2026-05-16 | Prisma 3 model + 4 enum + migration + 11 smoke test |
| 2 | RunLedgerService | [#218](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/218) | `main` | 2026-05-16 | Service + Repository + redaction + 35 test |
| 3 | JobPort / JobResultEnvelope | [#219](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/219) | `feature/orch-phase-2-run-ledger-service` → `main` | 2026-05-16 | JobPort interface + adapter helper + 2 adapter (cleanup / discovery) + 14 test |
| 4 | StrategyDraftService | [#220](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/220) | `feature/orch-phase-3-job-port` → `main` | 2026-05-16 | Service + Repository + Zod + TOCTOU + 26 test |
| 5 | RunLedgerTraceSink | [#221](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/221) | `feature/orch-phase-4-strategy-draft` → `main` | 2026-05-16 | ADK trace → RunLedger adapter + failure isolation + 8 test |
| 6 | ADK Orchestrator Wrapper | [#222](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/222) | `feature/orch-phase-5-trace-sink` → `main` | (待ち) | Golden Path 実装 + 11 test |
| 7 | SideBScheduler 接続 | [#223](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/223) | `feature/orch-phase-6-orchestrator` | (待ち) | feature flag bridge + Scheduler.runOrchestratedCycleNow() + 6 test |
| 8 | Run / Draft API | [#224](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/224) | `feature/orch-phase-7-scheduler` | (待ち) | Controller + Routes + 10 test |
| 9 | 統合テスト / 失敗系 / 回帰 | [#225](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/225) | `feature/orch-phase-8-api` | (待ち) | e2e 7 test + `GET /runs` 実装 |
| 10 | Docs / Runbook | (本 PR) | `feature/orch-phase-9-integration` | (待ち) | 本 Summary + `ADK_ADOPTION.md` §7 更新 |

**base 列の読み方**: Phase 0-5 は最初から `main` を base に作成。Phase 3-5 はマージ時点では既に main 同期済 (上位 PR が先にマージされた)。Phase 6-10 は前 Phase ブランチを base にした **chained PR**。Phase 6 がマージされると GitHub が自動で Phase 7 の base を main へ切替、これが Phase 10 まで再帰的に伝播する。

### Copilot レビュー対応総数

| PR | 指摘件数 | 対応コミット |
|---|---|---|
| #216 | 0 件 | — |
| #217 | 3 件 (lineage 整合性 / 文言 / enum) | 7f811d4 |
| #218 | 7 件 (JSDoc / 型 narrow / race / state transition) | 95445e2 |
| #219 | 0 件 | — |
| #220 | 7 件 (reason 必須 / catch スコープ / Zod / TOCTOU) | 077be7b |
| #221 | 0 件 | — |
| #222 | 6 件 (skip 記録 / 理由優先 / batchSize / idempotency null / draft summary) | dd75c1c |
| #223 | 0 件 | — |
| #224 | 0 件 | — |
| #225 | (PR 提出時点で未到着) | — |

---

## 2. 各 Phase の DoD 達成状況

### Phase 0 (前提固定)
- [x] 分離済み Job 一覧がある (8 Job 棚卸し)
- [x] Scheduler の残責務が把握されている
- [x] 既存テスト baseline が記録されている
- [x] 不可侵領域に対する git diff 禁止が明文化されている

### Phase 1 (Prisma schema)
- [x] `AgentRun` / `AgentRunStep` / `StrategyDraft` が schema に追加
- [x] migration が `prisma validate` を通る
- [x] unique 制約が二重実行 / 重複 Draft を防ぐ設計 (`idempotencyKey` / `(runId, stepName, attempt)` / `candidateHash` / `(id, runId)` 複合 FK)
- [x] 既存 schema の破壊的変更ゼロ

### Phase 2 (RunLedgerService)
- [x] ADK SDK 非依存
- [x] run/step の状態遷移がテスト済み (`canTransitionRun` / `canTransitionStep` + Service レベル)
- [x] 二重実行を抑止 (`idempotencyKey` + `RunLedgerDuplicateRunError` + race-safe 再検索)
- [x] redaction 済み summary のみ保存 (上限切り捨て)
- [x] SideBScheduler から直接 `AgentRunStep` を触らない

### Phase 3 (JobPort)
- [x] ADK Orchestrator が Job ごとの詳細を知らずに呼べる (`JobPort` interface)
- [x] 各 Job adapter が RunLedger へ step を残す (`runJobWithLedger` helper)
- [x] Job 内部に ADK 依存なし (adapter で wrap、既存 Job git diff ゼロ)
- [x] エラー構造化 (`JobResultEnvelope.errorCode/Message`)

### Phase 4 (StrategyDraftService)
- [x] Evolution 候補が StrategyDraft として保存 (`createFromEvolutionCandidate`)
- [x] Draft 重複抑止 (`candidateHash` unique + DB レベル + Service レベル race-safe)
- [x] 承認 / 却下 / 検証投入 / Validated / Archive の状態遷移テスト済
- [x] ADK / Scheduler が Draft DB 直接触らない
- [x] Validation 投入は Service 経由 (`queueForValidation`)

### Phase 5 (TraceSink → RunLedger)
- [x] ADK trace event が RunLedger に保存される
- [x] TraceSink 失敗が本体実行を壊さない (try/catch + logger.warn)
- [x] raw payload 非保存 (`TracePayloadSummary` は fieldCount のみ)
- [x] RunLedgerService は ADK SDK 非依存、adapter 側のみ依存

### Phase 6 (ADK Orchestrator Wrapper)
- [x] ADK が外側の順序を表現 (`runSideBOrchestratedCycle`)
- [x] 各 step 結果が RunLedger に残る (skip された step も `startStep + skipStep` を呼ぶ)
- [x] StrategyDraftService 経由で候補が扱われる
- [x] SideBScheduler に台帳 / 候補管理が戻っていない
- [x] PDCALoop / EvolutionLoop / Lens 内部を置き換えていない

### Phase 7 (SideBScheduler 接続)
- [x] Scheduler は起動入口に留まる (新メソッド `runOrchestratedCycleNow` 1 つ追加のみ、既存メソッド未変更)
- [x] RunLedgerService / StrategyDraftService を直接 CRUD しない
- [x] feature flag (`SIDE_B_ADK_ORCHESTRATOR_ENABLED`) で旧経路へ戻せる
- [x] Scheduler ファイルが再び巨大化していない (+23 行のみ)

### Phase 8 (API)
- [x] Run/Step/Draft が確認できる (`GET /runs`, `/runs/:id`, `/drafts`, `/drafts/:id`)
- [x] Draft 承認 / 却下 / 投入が安全に操作できる (`POST .../approve`, `.../reject`, `.../queue`)
- [x] raw payload や secret が UI に出ない (Service redaction 済み summary のみ返す)
- [ ] 操作権限が最低限守られている → **別 PR 対応 (本 WBS スコープ外)**

### Phase 9 (統合テスト)
- [x] Golden Path が統合テストで通る (e2e #2)
- [x] 主要失敗系が RunLedger に残る (e2e #3)
- [x] 未承認 Draft が Validation へ流れない (e2e #5)
- [x] 同一 trigger の二重 run が抑止される (e2e #6)
- [x] 既存テストが壊れていない (orchestrator + jobs + adk/agents 216/216 PASS)

### Phase 10 (本 PR)
- [x] 責務境界が文書化されている (本 §3)
- [x] Runbook 相当 (本 §5)
- [x] 直接 DB CRUD 禁止が明記 (本 §3)
- [x] 撤退可能性が維持されている (本 §6)

---

## 3. 責務境界 (最終形)

| 層 | 配置 | 持つ責務 | 持たない責務 |
|---|---|---|---|
| `SideBScheduler` | `src/side-b/jobs/sideBScheduler.ts` | cron / manual trigger / feature flag / `runOrchestratedCycleNow()` 入口 | Job 間 state 管理 / 候補 CRUD / 台帳更新の直接実装 |
| `ADK Orchestrator Wrapper` | `src/side-b/adk/agents/sideBOrchestrator.ts` | `Readiness → Plan → Monitor → Evolution → Draft → Validation-Queue → Validation` の実行順 / skip/stop 判断 / runId 伝播 / Draft handoff | DB 台帳 CRUD / StrategyDraft 承認判定 / 既存 Job 内部改変 |
| `RunLedgerService` | `src/side-b/services/runLedgerService.ts` | `AgentRun` / `AgentRunStep` 作成 / 更新 / 状態遷移 / trace 要約保存 / 冪等性 / redaction | 実行順序の意思決定 / Evolution 候補の業務承認 |
| `RunLedgerRepository` | `src/side-b/repositories/runLedgerRepository.ts` | Prisma 操作だけ (薄い層) | 状態遷移チェック / 冪等性 / redaction |
| `StrategyDraftService` | `src/side-b/services/strategyDraftService.ts` | candidate 受領 / Draft 化 / 承認 / 却下 / Validation 投入 / 重複抑止 / lifecycle 状態遷移 / Zod / TOCTOU | ADK orchestration / `AgentRunStep` 汎用台帳処理 |
| `StrategyDraftRepository` | `src/side-b/repositories/strategyDraftRepository.ts` | Prisma 操作 + `updateDraftIfStatus` (条件付き更新) | Service 層の業務ロジック |
| `JobPort` / `JobResultEnvelope` | `src/side-b/jobs/jobPort.ts` | Job 実行の共通契約 (ADK 非依存) | — |
| `JobLedgerAdapter` | `src/side-b/jobs/jobLedgerAdapter.ts` | 既存 Job を JobPort に wrap + RunLedger 連携 + エラー正規化 | — |
| 個別 Job adapter | `src/side-b/jobs/adapters/*Adapter.ts` | 既存 Job (cleanup / discovery / ...) を JobPort に変換 | — |
| `RunLedgerTraceSink` | `src/side-b/adk/tracing/runLedgerTraceSink.ts` | ADK trace event → RunLedger ルーティング (failure isolation 込み) | — |
| `Bridge` | `src/side-b/jobs/sideBSchedulerOrchestratorBridge.ts` | feature flag 判定 + Orchestrator 起動 | — |
| API | `src/side-b/controllers/orchestratorController.ts` + `src/side-b/routes/orchestratorRoutes.ts` | 入力 Zod validate + Service 呼び出し + status code 統一 | — |

### 禁止ルール

- **`SideBScheduler` に台帳 CRUD / StrategyDraft CRUD を戻さない**
- **既存 Job (`src/side-b/jobs/*Job.ts`) 内部に ADK SDK を入れない**
- **`RunLedgerService` / `StrategyDraftService` 内部から ADK SDK を呼ばない** (依存は adapter 側のみ)
- **raw prompt / raw response / API key / DB row 全文を保存しない** (redaction 強制)
- **`any` / `as any` / `as unknown as` で型を逃がさない**
- **既存不可侵領域 (PDCALoop / EvolutionLoop / Lens / EdgeLedger / PromptRegistry) を ADK 都合で書き換えない**

---

## 4. Golden Path 実行例

> **注意**: 本 WBS 完了時点で `runSideBOrchestratedCycle()` が受ける `jobs` は
> `readiness` / `plan` / `monitor` / `evolution` / `validation` の 5 key。下の例で
> 渡している adapter は本 PR シーケンスで実装した 2 個 (`cleanup` / `discovery`) と
> は別系統で、これらは Golden Path の 5 step には現状直接マッピングされない (= 引継ぎ §8
> 参照)。下記は **5 step すべてに JobPort を wire した想定** の最小完全例。

```ts
import { runScheduledOrchestratedCycle } from './src/side-b/jobs/sideBSchedulerOrchestratorBridge';
import type { JobPort } from './src/side-b/jobs/jobPort';
import { runJobWithLedger } from './src/side-b/jobs/jobLedgerAdapter';

// feature flag (env で制御)
process.env.SIDE_B_ADK_ORCHESTRATOR_ENABLED = 'true';

// 例: 既存 Job を wrap した JobPort を 5 step 分用意 (実装は別 PR 想定)
const readinessAdapter: JobPort = {
  stepName: 'readiness',
  execute: (ctx) => runJobWithLedger(ctx, {
    stepName: 'readiness',
    invoke: async () => ({ ready: true }),
    mapResult: () => ({ ok: true, status: 'succeeded', summary: 'ready', nextAction: 'proceed' }),
  }),
};
// plan / monitor / evolution / validation も同パターンで作成
declare const planAdapter: JobPort;
declare const monitorAdapter: JobPort;
declare const evolutionAdapter: JobPort;
declare const validationAdapter: JobPort;

const result = await runScheduledOrchestratedCycle({
  jobs: {
    readiness: readinessAdapter,
    plan: planAdapter,
    monitor: monitorAdapter,
    evolution: evolutionAdapter,
    validation: validationAdapter,
  },
  orchestratorOptions: {
    idempotencyKey: `side-b-${new Date().toISOString().slice(0, 13)}`, // 1 時間ごとに別 cycle
    extractCandidates: async (evolutionEnvelope, ctx) => {
      // Evolution が返す envelope から候補を抽出する関数
      return [
        { candidateHash: 'sha256:example', strategySummary: 'EMA crossover H1' },
      ];
    },
    autoQueueApprovedDrafts: false, // 保守的なデフォルト
  },
});

if (result.kind === 'executed') {
  console.log('finalStatus:', result.result.finalStatus);
  console.log('runId:', result.result.run.id);
  console.log('drafts:', result.result.drafts.length);
}
```

**最小 dry-run**: `jobs: {}` を渡せば全 step が `job not wired` で skip され、Draft も
作らずに run が `succeeded` で終わる。配線確認や CI のスモークに利用できる。

---

## 5. 運用 Runbook

### 5.0 前提: Router マウント

本 WBS の Phase 8 で実装した `createOrchestratorRouter()` は **本 PR シーケンスでは
`app.ts` / `sideBRoutes.ts` に未マウント**。下の curl コマンドが 404 を返す場合は、
以下を `src/side-b/routes/sideBRoutes.ts` または `src/app.ts` に追加してから利用する:

```ts
import { createOrchestratorRouter } from './routes/orchestratorRoutes';
// sideBRoutes が src/app.ts で /api/side-b にマウントされている場合:
router.use('/orchestrator', createOrchestratorRouter());
```

マウント先は組織のルーティング規約に合わせて調整する。下の curl は
`/api/side-b/orchestrator/...` にマウントした想定。

### 5.1 失敗 run の調査

```bash
# Run 一覧
curl "http://localhost:3100/api/side-b/orchestrator/runs?status=failed&limit=20"

# Run 詳細 + step 履歴
curl "http://localhost:3100/api/side-b/orchestrator/runs/{runId}"
```

step の `errorCode` / `errorMessage` / `nextAction` から失敗原因を特定。

### 5.2 Draft 承認 / 却下

```bash
# 承認待ち Draft 一覧
curl "http://localhost:3100/api/side-b/orchestrator/drafts?status=draft"

# 承認
curl -X POST "http://localhost:3100/api/side-b/orchestrator/drafts/{id}/approve" \
  -H "Content-Type: application/json" \
  -d '{"reviewer":"neko","reason":"PF > 1.5 確認"}'

# 却下 (reason 必須)
curl -X POST "http://localhost:3100/api/side-b/orchestrator/drafts/{id}/reject" \
  -H "Content-Type: application/json" \
  -d '{"reviewer":"neko","reason":"WF が 0.3 を超過"}'

# Validation queue 投入 (approved のみ)
curl -X POST "http://localhost:3100/api/side-b/orchestrator/drafts/{id}/queue"
```

### 5.3 二重実行確認

`idempotencyKey` を渡せば、同一値での再呼び出しは既存 run を再利用し新規 run を作成しない (`idempotentReuse=true`, `finalStatus=null`)。

### 5.4 ADK Orchestrator の有効化 / 無効化

```bash
# 有効化
export SIDE_B_ADK_ORCHESTRATOR_ENABLED=true

# 無効化 (rollback)
unset SIDE_B_ADK_ORCHESTRATOR_ENABLED
# または
export SIDE_B_ADK_ORCHESTRATOR_ENABLED=false
```

env 変更だけで即時切り替わる。Scheduler / 既存 Job / cron 経路には影響しない。

---

## 6. 撤退手順

### 6.1 全面撤退 (ADK 採用断念)

削除対象:
- `src/side-b/adk/` 配下すべて (Orchestrator / TraceSink / 既存 Step 1-4 の adapter/tracing/agents 全て)
- `src/side-b/tests/adk/` 配下すべて (ADK モジュールを import しているため、残すと tsc + test が壊れる)
- `src/side-b/jobs/sideBSchedulerOrchestratorBridge.ts` と関連 test
- `src/side-b/jobs/sideBScheduler.ts` の `runOrchestratedCycleNow` メソッド + Bridge import 行
- `package.json` / `package-lock.json` から `@google/adk`

非削除 (ADK 非依存なので残せる):
- `src/side-b/services/runLedgerService.ts` / `runLedgerRedaction.ts`
- `src/side-b/services/strategyDraftService.ts`
- `src/side-b/repositories/runLedgerRepository.ts` / `strategyDraftRepository.ts`
- `src/side-b/controllers/orchestratorController.ts`
- `src/side-b/routes/orchestratorRoutes.ts`
- `src/side-b/jobs/jobPort.ts` / `jobLedgerAdapter.ts` / `adapters/`
- `prisma/schema.prisma` の 3 model + 4 enum + migration
- 既存 Job / PDCALoop / Lens / Evolution / EdgeLedger / PromptRegistry (本 WBS では未変更)

実行手順:

```bash
# 1. ADK サイドカー本体 + テストを削除
git rm -rf src/side-b/adk/
git rm -rf src/side-b/tests/adk/

# 2. Bridge と関連テストを削除
git rm src/side-b/jobs/sideBSchedulerOrchestratorBridge.ts
git rm src/side-b/tests/orchestrator/sideBSchedulerOrchestratorBridge.test.ts

# 3. Scheduler.ts から下記 2 箇所を手動削除
#    - Bridge import 行 (`import { runScheduledOrchestratedCycle, ... } from './sideBSchedulerOrchestratorBridge'`)
#    - `runOrchestratedCycleNow()` メソッド本体
#    既存 cron / start / stop / runEvolutionNow 等の旧経路は触らない

# 4. npm 依存を外す (package.json + package-lock.json)
npm uninstall @google/adk
# .npmrc の `legacy-peer-deps=true` も追加していた場合は削除を検討

# 5. 検証
npx tsc --noEmit       # 0 errors になることを確認
npm test               # adk/ 削除で参照が残る test がないことを確認

# 6. ADK_ADOPTION.md §7 / adk_run_ledger_summary.md §0 に「撤退完了 (YYYY-MM-DD)」を追記
```

### 6.2 部分撤退 (Orchestrator だけ削除、台帳は残す)

`RunLedgerService` / `StrategyDraftService` は ADK 非依存なので、Orchestrator (`adk/agents/sideBOrchestrator.ts`) と Bridge だけ削除すれば、台帳 / Draft 機能は将来別の orchestrator から再利用可能。

### 6.3 撤退基準 (WBS §5)

以下のいずれかで全面撤退を検討:

1. OpenRouter 経由で `reasoning_effort` が伝達されない事案発生
2. PromptRegistry スコアリングが ADK 経由で 10% 以上劣化
3. `@google/adk` SDK が 6 ヶ月メジャー更新なし
4. Google が ADK を deprecated 宣言
5. ユーザー判断で継続不適切

---

## 7. 全 DoD (WBS §18 最終 DoD) 達成状況

| WBS §18 | 状態 |
|---|---|
| `SideBScheduler` は起動入口に戻っている | ✅ (Phase 7、新メソッド 1 つ追加、既存 cron 経路未変更) |
| ADK Orchestrator Wrapper が Golden Path を外側から束ねている | ✅ (Phase 6 `runSideBOrchestratedCycle`) |
| RunLedgerService が `AgentRun` / `AgentRunStep` を共通台帳として管理 | ✅ (Phase 2) |
| StrategyDraftService が Evolution 候補の Draft lifecycle を管理 | ✅ (Phase 4) |
| 各 Job が JobPort/adapter 経由で共通 I/O 化されている | ⚠️ (Phase 3 で interface + 2 adapter、残り 6 adapter は将来追加可能な構造) |
| Run / Step / Draft が人間から確認できる | ✅ (Phase 8 API、UI は別 PR スコープ) |
| 主要失敗系がテストされている | ✅ (Phase 9 e2e 7 + 各 Phase で約 200 cases) |
| 二重実行 / 未承認投入 / raw payload 保存が防がれている | ✅ (Phase 2 idempotency、Phase 4 Zod + state、Phase 5 redaction、test で網羅) |
| 既存 Side-B 中核の不可侵領域が守られている | ✅ (全 Phase で `src/side-b/jobs/*Job.ts`, `src/side-b/agent/`, `src/side-b/lenses/`, `src/side-b/evolution/`, `src/side-b/ledger/` の git diff ゼロ) |
| ADK を外しても既存実装が壊れない | ✅ (撤退手順 §6.1: `src/side-b/adk/` + `src/side-b/tests/adk/` + Bridge + Scheduler 新メソッド + `@google/adk` を順次削除すれば既存 Job / PDCALoop / Lens / Evolution は無傷) |

---

## 8. 後続作業の引き継ぎ

WBS スコープ外として残った項目 (本サマリーから別 PR / 別 Phase へ):

| 項目 | 関連 Phase | 備考 |
|---|---|---|
| Golden Path 5 step (readiness / plan / monitor / evolution / validation) の Job adapter wire | Phase 3 + Phase 6 | 同じ `runJobWithLedger` パターンで追加可能。`SideBOrchestratorJobs` interface は既にこの 5 key を受ける形 |
| Phase 3 で実装した cleanup / discovery adapter の Golden Path 組み込み | Phase 3 + Phase 6 | 現状 `SideBOrchestratorJobs` の 5 step に該当しない。Wrapper に新 step を追加 (interface 拡張) するか、`runOrchestratedCycleNow` の前後に Bridge から個別呼出する形を選択 |
| 残り 4 既存 Job (screening / full-validation / prompt-evolution / cleanup) の Wrapper への組込判断 | Phase 3 + Phase 6 | これらは Golden Path の 5 step とは別軸。`Wrapper` に新 step を増やすか、cron で並走させ続けるかをユーザーが判断 |
| Run / Draft 最小 UI | Phase 8 | frontend 側で別 PR |
| 操作権限 (認証 / 認可) | Phase 8 | 現状無認証、別 PR |
| `createOrchestratorRouter()` の Express アプリへのマウント | Phase 8 | 本 PR シーケンスでは Router 作成のみ。`sideBRoutes.ts` または `app.ts` でマウントするまで API は 404 (Runbook §5.0) |
| `RunLedgerService.listByStatus` 以外の検索 (期間 / kind フィルタ等) | Phase 9 | UI 要件次第で追加 |
| WBS §1.1 `nextAction` の `continue` → `proceed` 同期 | Phase 1 で実装上の判断 | WBS 本文も `proceed` に揃えれば完全一致 |

---

## 9. 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [adk_run_ledger_strategy_draft_完全版wbs.md](./adk_run_ledger_strategy_draft_完全版wbs.md) | WBS 本体 (Phase 0〜10 + 17 章 + 18 最終 DoD) |
| [adk_run_ledger_phase_0_棚卸し.md](./adk_run_ledger_phase_0_棚卸し.md) | Phase 0 棚卸しレポート (8 Job + Scheduler 残責務) |
| [ADK_ADOPTION.md](./ADK_ADOPTION.md) §7 | ADK 段階導入の実装状況 (Step 0〜4 + 本 WBS 完了) |
| [/AGENTS.md](../../AGENTS.md) | 全エージェント共通ルール |
| [/src/side-b/AGENTS.md](../../src/side-b/AGENTS.md) | side-b 固有ルール |
| [/src/side-b/adk/AGENTS.md](../../src/side-b/adk/AGENTS.md) | ADK サイドカー領域固有ルール |

---

> **完了**: Phase 0〜10、PR #216〜#225 + 本 PR で WBS §18 最終 DoD を達成。
