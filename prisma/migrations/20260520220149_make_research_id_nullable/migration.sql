-- Phase A: AITradePlan.researchId を nullable に変更 (MarketResearch Deprecated 残置)
-- Phase A 以降の新規 plan は researchId=null + researchOutputId=<uuid> で作成される。
-- 旧 164 件の plan は researchId をそのまま保持 (読み取り専用、削除は Phase D 相当)。
--
-- FK 制約も SET NULL 動作に変更 (MarketResearch の物理削除に追従可能にする)。

-- DropForeignKey (既存制約を削除)
ALTER TABLE "AITradePlan" DROP CONSTRAINT "AITradePlan_researchId_fkey";

-- AlterColumn (NOT NULL を外す)
ALTER TABLE "AITradePlan" ALTER COLUMN "researchId" DROP NOT NULL;

-- AddForeignKey (ON DELETE SET NULL に変更)
ALTER TABLE "AITradePlan" ADD CONSTRAINT "AITradePlan_researchId_fkey"
  FOREIGN KEY ("researchId") REFERENCES "MarketResearch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
