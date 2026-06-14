-- ============================================================
-- Phase 6: Side-A コアテーブルの userId 必須化
--
-- 対象:
-- - Trade / TradeNote / MatchResult / Notification / Strategy / Note
--
-- 方針:
-- - 由来エンティティから userId を復元できるものは先に復元する
-- - それでも NULL の既存行は、過去 migration と同じく最古ユーザーに帰属させる
-- - まだ NULL が残る場合は NOT NULL 化前に fail-fast する
-- - User 削除時は履歴データを暗黙削除しないため ON DELETE RESTRICT とする
-- ============================================================

-- Trade は対応する TradeNote があればその所有者を優先し、なければ最古ユーザーへ帰属させる。
UPDATE "Trade" AS t
SET "userId" = COALESCE(
  (
    SELECT tn."userId"
    FROM "TradeNote" AS tn
    WHERE tn."tradeId" = t."id"
      AND tn."userId" IS NOT NULL
    LIMIT 1
  ),
  (SELECT u."id" FROM "User" AS u ORDER BY u."createdAt" ASC LIMIT 1)
)
WHERE t."userId" IS NULL;

-- TradeNote は対応する Trade の所有者を優先し、なければ最古ユーザーへ帰属させる。
UPDATE "TradeNote" AS tn
SET "userId" = COALESCE(
  (
    SELECT t."userId"
    FROM "Trade" AS t
    WHERE t."id" = tn."tradeId"
      AND t."userId" IS NOT NULL
    LIMIT 1
  ),
  (SELECT u."id" FROM "User" AS u ORDER BY u."createdAt" ASC LIMIT 1)
)
WHERE tn."userId" IS NULL;

-- MatchResult は由来 TradeNote の所有者を正とする。
UPDATE "MatchResult" AS mr
SET "userId" = COALESCE(
  (
    SELECT tn."userId"
    FROM "TradeNote" AS tn
    WHERE tn."id" = mr."noteId"
      AND tn."userId" IS NOT NULL
    LIMIT 1
  ),
  (SELECT u."id" FROM "User" AS u ORDER BY u."createdAt" ASC LIMIT 1)
)
WHERE mr."userId" IS NULL;

-- Notification は MatchResult 由来ならその所有者を継承し、strategy_alert 等は最古ユーザーへ帰属させる。
UPDATE "Notification" AS n
SET "userId" = COALESCE(
  (
    SELECT mr."userId"
    FROM "MatchResult" AS mr
    WHERE mr."id" = n."matchResultId"
      AND mr."userId" IS NOT NULL
    LIMIT 1
  ),
  (SELECT u."id" FROM "User" AS u ORDER BY u."createdAt" ASC LIMIT 1)
)
WHERE n."userId" IS NULL;

-- Strategy は既存 migration と同じく最古ユーザーへ帰属させる。
UPDATE "Strategy" AS s
SET "userId" = (SELECT u."id" FROM "User" AS u ORDER BY u."createdAt" ASC LIMIT 1)
WHERE s."userId" IS NULL;

-- Note は Side-A ブリッジがあれば TradeNote の所有者を優先し、それ以外は最古ユーザーへ帰属させる。
UPDATE "Note" AS n
SET "userId" = COALESCE(
  (
    SELECT tn."userId"
    FROM "TradeNote" AS tn
    WHERE tn."id" = n."tradeNoteId"
      AND tn."userId" IS NOT NULL
    LIMIT 1
  ),
  (SELECT u."id" FROM "User" AS u ORDER BY u."createdAt" ASC LIMIT 1)
)
WHERE n."userId" IS NULL;

-- 既存行があるのに User が存在しない等、補完不能な状態はここで止める。
DO $$
DECLARE
  null_summary JSONB;
BEGIN
  SELECT jsonb_build_object(
    'Trade', (SELECT COUNT(*) FROM "Trade" WHERE "userId" IS NULL),
    'TradeNote', (SELECT COUNT(*) FROM "TradeNote" WHERE "userId" IS NULL),
    'MatchResult', (SELECT COUNT(*) FROM "MatchResult" WHERE "userId" IS NULL),
    'Notification', (SELECT COUNT(*) FROM "Notification" WHERE "userId" IS NULL),
    'Strategy', (SELECT COUNT(*) FROM "Strategy" WHERE "userId" IS NULL),
    'Note', (SELECT COUNT(*) FROM "Note" WHERE "userId" IS NULL)
  )
  INTO null_summary;

  IF EXISTS (SELECT 1 FROM "Trade" WHERE "userId" IS NULL)
    OR EXISTS (SELECT 1 FROM "TradeNote" WHERE "userId" IS NULL)
    OR EXISTS (SELECT 1 FROM "MatchResult" WHERE "userId" IS NULL)
    OR EXISTS (SELECT 1 FROM "Notification" WHERE "userId" IS NULL)
    OR EXISTS (SELECT 1 FROM "Strategy" WHERE "userId" IS NULL)
    OR EXISTS (SELECT 1 FROM "Note" WHERE "userId" IS NULL) THEN
    RAISE EXCEPTION 'Phase 6 userId backfill failed. Remaining NULL counts: %', null_summary;
  END IF;
END $$;

-- Note は既存 FK が ON DELETE SET NULL のため、必須化前に張り替える。
ALTER TABLE "Note" DROP CONSTRAINT IF EXISTS "Note_userId_fkey";

ALTER TABLE "Trade" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "TradeNote" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "MatchResult" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Notification" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Strategy" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Note" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "Trade" ADD CONSTRAINT "Trade_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TradeNote" ADD CONSTRAINT "TradeNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
