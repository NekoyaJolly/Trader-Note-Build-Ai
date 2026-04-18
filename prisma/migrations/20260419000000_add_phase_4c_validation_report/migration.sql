-- Phase 4c: EdgeHypothesis に本格検証レポート用フィールドを追加
-- StrategistAgent / BacktesterAgent が埋める。全て NULL 許容で後方互換維持。

ALTER TABLE "EdgeHypothesis"
ADD COLUMN "fullValidationReport" JSONB,
ADD COLUMN "confirmationInterpretation" TEXT,
ADD COLUMN "rejectionInterpretation" TEXT,
ADD COLUMN "actionableInsights" TEXT[] DEFAULT ARRAY[]::TEXT[];
