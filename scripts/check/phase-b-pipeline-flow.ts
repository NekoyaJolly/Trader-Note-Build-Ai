/**
 * Phase B 5 経路パイプラインフロー集計 (2026-05-24 セッション、Phase B 観察用)
 *
 * 目的:
 *   PR #251 (Cron 4h ごと) + PR #252 (Top-Level Orchestrator Phase 2) マージ後の
 *   plan → screening → full-validation 経路の 24h/7d 集計を取り、Phase B 仮説検証
 *   (= not_testable=288 の連鎖故障が解消するか) を 5 経路別件数で観察する。
 *
 *   side-b-data-snapshot.ts は boundary 前後の "クリア候補量感把握" が役割。
 *   本スクリプトは "Cron 起動と経路通過の動作観察" が役割で目的が異なる。
 *
 * 集計内容:
 *   (1) EdgeHypothesis: 直近 24h / 7d 生成件数 + status 分布
 *   (2) ScreeningBacktestRun: 直近 24h / 7d 実行件数 + outcome (= summary.pf > 1.1 通過率の概算)
 *   (3) EvolutionBacktestRun: 直近 24h / 7d + formalBtPassed 別
 *   (4) AgentRun: kind 別件数 (= top_level_orchestrator は Phase 3 着手後の動作確認用、
 *       Phase 3 前は 0 のはず)
 *
 * read-only。DELETE / UPDATE は一切しない。
 *
 * 使い方:
 *   DATABASE_URL=... npx tsx scripts/check/phase-b-pipeline-flow.ts
 */

import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

loadEnv();

interface WindowCounts {
  /** 直近 24h */
  day: number;
  /** 直近 7d */
  week: number;
  /** 全期間 */
  total: number;
}

interface PipelineSection {
  title: string;
  counts: WindowCounts;
  /** status / outcome / kind 等のグルーピング (任意) */
  grouped?: Array<{ key: string; counts: WindowCounts }>;
  /** 注釈 */
  note?: string;
}

function formatCounts(c: WindowCounts): string {
  return `24h=${String(c.day).padStart(4)}  7d=${String(c.week).padStart(5)}  total=${String(c.total).padStart(6)}`;
}

function formatSection(s: PipelineSection): string {
  const lines: string[] = [];
  lines.push(`${s.title.padEnd(40)} ${formatCounts(s.counts)}`);
  if (s.note) {
    lines.push(`  (${s.note})`);
  }
  if (s.grouped) {
    for (const g of s.grouped) {
      lines.push(`  ${g.key.padEnd(38)} ${formatCounts(g.counts)}`);
    }
  }
  return lines.join('\n');
}

async function collectEdgeHypothesis(
  prisma: PrismaClient,
  now: Date,
  dayAgo: Date,
  weekAgo: Date,
): Promise<PipelineSection> {
  const [day, week, total] = await Promise.all([
    prisma.edgeHypothesis.count({ where: { firstObservedAt: { gte: dayAgo } } }),
    prisma.edgeHypothesis.count({ where: { firstObservedAt: { gte: weekAgo } } }),
    prisma.edgeHypothesis.count(),
  ]);

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

  const grouped: PipelineSection['grouped'] = [];
  for (const status of statuses) {
    const [d, w, t] = await Promise.all([
      prisma.edgeHypothesis.count({ where: { status, firstObservedAt: { gte: dayAgo } } }),
      prisma.edgeHypothesis.count({ where: { status, firstObservedAt: { gte: weekAgo } } }),
      prisma.edgeHypothesis.count({ where: { status } }),
    ]);
    if (t > 0) grouped.push({ key: `status=${status}`, counts: { day: d, week: w, total: t } });
  }

  return {
    title: '(1) EdgeHypothesis (= Plan 生成 + Screening / Validation 結果)',
    counts: { day, week, total },
    grouped,
    note: 'Cron 4h ごとなら 24h で 6 件以上の plan 生成が期待値',
  };
}

async function collectScreening(
  prisma: PrismaClient,
  _now: Date,
  dayAgo: Date,
  weekAgo: Date,
): Promise<PipelineSection> {
  const [day, week, total] = await Promise.all([
    prisma.screeningBacktestRun.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.screeningBacktestRun.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.screeningBacktestRun.count(),
  ]);
  return {
    title: '(2) ScreeningBacktestRun (= 1.1 PF screening 実行)',
    counts: { day, week, total },
    note: 'EdgeHypothesis 1 件あたり 1 ScreeningBT、24h で同程度の件数が期待値',
  };
}

async function collectEvolution(
  prisma: PrismaClient,
  _now: Date,
  dayAgo: Date,
  weekAgo: Date,
): Promise<PipelineSection> {
  const [day, week, total] = await Promise.all([
    prisma.evolutionBacktestRun.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.evolutionBacktestRun.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.evolutionBacktestRun.count(),
  ]);
  const grouped: PipelineSection['grouped'] = [];
  for (const passed of [true, false]) {
    const [d, w, t] = await Promise.all([
      prisma.evolutionBacktestRun.count({
        where: { formalBtPassed: passed, createdAt: { gte: dayAgo } },
      }),
      prisma.evolutionBacktestRun.count({
        where: { formalBtPassed: passed, createdAt: { gte: weekAgo } },
      }),
      prisma.evolutionBacktestRun.count({ where: { formalBtPassed: passed } }),
    ]);
    if (t > 0) {
      grouped.push({
        key: `formalBtPassed=${String(passed)}`,
        counts: { day: d, week: w, total: t },
      });
    }
  }
  return {
    title: '(3) EvolutionBacktestRun (= 進化ループ正式 BT)',
    counts: { day, week, total },
    grouped,
  };
}

async function collectAgentRun(
  prisma: PrismaClient,
  _now: Date,
  dayAgo: Date,
  weekAgo: Date,
): Promise<PipelineSection> {
  const [day, week, total] = await Promise.all([
    prisma.agentRun.count({ where: { startedAt: { gte: dayAgo } } }),
    prisma.agentRun.count({ where: { startedAt: { gte: weekAgo } } }),
    prisma.agentRun.count(),
  ]);

  const kindRows = await prisma.agentRun.groupBy({
    by: ['kind'],
    _count: { _all: true },
    where: { startedAt: { gte: weekAgo } },
  });

  const grouped: PipelineSection['grouped'] = [];
  for (const row of kindRows) {
    const kind = row.kind;
    const [d, w, t] = await Promise.all([
      prisma.agentRun.count({ where: { kind, startedAt: { gte: dayAgo } } }),
      prisma.agentRun.count({ where: { kind, startedAt: { gte: weekAgo } } }),
      prisma.agentRun.count({ where: { kind } }),
    ]);
    grouped.push({ key: `kind=${kind}`, counts: { day: d, week: w, total: t } });
  }

  return {
    title: '(4) AgentRun (= ADK trace / Top-Level Orchestrator)',
    counts: { day, week, total },
    grouped,
    note: 'kind=top_level_orchestrator は Phase 3 (env=true) 切替後の動作観察用、Phase 3 前は 0',
  };
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  try {
    const sections = await Promise.all([
      collectEdgeHypothesis(prisma, now, dayAgo, weekAgo),
      collectScreening(prisma, now, dayAgo, weekAgo),
      collectEvolution(prisma, now, dayAgo, weekAgo),
      collectAgentRun(prisma, now, dayAgo, weekAgo),
    ]);

    console.log(`\n=== Phase B Pipeline Flow (now: ${now.toISOString()}) ===\n`);
    console.log('観察対象: PR #251 (Cron 4h ごと) + PR #252 (Top-Level Orchestrator Phase 2) マージ後の経路通過量\n');
    for (const s of sections) {
      console.log(formatSection(s));
      console.log('');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('集計失敗:', err);
  process.exit(1);
});
