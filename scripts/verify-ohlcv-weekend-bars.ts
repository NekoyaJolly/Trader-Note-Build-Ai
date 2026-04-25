/**
 * Phase 6.7a: OHLCV に土日(UTC)のバーが残っていないか確認する
 *
 * 設計: docs/design/phase_6_7a_infrastructure.md §2.3 / phase_6_7_overview.md §7 調査タスク2
 *
 * 前提: 環境変数 DATABASE_URL（.env またはシェルで注入）
 *
 * 使い方:
 *   npx tsx scripts/verify-ohlcv-weekend-bars.ts
 *
 * 終了コード: 土日バーが1本でもあれば 1、全グループ0なら 0
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Row = { symbol: string; timeframe: string; cnt: bigint };

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL が未設定です。.env を読み込むか export してください。');
    process.exit(2);
  }

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT symbol, timeframe, COUNT(*)::bigint AS cnt
    FROM "OHLCVCandle"
    WHERE EXTRACT(DOW FROM timestamp AT TIME ZONE 'UTC') IN (0, 6)
    GROUP BY symbol, timeframe
    ORDER BY symbol, timeframe
  `;

  console.log('— OHLCV 土日(UTC, DOW=0,6) バー件数（symbol / timeframe 別）—');
  if (rows.length === 0) {
    console.log('(該当なし: 0 行 → Phase 6.7a 条件「土日バー 0」を満たす)');
  } else {
    let total = 0n;
    for (const r of rows) {
      const c = Number(r.cnt);
      total += r.cnt;
      console.log(`  ${r.symbol} / ${r.timeframe}: ${c} 本`);
    }
    console.log(`合計: ${total.toString()} 本（>0 のため要 truncate 検討）`);
  }

  const bad = rows.some((r) => r.cnt > 0n);
  process.exit(bad ? 1 : 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
