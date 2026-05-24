-- CreateTable
CREATE TABLE "SystemState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SystemState_pkey" PRIMARY KEY ("key")
);

-- Enable RLS
ALTER TABLE "SystemState" ENABLE ROW LEVEL SECURITY;
