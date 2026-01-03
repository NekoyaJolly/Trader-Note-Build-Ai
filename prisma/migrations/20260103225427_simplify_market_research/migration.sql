/*
  Warnings:

  - You are about to drop the column `keyLevels` on the `MarketResearch` table. All the data in the column will be lost.
  - You are about to drop the column `rawIndicators` on the `MarketResearch` table. All the data in the column will be lost.
  - You are about to drop the column `regime` on the `MarketResearch` table. All the data in the column will be lost.
  - You are about to drop the column `regimeConfidence` on the `MarketResearch` table. All the data in the column will be lost.
  - You are about to drop the column `summary` on the `MarketResearch` table. All the data in the column will be lost.
  - You are about to drop the column `trend` on the `MarketResearch` table. All the data in the column will be lost.
  - You are about to drop the column `volatility` on the `MarketResearch` table. All the data in the column will be lost.

*/

-- Step 1: Add new column
ALTER TABLE "MarketResearch" ADD COLUMN "ohlcvSnapshot" JSONB;

-- Step 2: Migrate data from rawIndicators to ohlcvSnapshot
UPDATE "MarketResearch" SET "ohlcvSnapshot" = "rawIndicators" WHERE "rawIndicators" IS NOT NULL;

-- Step 3: Drop old columns
ALTER TABLE "MarketResearch" 
DROP COLUMN "keyLevels",
DROP COLUMN "rawIndicators",
DROP COLUMN "regime",
DROP COLUMN "regimeConfidence",
DROP COLUMN "summary",
DROP COLUMN "trend",
DROP COLUMN "volatility";
