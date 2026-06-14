/**
 * Prisma を使う統合テスト向けの DB クリーンアップ helper。
 *
 * 個別テストが複数の PrismaClient / transaction を並列 worker 上で保持すると、
 * Supabase の session pool を使い切るため、共有 client の単一 TRUNCATE にまとめる。
 */

import { prisma } from '../../db/client';

export const TRADE_IMPORT_TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * TRUNCATE 実行直前の最終ガード。DATABASE_URL がローカル DB 以外を指す場合は拒否する。
 *
 * jest.db.config.ts の構成読込時ゲートと同じ判定の二重防御 (こちらは実行時)。
 * 理由: CI / ローカル .env の DATABASE_URL が本番 Supabase を指した状態で本ヘルパーが
 * 実行され、本番テーブルが TRUNCATE される事故が発生した (2026-06-11 調査で確定)。
 */
function assertLocalDatabaseForTruncate(): void {
  const url = process.env.DATABASE_URL ?? '';
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    host = '';
  }
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (!isLocal && process.env.ALLOW_DESTRUCTIVE_DB_TESTS !== 'true') {
    throw new Error(
      `🚫 TRUNCATE を拒否: DATABASE_URL のホストが localhost ではありません (host=${host || '解析不能'})。` +
        '共有/本番 DB に対する破壊的テストは実行できません。' +
        '隔離済み DB の場合のみ ALLOW_DESTRUCTIVE_DB_TESTS=true で解除できます。'
    );
  }
}

export async function cleanupTradeImportRelatedTestData(): Promise<void> {
  assertLocalDatabaseForTruncate();
  // Critical-4 段階 3b: "BacktestRun" は廃止
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AISummary",
      "MatchResult",
      "NotificationLog",
      "EvaluationLog",
      "TradeNote",
      "Trade"
    RESTART IDENTITY CASCADE
  `);
}

export async function ensureTradeImportTestUser(): Promise<void> {
  await prisma.user.upsert({
    where: { id: TRADE_IMPORT_TEST_USER_ID },
    update: {},
    create: {
      id: TRADE_IMPORT_TEST_USER_ID,
      primaryAccountId: 'trade-import-test-account',
      displayName: 'Trade import integration test user',
    },
  });
}
