-- AlterTable: MTF 文脈 (執行足 + 見た上位足) を plan→trade→note の記録経路に一級フィールドとして追加。
-- timeframe = current/執行足、higherTimeframe = deriveHigherTimeframe(timeframe) で算出した上位足。
-- いずれも nullable のため既存行は NULL となり後方互換 (backfill は別途)。
-- 背景: timeframe が記録経路で追跡されておらず、DiscoveryAgent 組成 (D-4) が時間足を
-- 決定論クランプできない問題の基盤修正。エージェント間ハンドオフは MTF 文脈を必須で運ぶ方針。
ALTER TABLE "AITradePlan" ADD COLUMN "timeframe" TEXT;
ALTER TABLE "AITradePlan" ADD COLUMN "higherTimeframe" TEXT;

ALTER TABLE "VirtualTrade" ADD COLUMN "timeframe" TEXT;
ALTER TABLE "VirtualTrade" ADD COLUMN "higherTimeframe" TEXT;

ALTER TABLE "AITradeNote" ADD COLUMN "timeframe" TEXT;
ALTER TABLE "AITradeNote" ADD COLUMN "higherTimeframe" TEXT;
