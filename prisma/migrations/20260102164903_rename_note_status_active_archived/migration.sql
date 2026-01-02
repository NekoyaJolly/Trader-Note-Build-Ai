/*
  NoteStatus マイグレーション: approved → active, rejected → archived
  
  変更内容:
  1. 既存データの status を approved → active, rejected → archived に変換
  2. enum NoteStatus の値を draft | active | archived に変更
  3. approvedAt → activatedAt, rejectedAt → archivedAt にカラム名変更
*/

-- Step 1: 新しい enum 型を作成
CREATE TYPE "NoteStatus_new" AS ENUM ('draft', 'active', 'archived');

-- Step 2: 既存データを変換しながら新しい enum 型に移行
ALTER TABLE "TradeNote" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TradeNote" ALTER COLUMN "status" TYPE "NoteStatus_new" 
  USING (
    CASE "status"::text
      WHEN 'approved' THEN 'active'::"NoteStatus_new"
      WHEN 'rejected' THEN 'archived'::"NoteStatus_new"
      ELSE "status"::text::"NoteStatus_new"
    END
  );

-- Step 3: 古い enum 型を削除し、新しい型にリネーム
ALTER TYPE "NoteStatus" RENAME TO "NoteStatus_old";
ALTER TYPE "NoteStatus_new" RENAME TO "NoteStatus";
DROP TYPE "NoteStatus_old";

-- Step 4: デフォルト値を再設定
ALTER TABLE "TradeNote" ALTER COLUMN "status" SET DEFAULT 'draft';

-- Step 5: カラム名の変更（データを保持）
ALTER TABLE "TradeNote" RENAME COLUMN "approvedAt" TO "activatedAt";
ALTER TABLE "TradeNote" RENAME COLUMN "rejectedAt" TO "archivedAt";
