/**
 * Phase 6 hotfix: MetaEvolutionAgent のパース堅牢化テスト
 *
 * 実 LLM 応答パターンを模したケースで `parseProposalJson` が壊れないことを検証。
 */

import { MetaEvolutionAgent } from '../../agents/MetaEvolutionAgent';
import type { AIProvider } from '../../agent/aiProvider';

function mockAi(response: string): AIProvider {
  return {
    chat: jest.fn(async () => ({
      content: response,
      toolCalls: [],
      tokenUsage: 10,
      model: 'mock',
      finishReason: 'stop',
    })),
  } as unknown as AIProvider;
}

// PromptRegistry を使うため Prisma fake を最小で用意
function makeFakePrisma() {
  const rows: any[] = [];
  const fake: any = {
    promptVersion: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `pv-${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      }),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    agentRestructureProposal: {
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(async () => []),
      update: jest.fn(),
    },
  };
  fake.$transaction = jest.fn(async (fn: any) => fn(fake));
  return fake;
}

const VALID_RESTRUCTURE = {
  analysis: {
    currentAgents: ['hypothesis_generator'],
    coverageGaps: ['time_session 専門家が不在'],
    underperformers: [],
  },
  proposals: [
    {
      type: 'add',
      agentName: 'session_specialist',
      role: 'time_session 解釈',
      reasoning: 'DiscoveryReport で頻出',
      expectedImprovement: '仮説 avgScore 向上',
      initialPrompt:
        '# SessionSpecialist\n\nあなたは time_session レンズの専門家です。'.padEnd(100, ' '),
    },
  ],
  confidence: 0.6,
};

describe('MetaEvolutionAgent parseProposalJson 堅牢化', () => {
  it('```json フェンスで包まれた応答を parse できる', async () => {
    const response = '```json\n' + JSON.stringify(VALID_RESTRUCTURE) + '\n```';
    const agent = new MetaEvolutionAgent({ ai: mockAi(response), prisma: makeFakePrisma() });
    const p = await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    });
    expect(p).not.toBeNull();
    expect(p!.proposals.length).toBe(1);
    expect(p!.proposals[0]!.type).toBe('add');
  });

  it('プレーン JSON (フェンスなし) 応答も parse できる', async () => {
    const response = JSON.stringify(VALID_RESTRUCTURE);
    const agent = new MetaEvolutionAgent({ ai: mockAi(response), prisma: makeFakePrisma() });
    const p = await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    });
    expect(p).not.toBeNull();
  });

  it('前置き + JSON の混在応答も bracket 経路で parse できる', async () => {
    const response = `以下が提案です:\n\n${JSON.stringify(VALID_RESTRUCTURE)}\n\n以上です。`;
    const agent = new MetaEvolutionAgent({ ai: mockAi(response), prisma: makeFakePrisma() });
    const p = await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    });
    expect(p).not.toBeNull();
  });

  it('max_tokens 切断で Unterminated string になったら null を返す(例外を投げない)', async () => {
    const truncated = '```json\n{"analysis":{"currentAgents":["x"],"coverageGaps":["y"';
    const agent = new MetaEvolutionAgent({ ai: mockAi(truncated), prisma: makeFakePrisma() });
    const p = await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    });
    expect(p).toBeNull();
  });

  it('JSON として成立しない応答でも null (例外を投げない)', async () => {
    const bad = 'すみません、よくわかりませんでした。';
    const agent = new MetaEvolutionAgent({ ai: mockAi(bad), prisma: makeFakePrisma() });
    const p = await agent.propose({
      recentPerformance: [],
      recentDiscoveryReports: [],
      recentReflections: [],
    });
    expect(p).toBeNull();
  });
});
