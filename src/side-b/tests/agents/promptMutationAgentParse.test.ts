/**
 * Phase 6 hotfix: PromptMutationAgent のパース堅牢化テスト
 *
 * 実 LLM 応答パターンを模したケースで `parseProposalArray` が壊れないことを検証。
 * AIProvider はモック、応答本文だけを操作する。
 */

import { PromptMutationAgent } from '../../agents/PromptMutationAgent';
import type { AIProvider } from '../../agent/aiProvider';
import type { PromptVersion } from '../../prompts/registry/types';

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

function currentPrompt(): PromptVersion {
  return {
    id: 'id-1',
    agentName: 'test_agent',
    version: '1.0.0',
    content: '# テストプロンプト',
    createdBy: 'human',
    status: 'active',
    usageCount: 10,
    successCount: 5,
    avgScore: 0.5,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('PromptMutationAgent parseProposalArray 堅牢化', () => {
  it('プレーン JSON 配列で、改善案 content 内に ```json を含むマークダウンが混入していてもパースできる', async () => {
    // Phase 6.5 手動トリガーで実際に発生したパターンの再現
    const response = JSON.stringify([
      {
        version: '1.1.0-mut-a',
        content:
          '# テストエージェント\n\n## 出力形式\n\n```json\n{"value": 1}\n```\n\n' + 'x'.repeat(60),
        notes: 'test',
        expectedImprovement: 'fmt',
      },
      {
        version: '1.1.0-mut-b',
        content: 'b'.repeat(100),
        notes: 'second',
      },
    ]);
    const agent = new PromptMutationAgent(mockAi(response));
    const result = await agent.proposeImprovements({
      agentName: 'test_agent',
      currentPrompt: currentPrompt(),
      recentPerformance: { avgScore: 0.5, recentFailures: [] },
      count: 2,
    });
    expect(result.length).toBe(2);
    expect(result[0]!.content).toContain('出力形式');
    expect(result[0]!.content).toContain('```json');
  });

  it('応答全体が ```json フェンスで囲まれていてもパースできる', async () => {
    const inner = JSON.stringify([
      { version: 'v1', content: 'a'.repeat(80), notes: 'x' },
    ]);
    const response = '```json\n' + inner + '\n```';
    const agent = new PromptMutationAgent(mockAi(response));
    const result = await agent.proposeImprovements({
      agentName: 'test_agent',
      currentPrompt: currentPrompt(),
      recentPerformance: { avgScore: 0.5, recentFailures: [] },
      count: 1,
    });
    expect(result.length).toBe(1);
  });

  it('前置き + JSON 配列の混在応答でも bracket 経路で parse できる', async () => {
    const inner = JSON.stringify([
      { version: 'v2', content: 'c'.repeat(100), notes: 'ok' },
    ]);
    const response = `以下が改善案です:\n\n${inner}\n\n以上です。`;
    const agent = new PromptMutationAgent(mockAi(response));
    const result = await agent.proposeImprovements({
      agentName: 'test_agent',
      currentPrompt: currentPrompt(),
      recentPerformance: { avgScore: 0.5, recentFailures: [] },
      count: 1,
    });
    expect(result.length).toBe(1);
  });

  it('応答が途中で切れて Unterminated になったら空配列を返す(例外を投げない)', async () => {
    const truncated = '[{"version":"v1","content":"a'.padEnd(80, 'a');
    const agent = new PromptMutationAgent(mockAi(truncated));
    const result = await agent.proposeImprovements({
      agentName: 'test_agent',
      currentPrompt: currentPrompt(),
      recentPerformance: { avgScore: 0.5, recentFailures: [] },
      count: 1,
    });
    expect(result).toEqual([]);
  });

  it('content が 50 文字未満の提案は除外される', async () => {
    const response = JSON.stringify([
      { version: 'v1', content: 'short', notes: 'too short' },
      { version: 'v2', content: 'ok'.repeat(40), notes: 'ok' },
    ]);
    const agent = new PromptMutationAgent(mockAi(response));
    const result = await agent.proposeImprovements({
      agentName: 'test_agent',
      currentPrompt: currentPrompt(),
      recentPerformance: { avgScore: 0.5, recentFailures: [] },
      count: 2,
    });
    expect(result.length).toBe(1);
    expect(result[0]!.version).toBe('v2');
  });
});
