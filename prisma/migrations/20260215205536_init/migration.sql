/*
  注意:

  本番DBには既存データがあるため、
  - DROP COLUMN → ADD COLUMN NOT NULL（デフォルトなし）
  は失敗します。

  このマイグレーションでは、既存の `Strategy.side`（TradeSide）を
  `StrategyDirection` へ安全に型変換します。
*/

-- CreateEnum（既に存在する場合はスキップ）
DO $$
BEGIN
  CREATE TYPE "StrategyDirection" AS ENUM ('buy', 'sell', 'both');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: TradeSide → StrategyDirection へ型変換（既存データを保持）
ALTER TABLE "Strategy"
  ALTER COLUMN "side" TYPE "StrategyDirection"
  USING ("side"::text::"StrategyDirection");

-- AlterTable: StrategyVersion に symbol/side を追加（既存行があるため NULL許容）
ALTER TABLE "StrategyVersion"
  ADD COLUMN IF NOT EXISTS "side" "StrategyDirection",
  ADD COLUMN IF NOT EXISTS "symbol" TEXT;

-- 既存バージョンへ Strategy の symbol/side をバックフィル
UPDATE "StrategyVersion" v
SET
  "symbol" = COALESCE(v."symbol", s."symbol"),
  "side" = COALESCE(v."side", s."side")
FROM "Strategy" s
WHERE v."strategyId" = s."id";
