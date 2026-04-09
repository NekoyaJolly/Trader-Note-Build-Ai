-- チャート描画データ同期テーブル
CREATE TABLE IF NOT EXISTS "ChartDrawing" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "symbol" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "lines" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "ChartDrawing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_chart_drawing_user_symbol_timeframe"
  ON "ChartDrawing" ("userId", "symbol", "timeframe");

CREATE INDEX IF NOT EXISTS "idx_chart_drawing_user_updated"
  ON "ChartDrawing" ("userId", "updatedAt");
