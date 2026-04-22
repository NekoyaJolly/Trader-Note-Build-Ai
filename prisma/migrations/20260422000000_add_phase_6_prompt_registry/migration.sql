-- Phase 6: プロンプト進化基盤テーブル追加
-- PromptVersion / PromptAbTestResult / AgentRestructureProposal

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" UUID NOT NULL,
    "agentName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "parentVersionId" UUID,
    "createdBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'experimental',
    "notes" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "avgScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMPTZ(6),
    "approvedAt" TIMESTAMPTZ(6),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_prompt_version_agent_version" ON "PromptVersion"("agentName", "version");

-- CreateIndex
CREATE INDEX "idx_prompt_version_agent_status" ON "PromptVersion"("agentName", "status");

-- CreateIndex
CREATE INDEX "idx_prompt_version_status" ON "PromptVersion"("status");

-- CreateIndex
CREATE INDEX "idx_prompt_version_created" ON "PromptVersion"("createdAt" DESC);

-- CreateTable
CREATE TABLE "PromptAbTestResult" (
    "id" UUID NOT NULL,
    "agentName" TEXT NOT NULL,
    "variantIds" JSONB NOT NULL,
    "variantResults" JSONB NOT NULL,
    "winnerVersionId" UUID,
    "inputDigest" TEXT,
    "testedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptAbTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_prompt_abtest_agent_tested" ON "PromptAbTestResult"("agentName", "testedAt" DESC);

-- CreateTable
CREATE TABLE "AgentRestructureProposal" (
    "id" UUID NOT NULL,
    "proposal" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMPTZ(6),
    "executionResult" JSONB,
    "executedAt" TIMESTAMPTZ(6),
    "approvalNotes" TEXT,
    "proposedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRestructureProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_agent_restructure_status_proposed" ON "AgentRestructureProposal"("status", "proposedAt" DESC);
