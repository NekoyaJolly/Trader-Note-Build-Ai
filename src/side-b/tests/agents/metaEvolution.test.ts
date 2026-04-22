/**
 * Phase 6: MetaEvolutionAgent のユニットテスト
 *
 * - LLM 出力のバリデーション (型 / initialPrompt 必須チェック)
 * - executeProposal の安全装置
 *   - deprecate は自動実行しない
 *   - modify はスキップ
 *   - add は MONTHLY_ADD_LIMIT で制限
 * - 実行結果が DB に記録される
 */

import {
  MetaEvolutionAgent,
  MONTHLY_ADD_LIMIT,
  type AgentRestructureProposal,
} from '../../agents/MetaEvolutionAgent';
import type { AIProvider } from '../../agent/aiProvider';

function mockAi(response: string): AIProvider {
  return {
    chat: jest.fn(async () => ({
      content: response,
      toolCalls: [],
      tokenUsage: 5,
      model: 'mock',
      finishReason: 'stop',
    })),
  } as unknown as AIProvider;
}

/** Prisma を PromptRegistry と AgentRestructureProposal 向けに両方 in-memory で模倣する。 */
function makeFakePrisma() {
  const promptRows: any[] = [];
  let promptId = 0;
  const proposalRows: any[] = [];
  let proposalId = 0;

  const promptVersion = {
    create: jest.fn(async ({ data }: any) => {
      promptId++;
      const row = {
        id: `pv-${promptId}`,
        ...data,
        usageCount: 0,
        successCount: 0,
        avgScore: 0,
        parentVersionId: data.parentVersionId ?? null,
        notes: data.notes ?? null,
        status: data.status ?? 'experimental',
        lastUsedAt: null,
        approvedAt: null,
        approvedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      promptRows.push(row);
      return { ...row };
    }),
    findFirst: jest.fn(async ({ where }: any) => {
      const r = promptRows.find(
        (x) => x.agentName === where.agentName && x.status === where.status,
      );
      return r ? { ...r } : null;
    }),
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(async () => null),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => {
      const r = promptRows.find((x) => x.id === where.id);
      if (!r) throw new Error('not found');
      return { ...r };
    }),
    update: jest.fn(),
    updateMany: jest.fn(),
  };

  const agentRestructureProposal = {
    create: jest.fn(async ({ data }: any) => {
      proposalId++;
      const row = {
        id: `arp-${proposalId}`,
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
    findUniqueOrThrow: jest.fn(async ({ where }: any) => {
      const r = proposalRows.find((x) => x.id === where.id);
      if (!r) throw new Error('not found');
      return { ...r };
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const r = proposalRows.find((x) => x.id === where.id);
      return r ? { ...r } : null;
    }),
    findMany: jest.fn(async ({ where, select }: any) => {
      let out = [...proposalRows];
      if (where?.status) out = out.filter((r) => r.status === where.status);
      if (where?.executedAt?.gte) out = out.filter((r) => r.executedAt && r.executedAt >= where.executedAt.gte);
      if (select) {
        return out.map((r) => {
          const o: any = {};
          for (const k of Object.keys(select)) o[k] = r[k];
          return o;
        });
      }
      return out.map((r) => ({ ...r }));
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const i = proposalRows.findIndex((r) => r.id === where.id);
      proposalRows[i] = { ...proposalRows[i], ...data, updatedAt: new Date() };
      return { ...proposalRows[i] };
    }),
  };

  const fake: any = {
    promptVersion,
    agentRestructureProposal,
  };
  fake.$transaction = jest.fn(async (fn: any) => fn(fake));
  return { fake, promptRows, proposalRows };
}

const VALID_PROPOSAL_JSON = JSON.stringify({
  analysis: {
    currentAgents: ['hypothesis_generator', 'trend_specialist'],
    coverageGaps: ['time_session 専門家が不在'],
    underperformers: [],
  },
  proposals: [
    {
      type: 'add',
      agentName: 'session_specialist',
      role: 'time_session レンズを専門に解釈',
      reasoning: 'Discovery レポートで time_session が頻出',
      expectedImprovement: '時間帯仮説の avgScore が向上',
      initialPrompt:
        '# SessionSpecialist システムプロンプト\n\nあなたは time_session レンズを専門に解釈します。'.padEnd(
          100,
          ' ',
        ),
    },
  ],
  confidence: 0.6,
});

describe('MetaEvolutionAgent.propose', () => {
  it('正規 JSON を解釈して AgentRestructureProposal を返す', async () => {
    const { fake } = makeFakePrisma();
    const agent = new MetaEvolutionAgent({
      ai: mockAi(VALID_PROPOSAL_JSON),
      prisma: fake,
    });
    const p = await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    });
    expect(p).not.toBeNull();
    expect(p!.analysis.currentAgents).toEqual(['hypothesis_generator', 'trend_specialist']);
    expect(p!.proposals.length).toBe(1);
    expect(p!.proposals[0]!.type).toBe('add');
    expect(p!.proposals[0]!.initialPrompt).toBeDefined();
  });

  it('initialPrompt が空の add 提案は弾く', async () => {
    const { fake } = makeFakePrisma();
    const bad = JSON.stringify({
      analysis: { currentAgents: [], coverageGaps: [], underperformers: [] },
      proposals: [
        { type: 'add', agentName: 'x', role: 'r', reasoning: '', expectedImprovement: '' }, // initialPrompt なし
      ],
      confidence: 0.5,
    });
    const agent = new MetaEvolutionAgent({ ai: mockAi(bad), prisma: fake });
    const p = await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    });
    expect(p!.proposals.length).toBe(0);
  });

  it('パース不能応答は null', async () => {
    const { fake } = makeFakePrisma();
    const agent = new MetaEvolutionAgent({ ai: mockAi('no json'), prisma: fake });
    const p = await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    });
    expect(p).toBeNull();
  });
});

describe('MetaEvolutionAgent.recordProposal', () => {
  it('提案を DB に pending で保存する', async () => {
    const { fake, proposalRows } = makeFakePrisma();
    const agent = new MetaEvolutionAgent({
      ai: mockAi(VALID_PROPOSAL_JSON),
      prisma: fake,
    });
    const p = (await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    })) as AgentRestructureProposal;
    const id = await agent.recordProposal(p);
    expect(id).toBeTruthy();
    expect(proposalRows.length).toBe(1);
    expect(proposalRows[0]!.status).toBe('pending');
  });
});

describe('MetaEvolutionAgent.executeProposal 安全装置', () => {
  it('add 提案が active 登録される + 実行結果が DB に保存される', async () => {
    const { fake, proposalRows, promptRows } = makeFakePrisma();
    const agent = new MetaEvolutionAgent({
      ai: mockAi(VALID_PROPOSAL_JSON),
      prisma: fake,
    });
    const p = (await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    }))!;
    const id = await agent.recordProposal(p);
    const result = await agent.executeProposal(id, {
      approvedBy: 'neko',
      approvedAt: new Date(),
      notes: 'ok',
    });
    expect(result.applied).toEqual(['session_specialist']);
    expect(result.skipped.length).toBe(0);
    expect(proposalRows[0]!.status).toBe('executed');
    expect(proposalRows[0]!.approvedBy).toBe('neko');
    expect(promptRows.filter((r) => r.agentName === 'session_specialist' && r.status === 'active').length).toBe(1);
  });

  it('deprecate / modify 提案は全て skipped に回される', async () => {
    const { fake } = makeFakePrisma();
    const json = JSON.stringify({
      analysis: { currentAgents: [], coverageGaps: [], underperformers: [] },
      proposals: [
        {
          type: 'deprecate',
          agentName: 'old_agent',
          role: '旧機能',
          reasoning: '成績不振',
          expectedImprovement: 'エージェント減らして見通しよく',
        },
        {
          type: 'modify',
          agentName: 'trend_specialist',
          role: '拡張',
          reasoning: 'プロンプト改善',
          expectedImprovement: '+X%',
        },
      ],
      confidence: 0.5,
    });
    const agent = new MetaEvolutionAgent({ ai: mockAi(json), prisma: fake });
    const p = (await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    }))!;
    const id = await agent.recordProposal(p);
    const result = await agent.executeProposal(id, {
      approvedBy: 'neko',
      approvedAt: new Date(),
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped.length).toBe(2);
    expect(result.skipped.some((s) => s.proposal.type === 'deprecate')).toBe(true);
    expect(result.skipped.some((s) => s.proposal.type === 'modify')).toBe(true);
  });

  it(`add は月あたり ${MONTHLY_ADD_LIMIT} 件まで`, async () => {
    const { fake, proposalRows } = makeFakePrisma();
    const json = JSON.stringify({
      analysis: { currentAgents: [], coverageGaps: [], underperformers: [] },
      proposals: [
        {
          type: 'add',
          agentName: 'agent_a',
          role: 'ra',
          reasoning: '理由 A',
          expectedImprovement: '+x',
          initialPrompt: 'a'.repeat(100),
        },
        {
          type: 'add',
          agentName: 'agent_b',
          role: 'rb',
          reasoning: '理由 B',
          expectedImprovement: '+y',
          initialPrompt: 'b'.repeat(100),
        },
      ],
      confidence: 0.7,
    });
    const agent = new MetaEvolutionAgent({ ai: mockAi(json), prisma: fake });
    const p = (await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    }))!;
    const id = await agent.recordProposal(p);
    const result = await agent.executeProposal(id, {
      approvedBy: 'neko',
      approvedAt: new Date(),
    });
    expect(result.applied.length).toBe(MONTHLY_ADD_LIMIT);
    expect(result.skipped.some((s) => s.reason.includes('月あたり追加上限'))).toBe(true);
  });

  it('既に executed の提案を再実行しようとすると例外', async () => {
    const { fake } = makeFakePrisma();
    const agent = new MetaEvolutionAgent({
      ai: mockAi(VALID_PROPOSAL_JSON),
      prisma: fake,
    });
    const p = (await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    }))!;
    const id = await agent.recordProposal(p);
    await agent.executeProposal(id, { approvedBy: 'a', approvedAt: new Date() });
    await expect(
      agent.executeProposal(id, { approvedBy: 'a', approvedAt: new Date() }),
    ).rejects.toThrow(/既に処理済み/);
  });
});

describe('MetaEvolutionAgent.rejectProposal', () => {
  it('rejected ステータスに遷移する', async () => {
    const { fake, proposalRows } = makeFakePrisma();
    const agent = new MetaEvolutionAgent({
      ai: mockAi(VALID_PROPOSAL_JSON),
      prisma: fake,
    });
    const p = (await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    }))!;
    const id = await agent.recordProposal(p);
    await agent.rejectProposal(id, {
      approvedBy: 'neko',
      approvedAt: new Date(),
      notes: 'やりません',
    });
    expect(proposalRows[0]!.status).toBe('rejected');
    expect(proposalRows[0]!.approvalNotes).toBe('やりません');
  });
});
