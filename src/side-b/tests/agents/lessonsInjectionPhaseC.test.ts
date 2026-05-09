/**
 * Filter Evolution Phase C: mutation/crossover prompt への lessons 注入テスト
 *
 * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.C
 *
 * 検証内容:
 * - `buildLessonsPromptBlock` が agentMemory から lessons を取得し block を生成
 * - symbol 不明 / lessons 0 件で null
 * - LESSONS_PROMPT_LIMIT (= 10) で truncate
 * - CrossoverAgent.generateCrossovers が user prompt に lessons block を注入
 * - MutationAgent.generateMutants が同様
 *
 * agentMemory は singleton なので jest.spyOn(agentMemory, 'getLessonsForStrategy') で
 * 戻り値を制御する。LLM 呼び出しは AIProvider mock で全 stub 化する。
 */

import { agentMemory } from '../../agent/agentMemory';
import {
  CrossoverAgent,
  type LossTradeSummary,
} from '../../agents/CrossoverAgent';
import {
  buildLessonsPromptBlock,
  LESSONS_PROMPT_LIMIT,
} from '../../agents/lessonsPrompt';
import { MutationAgent } from '../../agents/MutationAgent';
import type { AIProvider } from '../../agent/aiProvider';
import { StrategyDSLSchema, type StrategyDSL } from '../../strategy_dsl/schema';

function mockAi(impl: jest.Mock): AIProvider {
  return { chat: impl } as unknown as AIProvider;
}

function makeElite(id: string, symbol = 'EURUSD'): StrategyDSL {
  return StrategyDSLSchema.parse({
    id,
    generation: 0,
    parentIds: [],
    regimeTarget: 'breakout',
    symbol,
    timeframe: '1h',
    entry: {
      direction: 'long',
      trigger: {
        logic: 'AND',
        conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }],
      },
      orderType: 'market',
    },
    stopLoss: { type: 'fixed_pips', value: 30 },
    takeProfit: { type: 'rr_ratio', value: 1.5 },
    parameters: {},
    metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
  });
}

function makeValidChildDsl(symbol = 'EURUSD'): unknown {
  return {
    id: 'tmp-child',
    generation: 1,
    parentIds: ['elite-1', 'elite-2'],
    regimeTarget: 'breakout',
    symbol,
    timeframe: '1h',
    entry: {
      direction: 'long',
      trigger: {
        logic: 'AND',
        conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }],
      },
      orderType: 'market',
    },
    stopLoss: { type: 'fixed_pips', value: 30 },
    takeProfit: { type: 'rr_ratio', value: 1.5 },
    parameters: {},
    metadata: { createdAt: new Date().toISOString(), createdBy: 'crossover' },
  };
}

describe('Phase C: buildLessonsPromptBlock helper', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('symbol が undefined なら null を返す', () => {
    const result = buildLessonsPromptBlock(undefined);
    expect(result).toBeNull();
  });

  it('lessons 配列が空なら null を返す', () => {
    jest.spyOn(agentMemory, 'getLessonsForStrategy').mockReturnValue([]);
    const result = buildLessonsPromptBlock('EURUSD');
    expect(result).toBeNull();
  });

  it('lessons があれば block + count を返し、symbol を block 内に含める', () => {
    jest.spyOn(agentMemory, 'getLessonsForStrategy').mockReturnValue([
      '📌 [確信ルール/EURUSD] 金曜引け前は損失多い (5回確認)',
      '📝 [EURUSD] ロンドン NY オーバーラップで RR 改善',
    ]);
    const result = buildLessonsPromptBlock('EURUSD');
    expect(result).not.toBeNull();
    expect(result?.count).toBe(2);
    expect(result?.block).toContain('symbol=EURUSD');
    expect(result?.block).toContain('上位 2/2 件');
    expect(result?.block).toContain('金曜引け前は損失多い');
    expect(result?.block).toContain('ロンドン NY オーバーラップ');
  });

  it('lessons が LESSONS_PROMPT_LIMIT 超なら定数件数で truncate される', () => {
    // PR #141 Copilot review #4: ハードコード値ではなく export された定数を参照する
    const totalCount = LESSONS_PROMPT_LIMIT + 5;
    const manyLessons = Array.from({ length: totalCount }, (_, i) => `📌 lesson #${i}`);
    jest.spyOn(agentMemory, 'getLessonsForStrategy').mockReturnValue(manyLessons);
    const result = buildLessonsPromptBlock('EURUSD');
    expect(result?.count).toBe(LESSONS_PROMPT_LIMIT);
    expect(result?.block).toContain(`上位 ${LESSONS_PROMPT_LIMIT}/${totalCount} 件`);
    // limit-1 番目は含まれ、limit 番目は含まれない (= 0-indexed の境界確認)
    expect(result?.block).toContain(`lesson #${LESSONS_PROMPT_LIMIT - 1}`);
    expect(result?.block).not.toContain(`lesson #${LESSONS_PROMPT_LIMIT}`);
  });
});

describe('Phase C: CrossoverAgent prompt への lessons 注入', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lessons がある場合は user prompt に注入され、観測ログが出る', async () => {
    const lessons = [
      '📌 [確信ルール/EURUSD] 金曜引け前は損失多い (5回確認)',
      '📝 [EURUSD] ロンドン NY オーバーラップで RR 改善',
    ];
    jest.spyOn(agentMemory, 'getLessonsForStrategy').mockReturnValue(lessons);

    const elites = [makeElite('elite-1'), makeElite('elite-2')];
    const scores = new Map([
      ['elite-1', 0.5],
      ['elite-2', 0.4],
    ]);

    const wrapper = { child_dsl: makeValidChildDsl() };
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify(wrapper), toolCalls: [] });
    const agent = new CrossoverAgent(mockAi(chatMock));
    await agent.generateCrossovers(elites, scores, 1);

    expect(chatMock).toHaveBeenCalled();
    const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('過去の学び');
    expect(userMsg?.content).toContain('金曜引け前は損失多い');
    expect(userMsg?.content).toContain('symbol=EURUSD');

    // Phase C 観測ログ
    const infoSpy = console.info as unknown as jest.Mock;
    const phaseLog = infoSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('Phase C lessons injected') : false,
    );
    expect(phaseLog).toBeDefined();
    expect(phaseLog?.[0]).toContain('symbol=EURUSD');
    expect(phaseLog?.[0]).toContain('count=2');
  });

  it('lessons 0 件なら user prompt に過去の学びブロックは含まれない', async () => {
    jest.spyOn(agentMemory, 'getLessonsForStrategy').mockReturnValue([]);

    const elites = [makeElite('elite-1'), makeElite('elite-2')];
    const scores = new Map([
      ['elite-1', 0.5],
      ['elite-2', 0.4],
    ]);

    const wrapper = { child_dsl: makeValidChildDsl() };
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify(wrapper), toolCalls: [] });
    const agent = new CrossoverAgent(mockAi(chatMock));
    await agent.generateCrossovers(elites, scores, 1);

    const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg?.content).not.toContain('過去の学び');

    // 観測ログも出ない
    const infoSpy = console.info as unknown as jest.Mock;
    const phaseLog = infoSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('Phase C lessons injected') : false,
    );
    expect(phaseLog).toBeUndefined();
  });

  it('parentLossTrades + moduleParents + lessons の全 3 種類が user prompt に共存する', async () => {
    jest.spyOn(agentMemory, 'getLessonsForStrategy').mockReturnValue([
      '📌 [確信ルール/EURUSD] 金曜引け前は負けやすい',
    ]);

    const elites = [makeElite('elite-1'), makeElite('elite-2')];
    const scores = new Map([
      ['elite-1', 0.5],
      ['elite-2', 0.4],
    ]);

    const losses: LossTradeSummary[] = [
      { entryTime: '2024-01-01T00:00:00Z', side: 'long', pnl: -25 },
    ];
    const parentLossTrades = new Map([['elite-1', losses]]);

    const wrapper = { child_dsl: makeValidChildDsl() };
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify(wrapper), toolCalls: [] });
    const agent = new CrossoverAgent(mockAi(chatMock));
    await agent.generateCrossovers(elites, scores, 1, { parentLossTrades });

    const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('親A_loss_trades');
    expect(userMsg?.content).toContain('module_parents');
    expect(userMsg?.content).toContain('過去の学び');
    expect(userMsg?.content).toContain('金曜引け前は負けやすい');
  });
});

describe('Phase C: MutationAgent prompt への lessons 注入', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lessons がある場合は user prompt に注入され、観測ログが出る', async () => {
    const lessons = [
      '📌 [確信ルール/XAUUSD] 高ボラ時のブレイクアウトは失敗率高い (8回確認)',
    ];
    jest.spyOn(agentMemory, 'getLessonsForStrategy').mockReturnValue(lessons);

    const elites = [makeElite('elite-x', 'XAUUSD')];
    const scores = new Map([['elite-x', 0.5]]);

    // 有効な mutation 配列で応答 (内容は無関係、prompt 注入の確認だけ)
    const validChild = {
      ...makeElite('m-1', 'XAUUSD'),
      generation: 1,
      parentIds: ['elite-x'],
      metadata: { createdAt: new Date().toISOString(), createdBy: 'mutation' },
    };
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify([validChild]), toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));
    await agent.generateMutants(elites, scores, 1);

    expect(chatMock).toHaveBeenCalled();
    const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('過去の学び');
    expect(userMsg?.content).toContain('高ボラ時のブレイクアウト');
    expect(userMsg?.content).toContain('symbol=XAUUSD');

    // Phase C 観測ログ
    const infoSpy = console.info as unknown as jest.Mock;
    const phaseLog = infoSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('[MutationAgent] Phase C lessons injected') : false,
    );
    expect(phaseLog).toBeDefined();
    expect(phaseLog?.[0]).toContain('symbol=XAUUSD');
    expect(phaseLog?.[0]).toContain('count=1');
  });

  it('lessons 0 件なら user prompt に過去の学びブロックは含まれない', async () => {
    jest.spyOn(agentMemory, 'getLessonsForStrategy').mockReturnValue([]);

    const elites = [makeElite('elite-y')];
    const scores = new Map([['elite-y', 0.5]]);

    const validChild = {
      ...makeElite('m-1'),
      generation: 1,
      parentIds: ['elite-y'],
      metadata: { createdAt: new Date().toISOString(), createdBy: 'mutation' },
    };
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: JSON.stringify([validChild]), toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));
    await agent.generateMutants(elites, scores, 1);

    const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg?.content).not.toContain('過去の学び');
  });
});
