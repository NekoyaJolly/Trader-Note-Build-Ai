-- Phase4: 通知ログテーブルを追加
-- 目的: 再通知防止（冪等性・クールダウン）と配信履歴の永続化

-- NotificationLogStatus 列挙型を追加
CREATE TYPE "NotificationLogStatus" AS ENUM ('sent', 'skipped', 'failed');

-- NotificationLog テーブルを作成
CREATE TABLE "NotificationLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "noteId" UUID NOT NULL,
    "marketSnapshotId" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "channel" TEXT NOT NULL,
    "status" "NotificationLogStatus" NOT NULL DEFAULT 'sent',
    "reasonSummary" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- 外部キー制約を追加
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "TradeNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_marketSnapshotId_fkey" FOREIGN KEY ("marketSnapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ユニーク制約を追加（冪等性保証）
CREATE UNIQUE INDEX "uq_notiflog_note_snapshot_channel" ON "NotificationLog"("noteId", "marketSnapshotId", "channel");

-- インデックスを追加
CREATE INDEX "idx_notiflog_symbol_sent" ON "NotificationLog"("symbol", "sentAt");
CREATE INDEX "idx_notiflog_note_sent" ON "NotificationLog"("noteId", "sentAt");
