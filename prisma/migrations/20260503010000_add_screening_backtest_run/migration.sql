-- CreateTable
-- Critical-4 段階 1: 仮説スクリーニング BT 実行履歴
-- analysis-engine 経由で実行された BT 結果を保存する。
CREATE TABLE "ScreeningBacktestRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hypothesisId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(6) NOT NULL,
    "periodEnd" TIMESTAMPTZ(6) NOT NULL,
    "notePayload" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "trades" JSONB NOT NULL,
    "equity" JSONB,
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningBacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_screening_bt_hyp_created" ON "ScreeningBacktestRun"("hypothesisId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "idx_screening_bt_symbol_tf" ON "ScreeningBacktestRun"("symbol", "timeframe");
