-- CreateTable
-- Critical-4 段階 4a.4: 進化ループ正式 BT 履歴
-- EvolutionLoop top K の analysis-engine 正式 BT 結果を保存する。
-- ScreeningBacktestRun (= EdgeHypothesis 由来) とは別テーブルで管理する。
CREATE TABLE "EvolutionBacktestRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evolutionRunId" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "candidateId" TEXT NOT NULL,
    "candidateHash" TEXT NOT NULL,
    "dslSnapshot" JSONB NOT NULL,
    "surrogateScore" DOUBLE PRECISION NOT NULL,
    "formalBtPassed" BOOLEAN NOT NULL,
    "formalBtMetrics" JSONB,
    "formalBtFailureReason" TEXT,
    "engine" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvolutionBacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_evolution_bt_run_gen" ON "EvolutionBacktestRun"("evolutionRunId", "generation");

-- CreateIndex
CREATE INDEX "idx_evolution_bt_hash_created" ON "EvolutionBacktestRun"("candidateHash", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_evolution_bt_passed_created" ON "EvolutionBacktestRun"("formalBtPassed", "createdAt" DESC);

-- RLS: Phase 6.5 ポリシー (anon/authenticated 拒否、service_role バイパス)
ALTER TABLE "EvolutionBacktestRun" ENABLE ROW LEVEL SECURITY;
