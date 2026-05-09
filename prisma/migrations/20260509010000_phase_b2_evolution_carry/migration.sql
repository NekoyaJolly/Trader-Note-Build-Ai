-- Filter Evolution Phase B-2 (2026-05-09):
-- 進化ループ世代間で引き継ぐ短命 state を永続化するテーブル。
-- 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.2
--
-- 用途:
--   - cron 起動を跨いだ in-memory cache (tradesByDslId / lastRepairHints /
--     lastRepairBaselines) の復元
--   - 新規 cron 起動時に regime 単位で最新 carry を 1 件読み出して初期値に使う
--
-- retention 14 日 (= Phase B-3 で cron job が古い行を条件付き DELETE する想定、
-- 具体的には `EvolutionInstanceCarryRepository.deleteOlderThan(14)` を呼ぶ)。
CREATE TABLE "EvolutionInstanceCarry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evolutionRunId" UUID NOT NULL,
    "regime" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvolutionInstanceCarry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_evolution_carry_run_regime_gen" ON "EvolutionInstanceCarry"("evolutionRunId", "regime", "generation");

-- CreateIndex
CREATE INDEX "idx_evolution_carry_regime_recorded" ON "EvolutionInstanceCarry"("regime", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "idx_evolution_carry_recorded" ON "EvolutionInstanceCarry"("recordedAt" DESC);
