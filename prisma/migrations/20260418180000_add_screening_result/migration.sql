-- Phase 4b 縮小版: EdgeHypothesis.screeningResult 追加
-- Side-A BacktestService による事前スクリーニング結果を記録するための JSON フィールド。
-- EdgeStatus は文字列ベース（String @default("unverified")）のため、
-- 新ステータス 'screening_passed' を追加するためのスキーマ変更は不要。

ALTER TABLE "EdgeHypothesis"
ADD COLUMN "screeningResult" JSONB;
