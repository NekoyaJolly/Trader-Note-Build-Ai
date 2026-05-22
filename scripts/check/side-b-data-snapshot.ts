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
 *   2. Phase B マージ前 (= 旧 hardcode 期) と マージ後 (= Phase B 修正後) の期間別件数
 *   3. EdgeHypothesis / EvolutionBacktestRun / GenerationLesson 等の主要テーブルは
 *      status / category 等のキー別 cross 集計も追加
 * を取得して、データクリア範囲判断の材料を提供する。
 *
 * **DELETE / TRUNCATE は一切実行しない**。本スクリプトはあくまで snapshot 取得。
 * 実際のクリアは別スクリプト or migration で Nekoさん 承認後に実施する。
 *
 * 使い方:
 *   DATABASE_URL=... npx tsx scripts/check/side-b-data-snapshot.ts
 *
 * オプション:
 *   --boundary=YYYY-MM-DDThh:mm:ssZ
 *     Phase B マージ前後の境界日時 (default: 2026-05-22T00:00:00Z)
 *   --json
 *     人間可読 table の代わりに JSON 出力 (= 後で集計加工する場合)
 *
 * 出力例 (table モード):
 *   === Side-B Data Snapshot (boundary: 2026-05-22T00:00:00Z) ===
 *   EdgeHypothesis        total=735  before=720  after=15
 *     status=screening_passed before=323 after=0
 *     status=not_testable    before=288 after=12
 *     ...
 *
 * @see docs/diagnostics/codebase_review_2026-05-22.html § Top Risks 解消行
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
  before: number;
  after: number;
  groupedBy?: Record<string, { before: number; after: number }>;
}

async function countWithBoundary(
  prisma: PrismaClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  boundaryDate: Date,
  dateField: string = 'createdAt',
): Promise<{ total: number; before: number; after: number }> {
  const total = await model.count();
  const before = await model.count({
    where: { [dateField]: { lt: boundaryDate } },
  });
  const after = await model.count({
    where: { [dateField]: { gte: boundaryDate } },
  });
  return { total, before, after };
}

async function snapshotEdgeHypothesis(
  prisma: PrismaClient,
  boundaryDate: Date,
): Promise<TableSnapshot> {
  const base = await countWithBoundary(prisma, prisma.edgeHypothesis, boundaryDate);
  // status 別 cross 集計
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
    const before = await prisma.edgeHypothesis.count({
      where: { status, createdAt: { lt: boundaryDate } },
    });
    const after = await prisma.edgeHypothesis.count({
      where: { status, createdAt: { gte: boundaryDate } },
    });
    if (before > 0 || after > 0) {
      groupedBy[`status=${status}`] = { before, after };
    }
  }
  return { table: 'EdgeHypothesis', ...base, groupedBy };
}

async function snapshotEvolutionBacktestRun(
  prisma: PrismaClient,
  boundaryDate: Date,
): Promise<TableSnapshot> {
  const base = await countWithBoundary(prisma, prisma.evolutionBacktestRun, boundaryDate);
  // formalBtPassed 別
  const groupedBy: Record<string, { before: number; after: number }> = {};
  for (const passed of [true, false]) {
    const before = await prisma.evolutionBacktestRun.count({
      where: { formalBtPassed: passed, createdAt: { lt: boundaryDate } },
    });
    const after = await prisma.evolutionBacktestRun.count({
      where: { formalBtPassed: passed, createdAt: { gte: boundaryDate } },
    });
    groupedBy[`formalBtPassed=${String(passed)}`] = { before, after };
  }
  return { table: 'EvolutionBacktestRun', ...base, groupedBy };
}

async function snapshotGenerationLesson(
  prisma: PrismaClient,
  boundaryDate: Date,
): Promise<TableSnapshot> {
  const base = await countWithBoundary(prisma, prisma.generationLesson, boundaryDate);
  const categories = ['breakthrough', 'stagnation', 'failure', 'success'] as const;
  const groupedBy: Record<string, { before: number; after: number }> = {};
  for (const category of categories) {
    const before = await prisma.generationLesson.count({
      where: { category, createdAt: { lt: boundaryDate } },
    });
    const after = await prisma.generationLesson.count({
      where: { category, createdAt: { gte: boundaryDate } },
    });
    if (before > 0 || after > 0) {
      groupedBy[`category=${category}`] = { before, after };
    }
  }
  return { table: 'GenerationLesson', ...base, groupedBy };
}

async function snapshotAgentRun(
  prisma: PrismaClient,
  boundaryDate: Date,
): Promise<TableSnapshot> {
  const base = await countWithBoundary(prisma, prisma.agentRun, boundaryDate, 'startedAt');
  return { table: 'AgentRun', ...base };
}

function formatSnapshot(snap: TableSnapshot): string {
  const lines: string[] = [];
  lines.push(
    `${snap.table.padEnd(28)} total=${String(snap.total).padStart(6)}  ` +
      `before=${String(snap.before).padStart(6)}  ` +
      `after=${String(snap.after).padStart(6)}`,
  );
  if (snap.groupedBy) {
    for (const [key, counts] of Object.entries(snap.groupedBy)) {
      lines.push(
        `  ${key.padEnd(36)} before=${String(counts.before).padStart(4)}  ` +
          `after=${String(counts.after).padStart(4)}`,
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
    // 仮説中核
    snapshots.push(await snapshotEdgeHypothesis(prisma, boundaryDate));

    // 進化 BT 系
    snapshots.push(await snapshotEvolutionBacktestRun(prisma, boundaryDate));
    snapshots.push(await snapshotGenerationLesson(prisma, boundaryDate));
    snapshots.push({
      table: 'EvolutionInstanceCarry',
      ...(await countWithBoundary(prisma, prisma.evolutionInstanceCarry, boundaryDate)),
    });

    // 戦略 BT 系
    snapshots.push({
      table: 'StrategyBacktestRun',
      ...(await countWithBoundary(prisma, prisma.strategyBacktestRun, boundaryDate)),
    });
    snapshots.push({
      table: 'StrategyBacktestResult',
      ...(await countWithBoundary(prisma, prisma.strategyBacktestResult, boundaryDate)),
    });
    snapshots.push({
      table: 'StrategyBacktestEvent',
      ...(await countWithBoundary(prisma, prisma.strategyBacktestEvent, boundaryDate)),
    });
    snapshots.push({
      table: 'ScreeningBacktestRun',
      ...(await countWithBoundary(prisma, prisma.screeningBacktestRun, boundaryDate)),
    });

    // 検証ツール
    snapshots.push({
      table: 'WalkForwardRun',
      ...(await countWithBoundary(prisma, prisma.walkForwardRun, boundaryDate)),
    });
    snapshots.push({
      table: 'MonteCarloRun',
      ...(await countWithBoundary(prisma, prisma.monteCarloRun, boundaryDate)),
    });

    // メタ進化
    snapshots.push({
      table: 'AgentRestructureProposal',
      ...(await countWithBoundary(prisma, prisma.agentRestructureProposal, boundaryDate)),
    });

    // 戦略下書き
    snapshots.push({
      table: 'StrategyDraft',
      ...(await countWithBoundary(prisma, prisma.strategyDraft, boundaryDate)),
    });

    // AI 出力 / 仮想トレード (= 削除可否は別判断)
    snapshots.push({
      table: 'AITradePlan',
      ...(await countWithBoundary(prisma, prisma.aITradePlan, boundaryDate)),
    });
    snapshots.push({
      table: 'AITradeNote',
      ...(await countWithBoundary(prisma, prisma.aITradeNote, boundaryDate)),
    });
    snapshots.push({
      table: 'AINoteSummary',
      ...(await countWithBoundary(prisma, prisma.aINoteSummary, boundaryDate)),
    });
    snapshots.push({
      table: 'ResearchOutput',
      ...(await countWithBoundary(prisma, prisma.researchOutput, boundaryDate)),
    });
    snapshots.push({
      table: 'MarketResearch',
      ...(await countWithBoundary(prisma, prisma.marketResearch, boundaryDate)),
    });
    snapshots.push({
      table: 'VirtualTrade',
      ...(await countWithBoundary(prisma, prisma.virtualTrade, boundaryDate)),
    });
    snapshots.push({
      table: 'VirtualPortfolio',
      ...(await countWithBoundary(prisma, prisma.virtualPortfolio, boundaryDate)),
    });

    // Run Ledger (= ADK trace 履歴、デバッグ用)
    snapshots.push(await snapshotAgentRun(prisma, boundaryDate));
    snapshots.push({
      table: 'AgentRunStep',
      ...(await countWithBoundary(prisma, prisma.agentRunStep, boundaryDate, 'startedAt')),
    });

    if (args.jsonMode) {
      console.log(JSON.stringify({ boundary: args.boundaryIso, snapshots }, null, 2));
    } else {
      console.log(`\n=== Side-B Data Snapshot (boundary: ${args.boundaryIso}) ===\n`);
      console.log(`(before = boundary 以前 = 旧 hardcode 期 / after = boundary 以降 = Phase B 修正後)\n`);
      for (const snap of snapshots) {
        console.log(formatSnapshot(snap));
      }
      console.log('\n');
      const totalBefore = snapshots.reduce((sum, s) => sum + s.before, 0);
      const totalAfter = snapshots.reduce((sum, s) => sum + s.after, 0);
      console.log(`合計: before=${totalBefore}, after=${totalAfter}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('snapshot 取得失敗:', err);
  process.exit(1);
});
