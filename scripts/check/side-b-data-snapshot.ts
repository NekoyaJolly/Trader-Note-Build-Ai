/**
 * Side-B 系 DB データの現状スナップショット取得 (2026-05-22)
 *
 * 目的:
 * Phase B 主要 3 PR (#245 OHLCV / #246 Evolution seed / #247 Scheduler) のマージで
 * hardcode 排除が完了した。これらマージ前 (= 2026-05-22T00:00:00Z 以前) に生成された
 * 仮説 / 進化結果 / AI 出力は古い hardcode の影響下にあるため、Phase B 仮説検証の
 * 統計を汚染する可能性がある。
 *
 * 本スクリプトは **read-only** で Side-B 系 21 テーブルの:
 *   1. 現状の総件数
 *   2. EdgeHypothesis / EvolutionBacktestRun は Phase B マージ前後の期間別件数 +
 *      status / formalBtPassed 別 cross 集計
 *   3. 他テーブルは total のみ (= 日付フィールドがテーブルごとに異なるため、まずは
 *      量感把握を優先)
 *
 * **DELETE / TRUNCATE は一切実行しない**。本スクリプトはあくまで snapshot 取得。
 *
 * 使い方:
 *   DATABASE_URL=... npx tsx scripts/check/side-b-data-snapshot.ts
 *   DATABASE_URL=... npx tsx scripts/check/side-b-data-snapshot.ts --json
 *   DATABASE_URL=... npx tsx scripts/check/side-b-data-snapshot.ts --boundary=2026-05-22T02:51:21Z
 */

import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

loadEnv();

const DEFAULT_BOUNDARY_ISO = '2026-05-22T00:00:00Z';

interface CliArgs {
  boundaryIso: string;
  jsonMode: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let boundaryIso: string | undefined;
  let jsonMode = false;
  for (const arg of args) {
    if (arg.startsWith('--boundary=')) {
      boundaryIso = arg.slice('--boundary='.length);
    } else if (arg === '--json') {
      jsonMode = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        `usage: npx tsx scripts/check/side-b-data-snapshot.ts [--boundary=ISO_DATETIME] [--json]`,
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return {
    boundaryIso: boundaryIso ?? DEFAULT_BOUNDARY_ISO,
    jsonMode,
  };
}

interface TableSnapshot {
  table: string;
  total: number;
  before?: number;
  after?: number;
  groupedBy?: Record<string, { before: number; after: number }>;
  note?: string;
}

async function snapshotEdgeHypothesis(
  prisma: PrismaClient,
  boundaryDate: Date,
): Promise<TableSnapshot> {
  const total = await prisma.edgeHypothesis.count();
  const before = await prisma.edgeHypothesis.count({
    where: { firstObservedAt: { lt: boundaryDate } },
  });
  const after = await prisma.edgeHypothesis.count({
    where: { firstObservedAt: { gte: boundaryDate } },
  });
  const statuses = [
    'unverified',
    'screening_passed',
    'testing',
    'confirmed',
    'not_testable',
    'insufficient_data',
    'rejected',
    'stale',
  ] as const;
  const groupedBy: Record<string, { before: number; after: number }> = {};
  for (const status of statuses) {
    const sBefore = await prisma.edgeHypothesis.count({
      where: { status, firstObservedAt: { lt: boundaryDate } },
    });
    const sAfter = await prisma.edgeHypothesis.count({
      where: { status, firstObservedAt: { gte: boundaryDate } },
    });
    if (sBefore > 0 || sAfter > 0) {
      groupedBy[`status=${status}`] = { before: sBefore, after: sAfter };
    }
  }
  return { table: 'EdgeHypothesis', total, before, after, groupedBy };
}

async function snapshotEvolutionBacktestRun(
  prisma: PrismaClient,
  boundaryDate: Date,
): Promise<TableSnapshot> {
  const total = await prisma.evolutionBacktestRun.count();
  const before = await prisma.evolutionBacktestRun.count({
    where: { createdAt: { lt: boundaryDate } },
  });
  const after = await prisma.evolutionBacktestRun.count({
    where: { createdAt: { gte: boundaryDate } },
  });
  const groupedBy: Record<string, { before: number; after: number }> = {};
  for (const passed of [true, false]) {
    const pBefore = await prisma.evolutionBacktestRun.count({
      where: { formalBtPassed: passed, createdAt: { lt: boundaryDate } },
    });
    const pAfter = await prisma.evolutionBacktestRun.count({
      where: { formalBtPassed: passed, createdAt: { gte: boundaryDate } },
    });
    groupedBy[`formalBtPassed=${String(passed)}`] = { before: pBefore, after: pAfter };
  }
  return { table: 'EvolutionBacktestRun', total, before, after, groupedBy };
}

async function snapshotGenerationLesson(
  prisma: PrismaClient,
  boundaryDate: Date,
): Promise<TableSnapshot> {
  const total = await prisma.generationLesson.count();
  const before = await prisma.generationLesson.count({
    where: { recordedAt: { lt: boundaryDate } },
  });
  const after = await prisma.generationLesson.count({
    where: { recordedAt: { gte: boundaryDate } },
  });
  return { table: 'GenerationLesson', total, before, after };
}

/**
 * 簡素版: 各テーブルの total のみを取得。
 * 日付フィールドがテーブルごとにバラバラ (createdAt / startedAt / recordedAt /
 * proposedAt / completedAt / 等) のため、期間別 cross 集計は主要 2 テーブルに絞り、
 * 残りは total を見て「クリア対象の量感」を把握する目的に特化させる。
 */
async function snapshotTotal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  tableName: string,
  note?: string,
): Promise<TableSnapshot> {
  const total = await model.count();
  return { table: tableName, total, note };
}

function formatSnapshot(snap: TableSnapshot): string {
  const lines: string[] = [];
  const totalStr = String(snap.total).padStart(7);
  if (snap.before !== undefined && snap.after !== undefined) {
    lines.push(
      `${snap.table.padEnd(28)} total=${totalStr}  ` +
        `before=${String(snap.before).padStart(7)}  ` +
        `after=${String(snap.after).padStart(7)}`,
    );
  } else {
    const noteStr = snap.note ? `  (${snap.note})` : '';
    lines.push(`${snap.table.padEnd(28)} total=${totalStr}${noteStr}`);
  }
  if (snap.groupedBy) {
    for (const [key, counts] of Object.entries(snap.groupedBy)) {
      lines.push(
        `  ${key.padEnd(36)} before=${String(counts.before).padStart(5)}  ` +
          `after=${String(counts.after).padStart(5)}`,
      );
    }
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs();
  const boundaryDate = new Date(args.boundaryIso);
  if (Number.isNaN(boundaryDate.getTime())) {
    console.error(`Invalid --boundary value: ${args.boundaryIso}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const snapshots: TableSnapshot[] = [];

  try {
    // === 仮説中核 (期間別 cross 集計あり) ===
    snapshots.push(await snapshotEdgeHypothesis(prisma, boundaryDate));

    // === 進化 BT 系 ===
    snapshots.push(await snapshotEvolutionBacktestRun(prisma, boundaryDate));
    snapshots.push(await snapshotGenerationLesson(prisma, boundaryDate));
    snapshots.push(await snapshotTotal(prisma.evolutionInstanceCarry, 'EvolutionInstanceCarry'));

    // === 戦略 BT 系 ===
    snapshots.push(await snapshotTotal(prisma.strategyBacktestRun, 'StrategyBacktestRun'));
    snapshots.push(await snapshotTotal(prisma.strategyBacktestResult, 'StrategyBacktestResult'));
    snapshots.push(await snapshotTotal(prisma.strategyBacktestEvent, 'StrategyBacktestEvent'));
    snapshots.push(await snapshotTotal(prisma.screeningBacktestRun, 'ScreeningBacktestRun'));

    // === 検証ツール ===
    snapshots.push(await snapshotTotal(prisma.walkForwardRun, 'WalkForwardRun'));
    snapshots.push(await snapshotTotal(prisma.monteCarloRun, 'MonteCarloRun'));

    // === メタ進化 / 戦略下書き ===
    snapshots.push(await snapshotTotal(prisma.agentRestructureProposal, 'AgentRestructureProposal'));
    snapshots.push(await snapshotTotal(prisma.strategyDraft, 'StrategyDraft'));

    // === AI 出力 / 仮想トレード (= クリア可否は別判断) ===
    snapshots.push(await snapshotTotal(prisma.aITradePlan, 'AITradePlan'));
    snapshots.push(await snapshotTotal(prisma.aITradeNote, 'AITradeNote', 'ユーザー閲覧データ'));
    snapshots.push(await snapshotTotal(prisma.aINoteSummary, 'AINoteSummary'));
    snapshots.push(await snapshotTotal(prisma.researchOutput, 'ResearchOutput'));
    snapshots.push(await snapshotTotal(prisma.marketResearch, 'MarketResearch', '旧 Research、Phase D 削除予定'));
    snapshots.push(await snapshotTotal(prisma.virtualTrade, 'VirtualTrade'));
    snapshots.push(await snapshotTotal(prisma.virtualPortfolio, 'VirtualPortfolio'));

    // === Run Ledger (= ADK trace 履歴) ===
    snapshots.push(await snapshotTotal(prisma.agentRun, 'AgentRun', 'ADK trace 履歴'));
    snapshots.push(await snapshotTotal(prisma.agentRunStep, 'AgentRunStep'));

    if (args.jsonMode) {
      console.log(JSON.stringify({ boundary: args.boundaryIso, snapshots }, null, 2));
    } else {
      console.log(`\n=== Side-B Data Snapshot (boundary: ${args.boundaryIso}) ===\n`);
      console.log(
        `(EdgeHypothesis / EvolutionBacktestRun / GenerationLesson のみ before=hardcode 期 / after=Phase B 修正後 で分割。他は total のみ)\n`,
      );
      for (const snap of snapshots) {
        console.log(formatSnapshot(snap));
      }
      console.log('\n');
      const totalAll = snapshots.reduce((sum, s) => sum + s.total, 0);
      console.log(`全テーブル合計: ${totalAll} 行\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('snapshot 取得失敗:', err);
  process.exit(1);
});
