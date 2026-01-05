-- CreateTable
CREATE TABLE "CTraderToken" (
    "id" UUID NOT NULL,
    "accountId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "scope" TEXT,
    "lastConnectedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CTraderToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CTraderToken_accountId_key" ON "CTraderToken"("accountId");

-- CreateIndex
CREATE INDEX "idx_ctrader_token_expires" ON "CTraderToken"("expiresAt");
