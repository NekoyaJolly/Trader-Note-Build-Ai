-- AlterTable: プラン生成時に LLM が生成する根拠 (BullBearDebate / IndicatorSpecialist) を永続化する (P0-a)。
-- 背景: 両者は generatePlan 内で LLM 実行 (トークン課金) されるが AITradePlan に保存列が無く、
--       生成直後の in-memory レスポンスにしか存在しなかった (= 後でプランを開くと根拠が消失)。
-- debate            = BullBearDebateOutput 全体 (bull/bear シナリオ・論拠・synthesis)。
-- indicatorAnalysis = IndicatorAnalysis 全体 (MTF テクニカル統合解釈)。
-- いずれも nullable のため既存行は NULL となり後方互換 (backfill はしない)。
ALTER TABLE "AITradePlan" ADD COLUMN "debate" JSONB;
ALTER TABLE "AITradePlan" ADD COLUMN "indicatorAnalysis" JSONB;
