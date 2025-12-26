/*
  Warnings:

  - Added the required column `reasons` to the `MatchResult` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MatchResult" ADD COLUMN     "evaluatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reasons" JSONB NOT NULL;
