/**
 * Prisma を使う統合テスト向けの DB クリーンアップ helper。
 *
 * 個別テストが複数の PrismaClient / transaction を並列 worker 上で保持すると、
 * Supabase の session pool を使い切るため、共有 client の単一 TRUNCATE にまとめる。
 */

import { prisma } from '../../db/client';

export async function cleanupTradeImportRelatedTestData(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AISummary",
      "BacktestRun",
      "MatchResult",
      "NotificationLog",
      "EvaluationLog",
      "TradeNote",
      "Trade"
    RESTART IDENTITY CASCADE
  `);
}
