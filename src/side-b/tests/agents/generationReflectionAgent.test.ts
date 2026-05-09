/**
 * Filter Evolution Phase D-1b: GenerationReflectionAgent 単体テスト
 *
 * AIProvider をモックし、reflect() の各経路を検証する:
 * - 正常な LLM 応答 → GenerationReflectionOutput を返す
 * - LLM API 失敗 (= retries 尽くし) → null
 * - content 空 → null
 * - JSON 抽出失敗 → null
 * - Zod 不適合 → null
 * - prompt 構築 (= 当世代 + 直前世代 + lift logs)
 */

import {
  GenerationReflectionAgent,
  type GenerationReflectionInput,
  type GenerationReflectionOutput,
} from '../../agents/GenerationReflectionAgent';
import type { AIProvider } from '../../agent/aiProvider';

/**
 * PR #145 Copilot review #2 対応: `as unknown as AIProvider` の二重キャストを避けるため、
 * `Pick<AIProvider, 'chat'>` の最小 interface で受ける形に変更。
 * GenerationReflectionAgent は内部で `chat` のみ呼ぶので、これで型整合する。
 */
type AIProviderChatLike = Pick<AIProvider, 'chat'>;

function mockAi(impl: jest.Mock): AIProviderChatLike {
  return { chat: impl };
}

const validInput: GenerationReflectionInput = {
  regime: 'breakout',
  generationIndex: 2,
  generationsTotal: 5,
  promotionCandidates: 4,
  validationConfirmed: 2,
  formalBtPassed: 5,
  mutantsReceived: 10,
  crossoversReceived: 5,
  winRateLiftLogs: [
    '[info] win rate lift dslId=x-abc lift=1.4 ...',
    '[info] win rate lift dslId=mutation-def lift=1.0 ...',
  ],
  priorGenerations: [
    { generationIndex: 0, promotionCandidates: 4, validationConfirmed: 3, formalBtPassed: 4 },
    { generationIndex: 1, promotionCandidates: 4, validationConfirmed: 2, formalBtPassed: 3 },
  ],
};

function makeValidOutput(): GenerationReflectionOutput {
  return {
    lessons: [
      {
        category: 'filter_efficacy_increased',
        lesson: 'Gen 2 で time_session.overlap_london_ny を含む crossover child が 2 件 promotion top-K に届いた',
        metrics: { winRateLiftMedian: 1.42, filterCategory: 'time_session' },
      },
    ],
    summary: 'Gen 2 は time_session filter で breakthrough が観測された世代',
    confidence: 0.7,
  };
}

describe('GenerationReflectionAgent.reflect', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('正常な LLM 応答 → 整形済み GenerationReflectionOutput を返す', async () => {
    const output = makeValidOutput();
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify(output), toolCalls: [] });
    const agent = new GenerationReflectionAgent(mockAi(chatMock));

    const result = await agent.reflect(validInput);

    expect(result).not.toBeNull();
    expect(result?.lessons).toHaveLength(1);
    expect(result?.lessons[0].category).toBe('filter_efficacy_increased');
    expect(result?.summary).toContain('breakthrough');
    expect(result?.confidence).toBe(0.7);
  });

  it('LLM API 失敗 (= 全 retries reject) → null + warning ログ', async () => {
    const chatMock = jest.fn().mockRejectedValue(new Error('500 Internal'));
    const agent = new GenerationReflectionAgent(mockAi(chatMock));

    const result = await agent.reflect(validInput);

    expect(result).toBeNull();
    const warnSpy = console.warn as unknown as jest.Mock;
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('API 失敗'),
    );
  });

  it('content 空 → null', async () => {
    const chatMock = jest.fn().mockResolvedValue({ content: '', toolCalls: [] });
    const agent = new GenerationReflectionAgent(mockAi(chatMock));

    const result = await agent.reflect(validInput);
    expect(result).toBeNull();
  });

  it('JSON 抽出失敗 (= プレーンテキスト) → null', async () => {
    const chatMock = jest.fn().mockResolvedValue({ content: 'plain text not json', toolCalls: [] });
    const agent = new GenerationReflectionAgent(mockAi(chatMock));

    const result = await agent.reflect(validInput);
    expect(result).toBeNull();
  });

  it('Zod 不適合 (= category 不正) → null', async () => {
    const invalidOutput = {
      lessons: [
        {
          category: 'invalid_category',
          lesson: 'short',
          metrics: { x: 1 },
        },
      ],
      summary: 'short summary',
      confidence: 0.5,
    };
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify(invalidOutput), toolCalls: [] });
    const agent = new GenerationReflectionAgent(mockAi(chatMock));

    const result = await agent.reflect(validInput);
    expect(result).toBeNull();
  });

  it('Zod 不適合 (= confidence 範囲外) → null', async () => {
    const out = makeValidOutput();
    const chatMock = jest.fn().mockResolvedValue({
      content: JSON.stringify({ ...out, confidence: 1.5 }),
      toolCalls: [],
    });
    const agent = new GenerationReflectionAgent(mockAi(chatMock));

    const result = await agent.reflect(validInput);
    expect(result).toBeNull();
  });

  it('Zod 不適合 (= lessons 空配列) → null', async () => {
    const out = { ...makeValidOutput(), lessons: [] };
    const chatMock = jest.fn().mockResolvedValue({
      content: JSON.stringify(out),
      toolCalls: [],
    });
    const agent = new GenerationReflectionAgent(mockAi(chatMock));

    const result = await agent.reflect(validInput);
    expect(result).toBeNull();
  });

  it('user prompt に当世代 + 直前世代 + winRateLiftLogs が含まれる', async () => {
    const output = makeValidOutput();
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify(output), toolCalls: [] });
    const agent = new GenerationReflectionAgent(mockAi(chatMock));

    await agent.reflect(validInput);

    const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('当世代 GenerationReport');
    expect(userMsg?.content).toContain('"regime": "breakout"');
    expect(userMsg?.content).toContain('"generationIndex": 2');
    expect(userMsg?.content).toContain('"promotionCandidates": 4');
    expect(userMsg?.content).toContain('当世代の Win Rate Lift 観測ログ抜粋');
    expect(userMsg?.content).toContain('lift=1.4');
    expect(userMsg?.content).toContain('直前世代の同 regime サマリ');
  });

  it('priorGenerations が空配列なら "直前世代: なし" を含む', async () => {
    const output = makeValidOutput();
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify(output), toolCalls: [] });
    const agent = new GenerationReflectionAgent(mockAi(chatMock));

    await agent.reflect({ ...validInput, priorGenerations: [] });

    const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('直前世代: なし');
  });

  it('winRateLiftLogs が 30 件超なら 30 件で truncate', async () => {
    const longLogs = Array.from({ length: 50 }, (_, i) => `[info] win rate lift dslId=x-${i} lift=1.0`);
    const output = makeValidOutput();
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify(output), toolCalls: [] });
    const agent = new GenerationReflectionAgent(mockAi(chatMock));

    await agent.reflect({ ...validInput, winRateLiftLogs: longLogs });

    const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('30/50 件');
    // 30 件目 (= dslId=x-29) は含まれる、31 件目 (= x-30) は含まれない
    expect(userMsg?.content).toContain('dslId=x-29');
    expect(userMsg?.content).not.toContain('dslId=x-30 ');
  });
});
