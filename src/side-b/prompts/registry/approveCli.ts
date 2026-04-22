/**
 * Phase 6: プロンプト承認 CLI
 *
 * 実験プロンプトを人間の判断で active に昇格するための CLI。
 * 月次プロンプト進化ジョブが生成した experimental を審査する用途で使う。
 *
 * 使い方:
 *   npx ts-node src/side-b/prompts/registry/approveCli.ts list <agentName>
 *   npx ts-node src/side-b/prompts/registry/approveCli.ts show <versionId>
 *   npx ts-node src/side-b/prompts/registry/approveCli.ts promote <versionId> --by <name> [--notes <text>]
 *   npx ts-node src/side-b/prompts/registry/approveCli.ts reject  <versionId> --reason <text>
 *
 * 設計:
 * - CLI は人間専用。LLM エージェントから直接呼び出さない(破壊的変更の承認は必ず人間)
 * - 結果は stdout に JSON ライク、エラーは stderr
 * - Q4 回答: UI は運用観察後、今フェーズでは CLI のみ
 */

import { PromptRegistry } from './PromptRegistry';

interface ParsedArgs {
  subcommand: string;
  positional: string[];
  options: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [, , subcommand, ...rest] = argv;
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
  return { subcommand: subcommand ?? '', positional, options };
}

async function cmdList(registry: PromptRegistry, agentName: string): Promise<void> {
  if (!agentName) throw new Error('agentName is required');
  const experimentals = await registry.getExperimental(agentName);
  const active = await registry.getActive(agentName);
  console.log(JSON.stringify(
    {
      agentName,
      active: active
        ? {
            id: active.id,
            version: active.version,
            avgScore: active.avgScore,
            usageCount: active.usageCount,
          }
        : null,
      experimentals: experimentals.map((e) => ({
        id: e.id,
        version: e.version,
        avgScore: e.avgScore,
        usageCount: e.usageCount,
        successCount: e.successCount,
        createdBy: e.createdBy,
        notes: e.notes,
      })),
    },
    null,
    2,
  ));
}

async function cmdShow(registry: PromptRegistry, versionId: string): Promise<void> {
  if (!versionId) throw new Error('versionId is required');
  const v = await registry.getById(versionId);
  if (!v) {
    console.error(`not found: ${versionId}`);
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify(v, null, 2));
}

async function cmdPromote(
  registry: PromptRegistry,
  versionId: string,
  by: string | undefined,
  notes: string | undefined,
): Promise<void> {
  if (!versionId) throw new Error('versionId is required');
  if (!by) throw new Error('--by <name> is required for promote');
  const promoted = await registry.promote(versionId, { approvedBy: by, notes });
  console.log(
    JSON.stringify(
      {
        promoted: {
          id: promoted.id,
          agentName: promoted.agentName,
          version: promoted.version,
          status: promoted.status,
          approvedBy: promoted.approvedBy,
          approvedAt: promoted.approvedAt,
        },
      },
      null,
      2,
    ),
  );
}

async function cmdReject(
  registry: PromptRegistry,
  versionId: string,
  reason: string | undefined,
): Promise<void> {
  if (!versionId) throw new Error('versionId is required');
  if (!reason) throw new Error('--reason <text> is required for reject');
  const r = await registry.reject(versionId, reason);
  console.log(
    JSON.stringify(
      {
        rejected: {
          id: r.id,
          agentName: r.agentName,
          version: r.version,
          status: r.status,
          notes: r.notes,
        },
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const { subcommand, positional, options } = parseArgs(process.argv);
  const registry = new PromptRegistry();

  switch (subcommand) {
    case 'list':
      await cmdList(registry, positional[0] ?? '');
      break;
    case 'show':
      await cmdShow(registry, positional[0] ?? '');
      break;
    case 'promote':
      await cmdPromote(registry, positional[0] ?? '', options.by, options.notes);
      break;
    case 'reject':
      await cmdReject(registry, positional[0] ?? '', options.reason);
      break;
    default:
      console.error(
        'Usage:\n  list <agentName>\n  show <versionId>\n  promote <versionId> --by <name> [--notes <text>]\n  reject <versionId> --reason <text>',
      );
      process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[approveCli] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
