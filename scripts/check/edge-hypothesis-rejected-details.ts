/**
 * EdgeHypothesis rejected 詳細表示 (2026-05-24 セッション、Phase B 観察用)
 *
 * 目的:
 * Phase B 後 (= 2026-05-22T00:00:00Z 以降) の EdgeHypothesis 3 件すべてが status='rejected'
 * になっている観察を受けて、statusNote / symbols / timeframes / source / conditions
 * を取り出して「何が原因で却下されているか」を判別する材料を取る。
 *
 * 仮説:
 *   (a) 仮説の質が低い → HypothesisGenerator prompt が刷新を生かせていない
 *   (b) screening 基準が厳しい → ScreeningOrchestrator の閾値見直し要
 *   (c) サンプル不足 → 待つしかない
 *
 * 使い方:
 *   DATABASE_URL=... npx tsx scripts/check/edge-hypothesis-rejected-details.ts
 *
 * オプション:
 *   --boundary=ISO  fetch 対象の firstObservedAt 開始日時 (default 2026-05-22T00:00:00Z)
 *   --status=...   絞る status (default rejected、'unverified' / 'screening_passed' 等も可)
 *
 * read-only。DELETE / UPDATE は一切しない。
 */

import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

loadEnv();

const DEFAULT_BOUNDARY = '2026-05-22T00:00:00Z';
const DEFAULT_STATUS = 'rejected';

function parseArgs(): { boundary: string; status: string } {
  let boundary = DEFAULT_BOUNDARY;
  let status = DEFAULT_STATUS;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--boundary=')) boundary = arg.slice('--boundary='.length);
    else if (arg.startsWith('--status=')) status = arg.slice('--status='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        `usage: npx tsx scripts/check/edge-hypothesis-rejected-details.ts [--boundary=ISO] [--status=NAME]`,
      );
      process.exit(0);
    }
  }
  return { boundary, status };
}

async function main(): Promise<void> {
  const { boundary, status } = parseArgs();
  const boundaryDate = new Date(boundary);
  if (Number.isNaN(boundaryDate.getTime())) {
    console.error(`Invalid --boundary: ${boundary}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.edgeHypothesis.findMany({
      where: {
        status,
        firstObservedAt: { gte: boundaryDate },
      },
      orderBy: { firstObservedAt: 'asc' },
    });

    console.log(`\n=== EdgeHypothesis status='${status}' (firstObservedAt >= ${boundary}) ===`);
    console.log(`合計: ${rows.length} 件\n`);

    for (let i = 0; i < rows.length; i++) {
      const h = rows[i];
      console.log(`--- [${i + 1}/${rows.length}] id=${h.id.slice(0, 8)}... ---`);
      console.log(`  statement      : ${h.statement.slice(0, 200)}${h.statement.length > 200 ? '...' : ''}`);
      console.log(`  category       : ${h.category}`);
      console.log(`  expectedDirection: ${h.expectedDirection}`);
      console.log(`  symbols        : ${JSON.stringify(h.symbols)}`);
      console.log(`  timeframes     : ${JSON.stringify(h.timeframes)}`);
      console.log(`  source         : ${h.source}`);
      console.log(`  firstObservedAt: ${h.firstObservedAt.toISOString()}`);
      console.log(`  statusUpdatedAt: ${h.statusUpdatedAt.toISOString()}`);
      console.log(`  statusNote     : ${h.statusNote ?? '(null)'}`);
      // conditions は JsonValue (= 構造化)、最初の要素だけ簡易表示
      const condStr = JSON.stringify(h.conditions);
      console.log(`  conditions     : ${condStr.slice(0, 300)}${condStr.length > 300 ? '...' : ''}`);

      // 関連 ScreeningBacktestRun があれば見る
      const screening = await prisma.screeningBacktestRun.findMany({
        where: { hypothesisId: h.id },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      if (screening.length > 0) {
        const s = screening[0];
        console.log(`  screeningBT    : runId=${s.id.slice(0, 8)}... outcome=${s.outcome ?? '(null)'} createdAt=${s.createdAt.toISOString()}`);
      } else {
        console.log(`  screeningBT    : (なし)`);
      }
      console.log('');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('取得失敗:', err);
  process.exit(1);
});
