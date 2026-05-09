-- Filter Evolution Phase D-1a (2026-05-09):
-- 世代単位の reflection lessons を永続化するテーブル。
-- 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.1 / §5.D
--
-- GenerationReflectionAgent (= Phase D-1b 実装予定) が出す verbal lesson を保存する。
-- 用途:
--   - 後続世代の mutation/crossover prompt に lesson を流す
--   - PDCA loop の thinking log に世代単位の振り返りを残す
--   - 観察フェーズで「学習が機能しているか」を定量確認 (= 設計書 §3.3 観測条件 4)
CREATE TABLE "GenerationLesson" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evolutionRunId" UUID NOT NULL,
    "regime" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "lesson" TEXT NOT NULL,
    "metrics" JSONB,
    "confidence" DOUBLE PRECISION,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationLesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_gen_lesson_run_regime_gen" ON "GenerationLesson"("evolutionRunId", "regime", "generation");

-- CreateIndex
CREATE INDEX "idx_gen_lesson_regime_recorded" ON "GenerationLesson"("regime", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_gen_lesson_category_recorded" ON "GenerationLesson"("category", "recordedAt" DESC);
