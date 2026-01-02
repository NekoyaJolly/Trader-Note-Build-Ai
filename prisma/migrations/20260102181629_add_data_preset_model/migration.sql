-- CreateTable
CREATE TABLE "DataPreset" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "endDate" TIMESTAMPTZ(6) NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "sourceFile" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "DataPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_datapreset_symbol_timeframe" ON "DataPreset"("symbol", "timeframe");

-- CreateIndex
CREATE UNIQUE INDEX "uq_datapreset_symbol_timeframe" ON "DataPreset"("symbol", "timeframe");
