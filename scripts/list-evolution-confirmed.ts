/**
 * Phase 5A 診断スクリプト
 *
 * 進化ループ（Phase 5 旧実装）由来で `confirmed` に昇格された
 * EdgeHypothesis をリストアップする。
 *
 * 重要:
 * - 旧実装は `source: 'backtest'` で `create` し、`statement` の先頭に
 *   `[DSL:<uuid>] ` を付けていた（`EdgeSource` 型に 'evolution' が無いため）。
 * - したがって「進化ループ由来かどうか」の識別は `statement LIKE '[DSL:%'`
 *   をキーにする。
 *
 * 使い方:
 *   DATABASE_URL=... npx ts-node scripts/list-evolution-confirmed.ts
 *
 * 出力:
 *   - 総件数
 *   - 各行の id / status / source / createdAt / statement 先頭 120 文字
 *   - ステータス別集計（confirmed / testing / unverified / rejected 等）
 *
 * 注意: 自動削除は一切行わない。人間が判断する前提。
 */

import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

loadEnv();

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.edgeHypothesis.findMany({
      where: {
        statement: { startsWith: '[DSL:' },
      },
      select: {
        id: true,
        status: true,
        source: true,
        createdAt: true,
        statement: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`\n=== 進化ループ由来の EdgeHypothesis（statement LIKE '[DSL:%'） ===`);
    console.log(`総件数: ${rows.length}\n`);

    const byStatus = new Map<string, number>();
    for (const r of rows) {
      byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    }
    console.log('ステータス別:');
    for (const [k, v] of byStatus.entries()) {
      console.log(`  ${k}: ${v}`);
    }

    const confirmed = rows.filter((r) => r.status === 'confirmed');
    console.log(`\n--- status='confirmed' の詳細（${confirmed.length} 件） ---`);
    for (const r of confirmed) {
      const head = r.statement.slice(0, 120);
      console.log(`  [${r.createdAt.toISOString()}] id=${r.id} source=${r.source}`);
      console.log(`    ${head}${r.statement.length > 120 ? '…' : ''}`);
    }

    // 念のため source='evolution' の件数も集計（本実装では登録されないはずだが、
    // 将来 EdgeSource に 'evolution' が追加される場合の備え）。
    const bySourceEvolution = await prisma.edgeHypothesis.count({
      where: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        source: 'evolution' as any,
        status: 'confirmed',
      },
    }).catch(() => 0);
    console.log(`\n参考: source='evolution' AND status='confirmed' の件数: ${bySourceEvolution}`);
    console.log('  （Phase 5A の旧実装では source=\'backtest\' が使われていたため、通常 0 になります）');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
