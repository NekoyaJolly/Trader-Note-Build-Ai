-- ユーザー別インジケータープロファイルテーブル (data/indicator-profiles.json からの移行先)
-- 追加のみ。既存テーブルへの破壊的変更なし。
CREATE TABLE "IndicatorProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "indicators" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "IndicatorProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_indicator_profile_user_name" ON "IndicatorProfile"("userId", "name");
CREATE INDEX "idx_indicator_profile_user" ON "IndicatorProfile"("userId");
ALTER TABLE "IndicatorProfile" ADD CONSTRAINT "IndicatorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
