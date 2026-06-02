-- CreateTable: 進化ループ再設計 Phase 4 — regime 別の戦略集団スナップショットを DB 永続化する。
-- 背景(P4): population は data/evolution/strategy-population.json に保存されていたが、コンテナの
--   ephemeral fs では cron 再起動で消え、毎ラン population が空 → 初期種 12 個を再注入していた
--   (探索の起点が固定で収束・反復に見える)。本テーブルで durable に持ち越し、cold-start の種注入を
--   真に「初回のみ」にする。1 regime = 1 行(最新スナップショット)。members は StrategyDSL[](最大50)の JSON。
CREATE TABLE "EvolutionPopulation" (
    "regime" TEXT NOT NULL,
    "members" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "EvolutionPopulation_pkey" PRIMARY KEY ("regime")
);
