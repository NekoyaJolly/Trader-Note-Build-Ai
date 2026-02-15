/*
  Warnings:

  - Changed the type of `side` on the `Strategy` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "StrategyDirection" AS ENUM ('buy', 'sell', 'both');

-- AlterTable
ALTER TABLE "Strategy" DROP COLUMN "side",
ADD COLUMN     "side" "StrategyDirection" NOT NULL;

-- AlterTable
ALTER TABLE "StrategyVersion" ADD COLUMN     "side" "StrategyDirection",
ADD COLUMN     "symbol" TEXT;
