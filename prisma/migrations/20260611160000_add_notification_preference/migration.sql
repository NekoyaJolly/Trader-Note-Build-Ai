-- ============================================================
-- Phase β-2a: NotificationPreference テーブル新設 (additive・非破壊)
--
-- 通知粒度のユーザー設定 (しきい値 / 一致レベル / クールダウン / 日次上限) を
-- note / strategy > profile > user > システム既定 の階層で解決するための置き場。
-- completion-roadmap 決定4 / NOTE_SIMILARITY_FOUNDATION §6.3-6.4 のユーザー設定層。
-- ============================================================

-- CreateEnum
CREATE TYPE "NotificationPreferenceScope" AS ENUM ('user', 'profile', 'note', 'strategy');

-- CreateEnum
CREATE TYPE "SimilarityMatchLevel" AS ENUM ('strong', 'medium', 'weak');

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "scope" "NotificationPreferenceScope" NOT NULL,
    "profileId" UUID,
    "noteId" UUID,
    "strategyId" UUID,
    "threshold" DOUBLE PRECISION,
    "minMatchLevel" "SimilarityMatchLevel",
    "cooldownMinutes" INTEGER,
    "maxPerDay" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- scope 別の一意性は partial unique index で担保する。
-- 複合 unique ("userId","scope","profileId","noteId","strategyId") では PostgreSQL が
-- NULL 同士を distinct 扱いするため (対象外スコープの列が常に NULL)、実質何も防げない
-- (PR #389 Copilot レビュー指摘)。Prisma schema は partial index を表現できないため
-- 本 migration の raw SQL が正本。
CREATE UNIQUE INDEX "uq_notification_pref_user_singleton" ON "NotificationPreference"("userId") WHERE "scope" = 'user';
CREATE UNIQUE INDEX "uq_notification_pref_note_singleton" ON "NotificationPreference"("userId", "noteId") WHERE "scope" = 'note';
CREATE UNIQUE INDEX "uq_notification_pref_profile_singleton" ON "NotificationPreference"("userId", "profileId") WHERE "scope" = 'profile';
CREATE UNIQUE INDEX "uq_notification_pref_strategy_singleton" ON "NotificationPreference"("userId", "strategyId") WHERE "scope" = 'strategy';

-- CreateIndex
CREATE INDEX "idx_notification_pref_user_scope" ON "NotificationPreference"("userId", "scope");

-- CreateIndex
CREATE INDEX "idx_notification_pref_note" ON "NotificationPreference"("noteId");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "IndicatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "TradeNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
