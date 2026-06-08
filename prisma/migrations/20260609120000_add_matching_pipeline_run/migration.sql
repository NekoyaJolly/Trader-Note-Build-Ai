-- マッチングパイプライン実行単位の記録 (P1: observability)
-- MatchingService.runMatchingPipeline() の 1 実行 = 1 行。
-- cron 実行ごとに開始/終了/件数/スキップ理由を runId 単位で追跡する。
-- 既存テーブルへの変更は無く、新規テーブル + enum の追加のみ (非破壊的)。

-- CreateEnum: MatchingPipelineRun の状態
CREATE TYPE "MatchingPipelineRunStatus" AS ENUM ('success', 'skipped', 'partial_failure', 'failed');

-- CreateTable: MatchingPipelineRun (cron 実行ラン単位の集計)
CREATE TABLE "MatchingPipelineRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trigger" TEXT NOT NULL DEFAULT 'unknown',
    "status" "MatchingPipelineRunStatus" NOT NULL DEFAULT 'success',
    "startedAt" TIMESTAMPTZ(6) NOT NULL,
    "finishedAt" TIMESTAMPTZ(6) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "totalMatches" INTEGER NOT NULL DEFAULT 0,
    "notified" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT[],
    "skipReasons" JSONB,
    "marketStatus" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchingPipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 新しい順に最新 run を引く
CREATE INDEX "idx_pipeline_run_started" ON "MatchingPipelineRun"("startedAt" DESC);

-- CreateIndex: ステータス別の新しい順
CREATE INDEX "idx_pipeline_run_status_started" ON "MatchingPipelineRun"("status", "startedAt" DESC);

-- Enable RLS
-- Supabase の anon / authenticated が PostgREST 経由で触れないようにする (デフォルト拒否)。
-- Prisma は service_role で接続するため RLS をバイパスし、既存動作は維持される。
ALTER TABLE "MatchingPipelineRun" ENABLE ROW LEVEL SECURITY;
