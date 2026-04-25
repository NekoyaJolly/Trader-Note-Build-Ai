/**
 * Prisma を使う統合テスト向けの DB クリーンアップ helper。
 *
 * 個別テストが複数の deleteMany を並列 worker 上で乱発すると、Supabase の
 * session pool を使い切るため、1 トランザクションにまとめて接続利用を抑える。
 */

import { prisma } from '../../db/client';

export async function cleanupTradeImportRelatedTestData(): Promise<void> {
  await prisma.$transaction([
    prisma.aISummary.deleteMany({}),
    prisma.backtestRun.deleteMany({}),
    prisma.matchResult.deleteMany({}),
    prisma.notificationLog.deleteMany({}),
    prisma.evaluationLog.deleteMany({}),
    prisma.tradeNote.deleteMany({}),
    prisma.trade.deleteMany({}),
  ]);
}
