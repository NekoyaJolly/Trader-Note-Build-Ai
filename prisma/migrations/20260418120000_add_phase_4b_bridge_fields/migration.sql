-- Phase 4b: Side-A 検証基盤へのブリッジ層
-- AITradeNote.tradeNoteId と EdgeHypothesis のブリッジ用フィールドを追加

-- ============================================================
-- AITradeNote.tradeNoteId 追加（同時生成された Side-A TradeNote への参照）
-- ============================================================
ALTER TABLE "AITradeNote"
ADD COLUMN "tradeNoteId" UUID;

-- ============================================================
-- EdgeHypothesis: ブリッジ層用フィールド追加
-- ============================================================
ALTER TABLE "EdgeHypothesis"
ADD COLUMN "defaultRiskManagement" JSONB,
ADD COLUMN "materializedTradeNoteIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "invalidationConditions" JSONB,
ADD COLUMN "confirmationNote" TEXT;
