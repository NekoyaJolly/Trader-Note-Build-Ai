/*
  Warnings:

  - Added the required column `updatedAt` to the `StrategyNote` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "StrategyNoteStatus" AS ENUM ('draft', 'active', 'archived');

-- AlterTable
ALTER TABLE "StrategyNote" ADD COLUMN     "featureVector" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
ADD COLUMN     "status" "StrategyNoteStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMPTZ(6) NOT NULL;

-- CreateIndex
CREATE INDEX "idx_strategynote_status" ON "StrategyNote"("status");

-- CreateIndex
CREATE INDEX "idx_strategynote_strategy_status" ON "StrategyNote"("strategyId", "status");
