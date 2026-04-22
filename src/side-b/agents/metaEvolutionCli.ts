/**
 * Phase 6: MetaEvolutionAgent 承認 CLI
 *
 * 手動トリガー専用(自動スケジューラー統合は絶対にしない § §3.3.3)。
 *
 * 使い方:
 *   npx ts-node src/side-b/agents/metaEvolutionCli.ts propose
 *   npx ts-node src/side-b/agents/metaEvolutionCli.ts list [--status pending]
 *   npx ts-node src/side-b/agents/metaEvolutionCli.ts show <proposalId>
 *   npx ts-node src/side-b/agents/metaEvolutionCli.ts approve <proposalId> --by <name> [--notes <text>]
 *   npx ts-node src/side-b/agents/metaEvolutionCli.ts reject  <proposalId> --by <name> --notes <reason>
 *
 * `propose` は recentPerformance / recentDiscoveryReports / recentReflections
 * を DB / ファイルから収集するロジックを呼ぶ雛形で、現状は空入力で LLM を呼ぶ。
 * 実運用では各ソースの集計関数を差し込む(Step 5 で接続の余地あり)。
 */

import { PrismaClient } from '@prisma/client';
import { MetaEvolutionAgent } from './MetaEvolutionAgent';

interface Args {
  sub: string;
  positional: string[];
  options: Record<string, string>;
}

function parse(argv: string[]): Args {
  const [, , sub, ...rest] = argv;
  const positional: string[] = [];
  const options: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a) continue;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = 'true';
      }
    } else {
      positional.push(a);
    }
  }
  return { sub: sub ?? '', positional, options };
}

async function cmdPropose(agent: MetaEvolutionAgent): Promise<void> {
  // MVP: 空の入力で LLM を呼ぶ。運用では Reflection/Discovery/PromptRegistry から集計して渡す
  const proposal = await agent.propose({
    recentPerformance: [],
    recentDiscoveryReports: [],
    recentReflections: [],
  });
  if (!proposal) {
    console.error('[meta-evolve] 提案の生成に失敗しました');
    process.exitCode = 2;
    return;
  }
  const id = await agent.recordProposal(proposal);
  console.log(
    JSON.stringify(
      {
        proposalId: id,
        confidence: proposal.confidence,
        proposals: proposal.proposals.map((p) => ({
          type: p.type,
          agentName: p.agentName,
          role: p.role,
        })),
      },
      null,
      2,
    ),
  );
}

async function cmdList(prisma: PrismaClient, status?: string): Promise<void> {
  const rows = await prisma.agentRestructureProposal.findMany({
    where: status ? { status } : undefined,
    orderBy: { proposedAt: 'desc' },
    take: 20,
  });
  console.log(
    JSON.stringify(
      rows.map((r) => ({
        id: r.id,
        status: r.status,
        confidence: r.confidence,
        proposedAt: r.proposedAt,
        approvedBy: r.approvedBy,
      })),
      null,
      2,
    ),
  );
}

async function cmdShow(prisma: PrismaClient, id: string): Promise<void> {
  const row = await prisma.agentRestructureProposal.findUnique({ where: { id } });
  if (!row) {
    console.error(`not found: ${id}`);
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify(row, null, 2));
}

async function cmdApprove(
  agent: MetaEvolutionAgent,
  id: string,
  by?: string,
  notes?: string,
): Promise<void> {
  if (!by) throw new Error('--by is required for approve');
  const result = await agent.executeProposal(id, {
    approvedBy: by,
    approvedAt: new Date(),
    notes,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdReject(
  agent: MetaEvolutionAgent,
  id: string,
  by?: string,
  notes?: string,
): Promise<void> {
  if (!by) throw new Error('--by is required for reject');
  if (!notes) throw new Error('--notes is required for reject');
  await agent.rejectProposal(id, {
    approvedBy: by,
    approvedAt: new Date(),
    notes,
  });
  console.log(JSON.stringify({ rejected: id }, null, 2));
}

async function main(): Promise<void> {
  const args = parse(process.argv);
  const prisma = new PrismaClient();
  const agent = new MetaEvolutionAgent({ prisma });

  switch (args.sub) {
    case 'propose':
      await cmdPropose(agent);
      break;
    case 'list':
      await cmdList(prisma, args.options.status);
      break;
    case 'show':
      await cmdShow(prisma, args.positional[0] ?? '');
      break;
    case 'approve':
      await cmdApprove(agent, args.positional[0] ?? '', args.options.by, args.options.notes);
      break;
    case 'reject':
      await cmdReject(agent, args.positional[0] ?? '', args.options.by, args.options.notes);
      break;
    default:
      console.error(
        'Usage:\n  propose\n  list [--status <state>]\n  show <proposalId>\n  approve <proposalId> --by <name> [--notes <text>]\n  reject <proposalId> --by <name> --notes <reason>',
      );
      process.exitCode = 1;
  }
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('[meta-evolve] failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    })
    .finally(() => {
      process.exit(process.exitCode ?? 0);
    });
}
