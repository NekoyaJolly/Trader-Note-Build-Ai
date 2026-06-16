/**
 * LensSnapshot バックフィル状態チェック。
 *
 * 目的:
 * - 既存 TradeNote の Note コア行 / lensSnapshot 生成状況を集計する
 * - 本番バックフィル前後に、未処理件数を read-only で確認する
 *
 * 実行:
 *   npx tsx scripts/check/lens-snapshot-backfill-status.ts [--include-archived] [--fail-on-pending]
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../src/backend/db/client';

interface CliOptions {
  includeArchived: boolean;
  failOnPending: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { includeArchived: false, failOnPending: false };
  for (const arg of argv) {
    if (arg === '--include-archived') {
      options.includeArchived = true;
    } else if (arg === '--fail-on-pending') {
      options.failOnPending = true;
    } else {
      throw new Error(`未知の引数です: ${arg}`);
    }
  }
  return options;
}

async function countForStatus(status: 'draft' | 'active' | 'archived') {
  const whereByStatus = { status };
  const total = await prisma.tradeNote.count({ where: whereByStatus });
  const missingCore = await prisma.tradeNote.count({
    where: {
      ...whereByStatus,
      coreNote: null,
    },
  });
  const nullSnapshot = await prisma.tradeNote.count({
    where: {
      ...whereByStatus,
      coreNote: { lensSnapshot: { equals: Prisma.AnyNull } },
    },
  });

  return {
    status,
    total,
    missingCore,
    nullSnapshot,
    pending: missingCore + nullSnapshot,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const statuses: Array<'draft' | 'active' | 'archived'> = options.includeArchived
    ? ['draft', 'active', 'archived']
    : ['draft', 'active'];

  const rows = [];
  for (const status of statuses) {
    rows.push(await countForStatus(status));
  }

  const totals = rows.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      missingCore: acc.missingCore + row.missingCore,
      nullSnapshot: acc.nullSnapshot + row.nullSnapshot,
      pending: acc.pending + row.pending,
    }),
    { total: 0, missingCore: 0, nullSnapshot: 0, pending: 0 }
  );

  console.log('[lens-snapshot-backfill-status] 対象 status:', statuses.join(', '));
  for (const row of rows) {
    console.log(
      `  ${row.status}: total=${row.total} missingCore=${row.missingCore} ` +
        `nullSnapshot=${row.nullSnapshot} pending=${row.pending}`
    );
  }
  console.log(
    `[lens-snapshot-backfill-status] total=${totals.total} missingCore=${totals.missingCore} ` +
      `nullSnapshot=${totals.nullSnapshot} pending=${totals.pending}`
  );

  if (options.failOnPending && totals.pending > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[lens-snapshot-backfill-status] 失敗: ${message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
