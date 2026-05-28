-- AlterTable: Step C-1 reflectionAI の振り返り分析結果を永続化するカラムを追加。
-- nullable JSONB のため既存行は NULL となり後方互換。pdcaLoop の REFLECTING で書き込み、
-- aiNoteService が読んで統合ノートを生成する。
ALTER TABLE "VirtualTrade" ADD COLUMN "reflection" JSONB;
