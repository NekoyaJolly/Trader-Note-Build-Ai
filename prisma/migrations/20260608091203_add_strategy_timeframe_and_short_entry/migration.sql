-- ストラテジーに「時間足」を正式属性として追加し、Buy&Sell 用に「売り用エントリー条件」を追加する。
-- すべて追加のみ・nullable。既存行への破壊的変更なし（既存ストラテジーは timeframe=null のレガシー扱い）。

-- 対象時間足（API 文字列: 1m/5m/15m/30m/1h/4h/1d 等）
ALTER TABLE "Strategy" ADD COLUMN "timeframe" TEXT;
ALTER TABLE "StrategyVersion" ADD COLUMN "timeframe" TEXT;

-- 売り用エントリー条件（side=both のときのみ使用。買い=entryConditions と対）
ALTER TABLE "StrategyVersion" ADD COLUMN "shortEntryConditions" JSONB;

-- バックテストイベントの売買方向（both で買い/売りトレードを区別。既存行は null=レガシー）
ALTER TABLE "StrategyBacktestEvent" ADD COLUMN "side" TEXT;
