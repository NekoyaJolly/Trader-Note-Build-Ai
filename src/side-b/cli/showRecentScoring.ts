/**
 * Phase 6.6: スコアリング結果確認 CLI
 *
 * PromptRegistry (PromptVersion テーブル) の usage 集計を表示する。
 *
 * 使い方:
 *   npx ts-node src/side-b/cli/showRecentScoring.ts --agent hypothesis_generator [--limit 20]
 *   npx ts-node src/side-b/cli/showRecentScoring.ts --all
 *
 * 表示内容:
 *   - 各 PromptVersion の agentName / version / status / usageCount / successCount / avgScore
 *   - active vs experimental の平均スコア比較
 *   - lastUsedAt 降順
 *
 * 注意: PromptAbTestResult の詳細時系列は Phase 6 当初から記録されているが、
 * このフェーズでは PromptVersion の aggregate 表示のみ(§3.6 MVP スコープ)。
 */

import {
  PrismaClient,
  type Prisma,
  type PromptVersion as PrismaPromptVersion,
} from '@prisma/client';
import type { PromptVersion, PromptStatus, PromptCreatedBy } from '../prompts/registry/types';

/**
 * CLI が必要とするカラムだけ select してメモリ / I/O を節約する。
 * `content` は表示しないので除外(プロンプト本文は大きく、機密も含みうる)。
 */
const PROMPT_VERSION_SELECT = {
  id: true,
  agentName: true,
  version: true,
  parentVersionId: true,
  createdBy: true,
  status: true,
  notes: true,
  usageCount: true,
  successCount: true,
  avgScore: true,
  lastUsedAt: true,
  approvedAt: true,
  approvedBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PromptVersionSelect;

type PromptVersionRow = Prisma.PromptVersionGetPayload<{
  select: typeof PROMPT_VERSION_SELECT;
}>;

export interface Args {
  all: boolean;
  agent?: string;
  limit: number;
}

export function parseArgs(argv: string[]): Args {
  const rest = argv.slice(2);
  const out: Args = { all: false, limit: 20 };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a) continue;
    if (a === '--all') {
      out.all = true;
    } else if (a === '--agent') {
      out.agent = rest[++i];
    } else if (a === '--limit') {
      const v = Number(rest[++i]);
      if (Number.isFinite(v) && v > 0) out.limit = Math.min(100, Math.floor(v));
    }
  }
  return out;
}

/**
 * Prisma の select 結果をアプリ層の PromptVersion(content 省略)に変換する。
 * CLI は content を表示しないため、PromptVersion の必須 `content` には空文字を入れる。
 * status / createdBy は string 幅だが、PromptRegistry の型(PromptStatus /
 * PromptCreatedBy)に narrowing しておく(未知値が来たら "experimental" / "human" に
 * フォールバックして CLI は落とさない)。
 */
function toDomain(row: PromptVersionRow): PromptVersion {
  return {
    id: row.id,
    agentName: row.agentName,
    version: row.version,
    content: '',
    parentVersionId: row.parentVersionId ?? undefined,
    createdBy: narrowCreatedBy(row.createdBy),
    status: narrowStatus(row.status),
    notes: row.notes ?? undefined,
    usageCount: row.usageCount,
    successCount: row.successCount,
    avgScore: row.avgScore,
    lastUsedAt: row.lastUsedAt ?? undefined,
    approvedAt: row.approvedAt ?? undefined,
    approvedBy: row.approvedBy ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const ALLOWED_STATUSES: PromptStatus[] = ['active', 'experimental', 'deprecated', 'rejected'];
const ALLOWED_CREATED_BY: PromptCreatedBy[] = ['human', 'mutation', 'meta_evolution'];

function narrowStatus(s: string): PromptStatus {
  return (ALLOWED_STATUSES as readonly string[]).includes(s)
    ? (s as PromptStatus)
    : 'experimental';
}

function narrowCreatedBy(s: string): PromptCreatedBy {
  return (ALLOWED_CREATED_BY as readonly string[]).includes(s)
    ? (s as PromptCreatedBy)
    : 'human';
}

// `PrismaPromptVersion` は Prisma 型の export エイリアス。現状未使用だが、
// 将来 content を含む行を扱う場合の型注釈用に保持する。
export type { PrismaPromptVersion };

export function formatRow(p: PromptVersion): string {
  const last = p.lastUsedAt ? p.lastUsedAt.toISOString() : '-';
  const success =
    p.usageCount > 0 ? ((p.successCount / p.usageCount) * 100).toFixed(1) + '%' : '-';
  return [
    p.agentName.padEnd(30),
    p.status.padEnd(13),
    p.version.padEnd(28),
    `usage=${String(p.usageCount).padStart(4)}`,
    `avg=${p.avgScore.toFixed(3)}`,
    `succ=${success.padStart(6)}`,
    `last=${last}`,
  ].join(' ');
}

export interface SummaryStats {
  n: number;
  totalUsage: number;
  weightedAvg: number;
  simpleAvg: number;
}

export function computeSummary(rows: PromptVersion[]): SummaryStats {
  if (rows.length === 0) return { n: 0, totalUsage: 0, weightedAvg: 0, simpleAvg: 0 };
  const totalUsage = rows.reduce((a, r) => a + r.usageCount, 0);
  const weightedAvg =
    totalUsage > 0
      ? rows.reduce((a, r) => a + r.avgScore * r.usageCount, 0) / totalUsage
      : 0;
  const simpleAvg = rows.reduce((a, r) => a + r.avgScore, 0) / rows.length;
  return { n: rows.length, totalUsage, weightedAvg, simpleAvg };
}

function summarize(rows: PromptVersion[], label: string): void {
  if (rows.length === 0) {
    console.log(`  ${label}: (データなし)`);
    return;
  }
  const totalUsage = rows.reduce((a, r) => a + r.usageCount, 0);
  const weightedScore =
    totalUsage > 0
      ? rows.reduce((a, r) => a + r.avgScore * r.usageCount, 0) / totalUsage
      : 0;
  const simpleAvg = rows.reduce((a, r) => a + r.avgScore, 0) / rows.length;
  console.log(
    `  ${label}: n=${rows.length}, totalUsage=${totalUsage}, weightedAvg=${weightedScore.toFixed(3)}, simpleAvg=${simpleAvg.toFixed(3)}`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const prisma = new PrismaClient();
  try {
    const where: Prisma.PromptVersionWhereInput = {};
    if (!args.all) {
      if (!args.agent) {
        console.error('Usage: --all か --agent <agentName> のいずれかを指定してください');
        // finally で prisma.$disconnect が走るよう exitCode + return にする
        // (process.exit(1) だと $disconnect がスキップされて接続リークする)
        process.exitCode = 1;
        return;
      }
      where.agentName = args.agent;
    }

    const rows = await prisma.promptVersion.findMany({
      where,
      orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
      take: args.limit,
      select: PROMPT_VERSION_SELECT,
    });
    const prompts = rows.map(toDomain);

    console.log('=== PromptVersion 最近の使用状況 ===');
    console.log(
      `フィルタ: ${args.all ? 'ALL' : `agentName=${args.agent}`}  limit=${args.limit}  取得=${prompts.length}`,
    );
    console.log('');
    if (prompts.length === 0) {
      console.log('(記録なし)');
      return;
    }
    for (const p of prompts) {
      console.log(formatRow(p));
    }

    // active vs experimental 比較
    console.log('');
    console.log('--- 集計 ---');
    const byAgent = new Map<string, PromptVersion[]>();
    for (const p of prompts) {
      const list = byAgent.get(p.agentName) ?? [];
      list.push(p);
      byAgent.set(p.agentName, list);
    }
    for (const [agentName, list] of byAgent) {
      console.log(`[${agentName}]`);
      summarize(
        list.filter((p) => p.status === 'active'),
        'active       ',
      );
      summarize(
        list.filter((p) => p.status === 'experimental'),
        'experimental ',
      );
      summarize(
        list.filter((p) => p.status === 'deprecated'),
        'deprecated   ',
      );
      summarize(
        list.filter((p) => p.status === 'rejected'),
        'rejected     ',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[showRecentScoring] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
