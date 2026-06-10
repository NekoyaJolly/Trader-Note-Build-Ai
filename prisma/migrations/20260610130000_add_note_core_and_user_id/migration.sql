-- CreateEnum
CREATE TYPE "NoteSource" AS ENUM ('side_a_human', 'side_b_ai');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "userId" UUID;

-- AlterTable
ALTER TABLE "TradeNote" ADD COLUMN     "userId" UUID;

-- AlterTable
ALTER TABLE "MatchResult" ADD COLUMN     "userId" UUID;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "userId" UUID;

-- AlterTable
ALTER TABLE "Strategy" ADD COLUMN     "userId" UUID;

-- CreateTable
CREATE TABLE "Note" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "source" "NoteSource" NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "timeframe" TEXT NOT NULL,
    "higherTimeframe" TEXT,
    "entryPrice" DECIMAL(18,8),
    "eventTime" TIMESTAMPTZ(6) NOT NULL,
    "lensSnapshot" JSONB,
    "snapshotSchemaVersion" TEXT,
    "tradeNoteId" UUID,
    "aiTradeNoteId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Note_tradeNoteId_key" ON "Note"("tradeNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Note_aiTradeNoteId_key" ON "Note"("aiTradeNoteId");

-- CreateIndex
CREATE INDEX "idx_note_user" ON "Note"("userId");

-- CreateIndex
CREATE INDEX "idx_note_symbol_source" ON "Note"("symbol", "source");

-- CreateIndex
CREATE INDEX "idx_note_event_time" ON "Note"("eventTime");

-- CreateIndex
CREATE INDEX "idx_trade_user" ON "Trade"("userId");

-- CreateIndex
CREATE INDEX "idx_tradenote_user" ON "TradeNote"("userId");

-- CreateIndex
CREATE INDEX "idx_match_user" ON "MatchResult"("userId");

-- CreateIndex
CREATE INDEX "idx_notification_user_status" ON "Notification"("userId", "status");

-- CreateIndex
CREATE INDEX "idx_strategy_user" ON "Strategy"("userId");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_tradeNoteId_fkey" FOREIGN KEY ("tradeNoteId") REFERENCES "TradeNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_aiTradeNoteId_fkey" FOREIGN KEY ("aiTradeNoteId") REFERENCES "AITradeNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================
-- 既存データのバックフィル（マルチユーザー化 Phase α、非破壊）
-- 本番はこれまで単一ユーザー運用のため、既存行は最古ユーザーに帰属させる。
-- User が 0 件の環境（新規環境）ではサブクエリが NULL を返し、何も変更されない。
-- ============================================================

UPDATE "Trade" SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" IS NULL;
UPDATE "TradeNote" SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" IS NULL;
UPDATE "MatchResult" SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" IS NULL;
UPDATE "Notification" SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" IS NULL;
UPDATE "Strategy" SET "userId" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) WHERE "userId" IS NULL;
