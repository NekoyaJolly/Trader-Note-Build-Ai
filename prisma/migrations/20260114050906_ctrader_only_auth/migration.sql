-- cTrader統合認証への全面移行マイグレーション
-- 警告: このマイグレーションは既存のユーザーデータをクリアします

-- Step 1: 既存データのバックアップ（必要に応じて手動で実行）
-- CREATE TABLE "User_backup" AS SELECT * FROM "User";
-- CREATE TABLE "CTraderToken_backup" AS SELECT * FROM "CTraderToken";

-- Step 2: 外部キー制約のあるテーブルからユーザー参照を一時削除
-- Watchlist と PushSubscription は User に依存しているため、先にクリア
DELETE FROM "Watchlist";
DELETE FROM "PushSubscription";

-- Step 3: 既存のユーザーとトークンを削除
DELETE FROM "User";
DELETE FROM "CTraderToken";

-- Step 4: User テーブルのインデックスを削除
DROP INDEX IF EXISTS "idx_user_email";

-- Step 5: User テーブルから不要なカラムを削除
ALTER TABLE "User" DROP COLUMN IF EXISTS "email";
ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "User" DROP COLUMN IF EXISTS "refreshToken";

-- Step 6: User テーブルに新しいカラムを追加
ALTER TABLE "User" ADD COLUMN "primaryAccountId" TEXT NOT NULL DEFAULT 'temp';
ALTER TABLE "User" ADD COLUMN "email" TEXT;

-- Step 7: primaryAccountId を UNIQUE にする
ALTER TABLE "User" ADD CONSTRAINT "User_primaryAccountId_key" UNIQUE ("primaryAccountId");

-- Step 8: インデックスを追加
CREATE INDEX "idx_user_primary_account" ON "User"("primaryAccountId");

-- Step 9: CTraderToken テーブルに userId カラムを追加
ALTER TABLE "CTraderToken" ADD COLUMN "userId" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

-- Step 10: CTraderToken に外部キー制約を追加
ALTER TABLE "CTraderToken" 
  ADD CONSTRAINT "CTraderToken_userId_fkey" 
  FOREIGN KEY ("userId") 
  REFERENCES "User"("id") 
  ON DELETE CASCADE 
  ON UPDATE CASCADE;

-- Step 11: CTraderToken にインデックスを追加
CREATE INDEX "idx_ctradertoken_userid" ON "CTraderToken"("userId");

-- Step 12: デフォルト値を削除
ALTER TABLE "User" ALTER COLUMN "primaryAccountId" DROP DEFAULT;
ALTER TABLE "CTraderToken" ALTER COLUMN "userId" DROP DEFAULT;

-- マイグレーション完了
-- ユーザーは cTrader OAuth でのみログイン可能になります
