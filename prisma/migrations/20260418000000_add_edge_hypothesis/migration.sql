-- Phase 4a: エッジ仮説台帳
-- EdgeHypothesis テーブルを新規作成
-- AITradeNote に relatedHypothesisIds カラムを追加

-- ============================================================
-- EdgeHypothesis テーブル
-- ============================================================
CREATE TABLE "EdgeHypothesis" (
    "id" UUID NOT NULL,

    -- 記述
    "statement" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "expectedDirection" TEXT NOT NULL,

    -- ライフサイクル
    "status" TEXT NOT NULL DEFAULT 'unverified',
    "statusUpdatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusNote" TEXT,

    -- 対象
    "symbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timeframes" TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- 実績
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "winCount" INTEGER NOT NULL DEFAULT 0,
    "lossCount" INTEGER NOT NULL DEFAULT 0,
    "breakevenCount" INTEGER NOT NULL DEFAULT 0,
    "totalPnlPips" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "avgRR" DECIMAL(6, 3) NOT NULL DEFAULT 0,

    -- 検証履歴（Phase 4b で埋まる）
    "backtestResults" JSONB,
    "walkForwardResults" JSONB,

    -- メタデータ
    "source" TEXT NOT NULL,
    "lensRelevance" JSONB,

    -- タイムスタンプ
    "firstObservedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastTestedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    -- 関連
    "parentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relatedNoteIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "EdgeHypothesis_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_edge_hypothesis_status" ON "EdgeHypothesis"("status");
CREATE INDEX "idx_edge_hypothesis_category" ON "EdgeHypothesis"("category");
CREATE INDEX "idx_edge_hypothesis_source" ON "EdgeHypothesis"("source");
CREATE INDEX "idx_edge_hypothesis_created" ON "EdgeHypothesis"("createdAt" DESC);

-- ============================================================
-- AITradeNote.relatedHypothesisIds 追加
-- ============================================================
ALTER TABLE "AITradeNote"
ADD COLUMN "relatedHypothesisIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
