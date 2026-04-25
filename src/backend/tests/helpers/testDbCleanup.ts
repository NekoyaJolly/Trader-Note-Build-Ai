/**
 * Prisma を使う統合テスト向けの DB クリーンアップ helper。
 *
 * 個別テストが複数の PrismaClient / transaction を並列 worker 上で保持すると、
 * Supabase の session pool を使い切るため、共有 client で逐次 delete する。
 */

import { prisma } from '../../db/client';

export async function cleanupTradeImportRelatedTestData(): Promise<void> {
  await prisma.aISummary.deleteMany({});
  await prisma.backtestRun.deleteMany({});
  await prisma.matchResult.deleteMany({});
  await prisma.notificationLog.deleteMany({});
  await prisma.evaluationLog.deleteMany({});
  await prisma.tradeNote.deleteMany({});
  await prisma.trade.deleteMany({});
}
