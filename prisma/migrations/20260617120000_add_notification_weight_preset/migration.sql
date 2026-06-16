-- ============================================================
-- 通知粒度: レンズ層重みプリセットを NotificationPreference に追加
--
-- completion-roadmap 決定4 / NOTE_SIMILARITY_FOUNDATION §6.3 の
-- 「指標重視 / バランス / 状態重視」をユーザー設定として保存する。
-- NULL は既存挙動と同じ indicator_focused 既定を意味するため、既存行の backfill は不要。
-- ============================================================

-- CreateEnum
CREATE TYPE "LensWeightPreset" AS ENUM ('indicator_focused', 'balanced', 'state_focused');

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN "weightPreset" "LensWeightPreset";
