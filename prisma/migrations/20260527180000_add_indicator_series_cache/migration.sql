-- CreateTable
CREATE TABLE "IndicatorSeriesCache" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "paramsHash" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "endDate" TIMESTAMPTZ(6) NOT NULL,
    "fetchedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "IndicatorSeriesCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_indicator_cache_lookup" ON "IndicatorSeriesCache"("symbol", "timeframe", "indicatorId", "paramsHash", "field", "fetchedAt" DESC);

-- Enable RLS (= Side-B プライベートテーブル、Supabase RLS 慣行に合わせる)
ALTER TABLE "IndicatorSeriesCache" ENABLE ROW LEVEL SECURITY;
