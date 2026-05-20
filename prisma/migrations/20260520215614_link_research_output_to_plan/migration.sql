-- AITradePlan に ResearchOutput への optional リレーションを追加 (Phase A A-NEW4)
-- 旧 researchId (MarketResearch FK) は Deprecated 残置、新規データは researchOutputId を使用

-- AlterTable
ALTER TABLE "AITradePlan" ADD COLUMN "researchOutputId" UUID;

-- CreateIndex
CREATE INDEX "idx_ai_trade_plan_research_output" ON "AITradePlan"("researchOutputId");

-- AddForeignKey
ALTER TABLE "AITradePlan" ADD CONSTRAINT "AITradePlan_researchOutputId_fkey" FOREIGN KEY ("researchOutputId") REFERENCES "ResearchOutput"("id") ON DELETE SET NULL ON UPDATE CASCADE;
