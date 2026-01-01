-- CreateEnum
CREATE TYPE "NotificationSkipReason" AS ENUM ('max_simultaneous_exceeded', 'cooldown_active', 'note_disabled', 'note_paused', 'lower_priority');

-- AlterTable
ALTER TABLE "TradeNote" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pausedUntil" TIMESTAMPTZ(6),
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "NotificationBatchConfig" (
    "id" UUID NOT NULL,
    "maxSimultaneous" INTEGER NOT NULL DEFAULT 3,
    "groupBySymbol" BOOLEAN NOT NULL DEFAULT true,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "NotificationBatchConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSkipLog" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "matchResultId" UUID,
    "reason" "NotificationSkipReason" NOT NULL,
    "details" JSONB,
    "skippedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationSkipLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_notification_skip_note" ON "NotificationSkipLog"("noteId");

-- CreateIndex
CREATE INDEX "idx_notification_skip_at" ON "NotificationSkipLog"("skippedAt");

-- CreateIndex
CREATE INDEX "idx_notification_skip_reason" ON "NotificationSkipLog"("reason");

-- CreateIndex
CREATE INDEX "idx_tradenote_enabled_status" ON "TradeNote"("enabled", "status");

-- CreateIndex
CREATE INDEX "idx_tradenote_priority" ON "TradeNote"("priority");

-- AddForeignKey
ALTER TABLE "NotificationSkipLog" ADD CONSTRAINT "NotificationSkipLog_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "TradeNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSkipLog" ADD CONSTRAINT "NotificationSkipLog_matchResultId_fkey" FOREIGN KEY ("matchResultId") REFERENCES "MatchResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;
