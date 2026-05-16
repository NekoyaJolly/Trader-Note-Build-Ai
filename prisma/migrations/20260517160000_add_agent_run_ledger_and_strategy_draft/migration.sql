-- ADK Orchestrator + RunLedger + StrategyDraft (Phase 1)
-- 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §6 (Phase 1)
--
-- AgentRun / AgentRunStep: Side-B 全実行経路 (Scheduler / ADK Wrapper / 手動) の
--   共通実行台帳。RunLedgerService (Phase 2) からのみ書き込まれる
-- StrategyDraft: Evolution 候補の Draft lifecycle。
--   StrategyDraftService (Phase 4) からのみ書き込まれる
-- 不可侵: SideBScheduler / 既存 Job 等からの直接 CRUD 禁止 (WBS §17)

-- CreateEnum: AgentRun の状態
CREATE TYPE "AgentRunStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled');

-- CreateEnum: AgentRunStep の状態
CREATE TYPE "AgentRunStepStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'skipped');

-- CreateEnum: AgentRunStep の次アクション
-- WBS §1.1 で "continue" と記述された値は TypeScript 予約語との衝突を避けるため "proceed" として実装する
CREATE TYPE "AgentRunStepNextAction" AS ENUM ('proceed', 'stop', 'skip', 'retry', 'manual_review');

-- CreateEnum: StrategyDraft の lifecycle 状態
CREATE TYPE "StrategyDraftStatus" AS ENUM ('draft', 'approved', 'rejected', 'queued_for_validation', 'validated', 'archived');

-- CreateTable: AgentRun (Side-B 実行ラン台帳)
CREATE TABLE "AgentRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),
    "summary" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 冪等性キーで二重実行を防ぐ
CREATE UNIQUE INDEX "uq_agent_run_idempotency_key" ON "AgentRun"("idempotencyKey");

-- CreateIndex: ステータス別の新しい順
CREATE INDEX "idx_agent_run_status_started" ON "AgentRun"("status", "startedAt" DESC);

-- CreateIndex: 種別 / 起動元で絞り込み
CREATE INDEX "idx_agent_run_kind_trigger" ON "AgentRun"("kind", "triggeredBy");

-- CreateTable: AgentRunStep (run 内の各 step)
CREATE TABLE "AgentRunStep" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "runId" UUID NOT NULL,
    "stepName" TEXT NOT NULL,
    "status" "AgentRunStepStatus" NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),
    "durationMs" INTEGER,
    "summary" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "nextAction" "AgentRunStepNextAction",
    "traceKind" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AgentRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 同一 run / step / attempt の二重作成を防ぐ
CREATE UNIQUE INDEX "uq_agent_run_step_attempt" ON "AgentRunStep"("runId", "stepName", "attempt");

-- CreateIndex: run 内の time series
CREATE INDEX "idx_agent_run_step_run_started" ON "AgentRunStep"("runId", "startedAt");

-- CreateIndex: ステータス別検索
CREATE INDEX "idx_agent_run_step_status" ON "AgentRunStep"("status");

-- AddForeignKey: step は run に紐付き、run 削除時に cascade
ALTER TABLE "AgentRunStep" ADD CONSTRAINT "AgentRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: StrategyDraft (Evolution 候補の Draft lifecycle)
CREATE TABLE "StrategyDraft" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sourceRunId" UUID NOT NULL,
    "sourceStepId" UUID NOT NULL,
    "candidateHash" TEXT NOT NULL,
    "status" "StrategyDraftStatus" NOT NULL DEFAULT 'draft',
    "strategySummary" TEXT NOT NULL,
    "riskSummary" TEXT,
    "approvalReason" TEXT,
    "rejectionReason" TEXT,
    "archiveReason" TEXT,
    "reviewer" TEXT,
    "validatedAt" TIMESTAMPTZ(6),
    "validationResultId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StrategyDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 同一候補の重複作成を防ぐ
CREATE UNIQUE INDEX "uq_strategy_draft_candidate_hash" ON "StrategyDraft"("candidateHash");

-- CreateIndex: ステータス別の新しい順
CREATE INDEX "idx_strategy_draft_status_created" ON "StrategyDraft"("status", "createdAt" DESC);

-- CreateIndex: source run 別検索
CREATE INDEX "idx_strategy_draft_source_run" ON "StrategyDraft"("sourceRunId");

-- AddForeignKey: source run への参照
ALTER TABLE "StrategyDraft" ADD CONSTRAINT "StrategyDraft_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: source step への参照
ALTER TABLE "StrategyDraft" ADD CONSTRAINT "StrategyDraft_sourceStepId_fkey" FOREIGN KEY ("sourceStepId") REFERENCES "AgentRunStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
