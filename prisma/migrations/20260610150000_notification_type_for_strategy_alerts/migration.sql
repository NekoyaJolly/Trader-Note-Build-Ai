-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_matchResultId_fkey";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'note_match',
ALTER COLUMN "matchResultId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "idx_notification_type_sent" ON "Notification"("type", "sentAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_matchResultId_fkey" FOREIGN KEY ("matchResultId") REFERENCES "MatchResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

