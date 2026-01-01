-- CreateTable
CREATE TABLE "EvaluationLog" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "marketSnapshotId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "level" TEXT NOT NULL,
    "triggered" BOOLEAN NOT NULL,
    "vectorDimension" INTEGER NOT NULL,
    "usedIndicators" TEXT[],
    "diagnostics" JSONB,
    "evaluatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_evallog_note_evaluated" ON "EvaluationLog"("noteId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "idx_evallog_symbol_evaluated" ON "EvaluationLog"("symbol", "evaluatedAt");

-- CreateIndex
CREATE INDEX "idx_evallog_triggered_evaluated" ON "EvaluationLog"("triggered", "evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_evallog_note_snapshot_timeframe" ON "EvaluationLog"("noteId", "marketSnapshotId", "timeframe");

-- AddForeignKey
ALTER TABLE "EvaluationLog" ADD CONSTRAINT "EvaluationLog_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "TradeNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationLog" ADD CONSTRAINT "EvaluationLog_marketSnapshotId_fkey" FOREIGN KEY ("marketSnapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
