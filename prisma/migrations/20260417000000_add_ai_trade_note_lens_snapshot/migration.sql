-- Phase 1: 並列レンズ基盤
-- AITradeNote に lensSnapshot (JSONB, nullable) カラムを追加
-- 既存 114 件のトレードは NULL のまま互換性を維持する

ALTER TABLE "AITradeNote" ADD COLUMN "lensSnapshot" JSONB;
