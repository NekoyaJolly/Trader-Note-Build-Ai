/**
 * Phase 6.7a: __global__ 変異・再編成ガードのテスト
 *
 * - PromptMutationAgent.proposeImprovements が __global__ を受け取ったら空配列
 * - MetaEvolutionAgent.executeProposal が __global__ 対象の提案を skipped に回す
 * - promptEvolutionJob が listAgents から __global__ を除外する
 */

import type { PrismaClient } from '@prisma/client';
import { PromptMutationAgent } from '../../agents/PromptMutationAgent';
import {
  MetaEvolutionAgent,
  type AgentRestructureProposal,
} from '../../agents/MetaEvolutionAgent';
import { runPromptEvolutionCycle } from '../../prompts/registry/promptEvolutionJob';
import {
  PromptRegistry,
  GLOBAL_AGENT_NAME,
  SPECIALIST_COMMON_AGENT_NAME,
} from '../../prompts/registry/PromptRegistry';
import type { AIProvider, AIResponse } from '../../agent/aiProvider';

/**
 * 本テストで必要な最小 AIProvider モック型。
 * `chat` のみを持たせ、未使用メソッドは型で縛って誤用を防ぐ。
 */
type AIProviderChatMock = Pick<AIProvider, 'chat'>;

function mockAi(response: string): AIProvider {
  const aiResponse: AIResponse = {
    content: response,
    toolCalls: [],
    tokenUsage: 5,
    model: 'mock',
    finishReason: 'stop',
  };
  const mock: AIProviderChatMock = {
    chat: jest.fn(async () => aiResponse),
  };
  // Pick<> で最小契約を縛ったうえで、注入境界のみ cast(chat 以外は未使用が型で保証済み)
  return mock as AIProvider;
}

// --------- Prisma 型付きスタブ ---------

interface FakePromptRow {
  id: string;
  agentName: string;
  version: string;
  content: string;
  parentVersionId: string | null;
  createdBy: string;
  status: string;
  notes: string | null;
  usageCount: number;
  successCount: number;
  avgScore: number;
  lastUsedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeProposalRow {
  id: string;
  [key: string]: unknown;
  status: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  approvalNotes: string | null;
  executionResult: unknown;
  executedAt: Date | null;
  proposedAt: Date;
  updatedAt: Date;
}

interface PromptCreateArgs {
  data: Partial<FakePromptRow> & {
    agentName: string;
    version: string;
    content: string;
    createdBy: string;
  };
}
interface FindFirstArgs { where: { agentName: string; status: string } }
interface FindManyArgs { distinct?: string[] }
interface FindByIdArgs { where: { id: string } }
interface UpdateArgs { where: { id: string }; data: Partial<FakePromptRow> }
interface ProposalCreateArgs { data: Partial<FakeProposalRow> }
interface ProposalUpdateArgs { where: { id: string }; data: Partial<FakeProposalRow> }

interface FakePromptVersionDelegate {
  create: jest.Mock<Promise<FakePromptRow>, [PromptCreateArgs]>;
  findFirst: jest.Mock<Promise<FakePromptRow | null>, [FindFirstArgs]>;
  findMany: jest.Mock<Promise<Partial<FakePromptRow>[]>, [FindManyArgs?]>;
  findUnique: jest.Mock;
  findUniqueOrThrow: jest.Mock<Promise<FakePromptRow>, [FindByIdArgs]>;
  update: jest.Mock<Promise<FakePromptRow>, [UpdateArgs]>;
  updateMany: jest.Mock;
}

interface FakeProposalDelegate {
  create: jest.Mock<Promise<FakeProposalRow>, [ProposalCreateArgs]>;
  findUniqueOrThrow: jest.Mock<Promise<FakeProposalRow>, [FindByIdArgs]>;
  findMany: jest.Mock<Promise<FakeProposalRow[]>, []>;
  update: jest.Mock<Promise<FakeProposalRow>, [ProposalUpdateArgs]>;
}

interface FakePrismaStub {
  promptVersion: FakePromptVersionDelegate;
  agentRestructureProposal: FakeProposalDelegate;
  $transaction: jest.Mock<Promise<unknown>, [(tx: FakePrismaStub) => Promise<unknown>]>;
}

function makeFakePrisma(): {
  fake: FakePrismaStub;
  promptRows: FakePromptRow[];
  proposalRows: FakeProposalRow[];
} {
  const promptRows: FakePromptRow[] = [];
  const proposalRows: FakeProposalRow[] = [];
  let id = 0;

  const promptVersion: FakePromptVersionDelegate = {
    create: jest.fn(async ({ data }: PromptCreateArgs) => {
      id++;
      const row: FakePromptRow = {
        id: `pv-${id}`,
        agentName: data.agentName,
        version: data.version,
        content: data.content,
        parentVersionId: data.parentVersionId ?? null,
        createdBy: data.createdBy,
        status: data.status ?? 'experimental',
        notes: data.notes ?? null,
        usageCount: 0,
        successCount: 0,
        avgScore: 0,
        lastUsedAt: null,
        approvedAt: null,
        approvedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      promptRows.push(row);
      return { ...row };
    }),
    findFirst: jest.fn(async ({ where }: FindFirstArgs) => {
      const r = promptRows.find(
        (x) => x.agentName === where.agentName && x.status === where.status,
      );
      return r ? { ...r } : null;
    }),
    findMany: jest.fn(async ({ distinct }: FindManyArgs = {}) => {
      if (distinct?.includes('agentName')) {
        const seen = new Set<string>();
        return promptRows
          .filter((r) => (seen.has(r.agentName) ? false : (seen.add(r.agentName), true)))
          .map((r) => ({ agentName: r.agentName }));
      }
      return promptRows.map((r) => ({ ...r }));
    }),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(async ({ where }: FindByIdArgs) => {
      const r = promptRows.find((x) => x.id === where.id);
      if (!r) throw new Error('not found');
      return { ...r };
    }),
    update: jest.fn(async ({ where, data }: UpdateArgs) => {
      const i = promptRows.findIndex((r) => r.id === where.id);
      promptRows[i] = { ...promptRows[i], ...data };
      return { ...promptRows[i] };
    }),
    updateMany: jest.fn(),
  };

  const agentRestructureProposal: FakeProposalDelegate = {
    create: jest.fn(async ({ data }: ProposalCreateArgs) => {
      id++;
      const row: FakeProposalRow = {
        id: `arp-${id}`,
        ...data,
        status: data.status ?? 'pending',
        approvedBy: null,
        approvedAt: null,
        approvalNotes: null,
        executionResult: null,
        executedAt: null,
        proposedAt: new Date(),
        updatedAt: new Date(),
      };
      proposalRows.push(row);
      return { ...row };
    }),
    findUniqueOrThrow: jest.fn(async ({ where }: FindByIdArgs) => {
      const r = proposalRows.find((x) => x.id === where.id);
      if (!r) throw new Error('not found');
      return { ...r };
    }),
    findMany: jest.fn(async () => []),
    update: jest.fn(async ({ where, data }: ProposalUpdateArgs) => {
      const i = proposalRows.findIndex((r) => r.id === where.id);
      proposalRows[i] = { ...proposalRows[i], ...data };
      return { ...proposalRows[i] };
    }),
  };

  const fake: FakePrismaStub = {
    promptVersion,
    agentRestructureProposal,
    $transaction: jest.fn(async (fn) => fn(fake)),
  };

  return { fake, promptRows, proposalRows };
}

/**
 * FakePrismaStub を PromptRegistry / MetaEvolutionAgent に注入するための境界 cast。
 * 本テストで使うメソッドだけを FakePrismaStub で完全型付けしており、
 * unknown 経由の二重 cast は行わない(構造的互換を利用した単純な assignability 調整のみ)。
 */
function asPrisma(stub: FakePrismaStub): PrismaClient {
  return stub as unknown as PrismaClient;
}

describe('PromptMutationAgent.proposeImprovements __global__ ガード', () => {
  it('agentName === __global__ の入力に対して空配列を返す(LLM 呼ばず)', async () => {
    const ai = mockAi('[{"version":"v1","content":"x".repeat(80),"notes":"ok"}]');
    const agent = new PromptMutationAgent(ai);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await agent.proposeImprovements({
      agentName: GLOBAL_AGENT_NAME,
      currentPrompt: {
        id: 'g1',
        agentName: GLOBAL_AGENT_NAME,
        version: 'initial',
        content: '# Global',
        createdBy: 'human',
        status: 'active',
        usageCount: 0,
        successCount: 0,
        avgScore: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      recentPerformance: { avgScore: 0, recentFailures: [] },
      count: 3,
    });
    expect(result).toEqual([]);
    expect(ai.chat).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('agentName === __specialist_common__ も変異対象外(空配列)', async () => {
    const ai = mockAi('[{"version":"v1","content":"x".repeat(80),"notes":"ok"}]');
    const agent = new PromptMutationAgent(ai);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await agent.proposeImprovements({
      agentName: SPECIALIST_COMMON_AGENT_NAME,
      currentPrompt: {
        id: 's1',
        agentName: SPECIALIST_COMMON_AGENT_NAME,
        version: 'initial',
        content: '# Common',
        createdBy: 'human',
        status: 'active',
        usageCount: 0,
        successCount: 0,
        avgScore: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      recentPerformance: { avgScore: 0, recentFailures: [] },
      count: 3,
    });
    expect(result).toEqual([]);
    expect(ai.chat).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('通常の agentName では従来通り LLM を呼ぶ', async () => {
    const response = JSON.stringify([
      { version: 'v1', content: 'a'.repeat(80), notes: 'ok' },
    ]);
    const ai = mockAi(response);
    const agent = new PromptMutationAgent(ai);
    const result = await agent.proposeImprovements({
      agentName: 'trend_specialist',
      currentPrompt: {
        id: 'l1',
        agentName: 'trend_specialist',
        version: 'initial',
        content: '# Local',
        createdBy: 'human',
        status: 'active',
        usageCount: 0,
        successCount: 0,
        avgScore: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      recentPerformance: { avgScore: 0, recentFailures: [] },
      count: 1,
    });
    expect(result.length).toBe(1);
    expect(ai.chat).toHaveBeenCalled();
  });
});

describe('MetaEvolutionAgent.executeProposal __global__ ガード', () => {
  it('__global__ を対象にした提案は type に関わらず skipped', async () => {
    const { fake } = makeFakePrisma();
    const json = JSON.stringify({
      analysis: { currentAgents: [], coverageGaps: [], underperformers: [] },
      proposals: [
        {
          type: 'add',
          agentName: GLOBAL_AGENT_NAME,
          role: '新しいグローバル',
          reasoning: 'LLM が書いた謎の理由',
          expectedImprovement: '+X',
          initialPrompt: 'a'.repeat(100),
        },
        {
          type: 'modify',
          agentName: GLOBAL_AGENT_NAME,
          role: 'update',
          reasoning: 'LLM が変更したがっている',
          expectedImprovement: '+Y',
        },
        {
          type: 'deprecate',
          agentName: GLOBAL_AGENT_NAME,
          role: 'kill',
          reasoning: 'LLM が消したがっている',
          expectedImprovement: 'スリム化',
        },
      ],
      confidence: 0.5,
    });
    const agent = new MetaEvolutionAgent({ ai: mockAi(json), prisma: asPrisma(fake) });
    const p = (await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    })) as AgentRestructureProposal;
    const id = await agent.recordProposal(p);
    const result = await agent.executeProposal(id, {
      approvedBy: 'neko',
      approvedAt: new Date(),
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped.length).toBe(3);
    for (const s of result.skipped) {
      expect(s.reason).toContain('グローバルルール予約識別子');
    }
  });
});

describe('promptEvolutionJob.runPromptEvolutionCycle __global__ 除外', () => {
  it('listAgents に __global__ があっても進化サイクルの対象外', async () => {
    const { fake } = makeFakePrisma();
    const registry = new PromptRegistry(asPrisma(fake));
    await registry.register({
      agentName: GLOBAL_AGENT_NAME,
      version: 'initial',
      content: '# Global',
      createdBy: 'human',
      status: 'active',
    });
    await registry.register({
      agentName: 'strategy_thinker',
      version: 'initial',
      content: '# Local',
      createdBy: 'human',
      status: 'active',
    });

    // runPromptEvolutionCycle が期待するインターフェースのうち、本テストで必要な
    // proposeImprovements のみを型で縛る(未使用メソッドの誤用はコンパイル時に検出される)。
    type MutationAgentStub = Pick<PromptMutationAgent, 'proposeImprovements'>;
    const mutationAgentStub: MutationAgentStub = {
      proposeImprovements: jest.fn(async () => []),
    };

    const res = await runPromptEvolutionCycle({
      registry,
      mutationAgent: mutationAgentStub as PromptMutationAgent,
      proposalsPerAgent: 1,
    });
    const names = res.reports.map((r) => r.agentName);
    expect(names).not.toContain(GLOBAL_AGENT_NAME);
    expect(names).toContain('strategy_thinker');
  });
});
