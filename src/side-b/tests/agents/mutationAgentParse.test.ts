/**
 * Critical-4 段階 4a.PDCA: MutationAgent silent-empty 観測ログのテスト
 *
 * AIProvider をモックし、応答パターンごとに観測ログ分岐が正しく発火することを検証する。
 *   - API 全リトライ失敗 (withRetries result.ok=false)
 *   - API 成功だが content 空
 *   - JSON 抽出失敗 (応答が JSON でない)
 *   - JSON 配列パース成功 + Zod 不適合 → parsed.length < count を観測
 *
 * これらは「mutantsReceived=0 が出た時に原因を追える」運用要件 (4a.PDCA) を保証する。
 */

import { MutationAgent } from '../../agents/MutationAgent';
import type { AIProvider } from '../../agent/aiProvider';
import { StrategyDSLSchema, type StrategyDSL } from '../../strategy_dsl/schema';

function mockAi(impl: jest.Mock): AIProvider {
  return {
    chat: impl,
  } as unknown as AIProvider;
}

function validDsl(id: string): unknown {
  return {
    id,
    generation: 0,
    parentIds: [],
    regimeTarget: 'breakout',
    symbol: 'EURUSD',
    timeframe: '1h',
    entry: {
      direction: 'long',
      trigger: {
        logic: 'AND',
        conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }],
      },
      orderType: 'market',
    },
    stopLoss: { type: 'fixed_pips', value: 30 },
    takeProfit: { type: 'rr_ratio', value: 1.5 },
    parameters: {},
    metadata: { createdAt: new Date().toISOString(), createdBy: 'mutation' },
  };
}

const eliteSeed: StrategyDSL = StrategyDSLSchema.parse({
  ...(validDsl('elite-1') as object),
  id: 'elite-1',
  metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
});
const eliteScores = new Map([['elite-1', 0.5]]);

describe('MutationAgent silent-empty 観測ログ (4a.PDCA)', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('API 全リトライ失敗時は "API 失敗 (リトライ尽くし)" ログを出して空配列を返す', async () => {
    const chatMock = jest.fn().mockRejectedValue(new Error('429 Too Many Requests'));
    const agent = new MutationAgent(mockAi(chatMock));
    const out = await agent.generateMutants([eliteSeed], eliteScores, 5);
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('API 失敗 (リトライ尽くし)'),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('429 Too Many Requests'));
  });

  it('API 成功だが content が空のとき "LLM 応答 content が空" ログを出す', async () => {
    const chatMock = jest.fn().mockResolvedValue({ content: '', toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));
    const out = await agent.generateMutants([eliteSeed], eliteScores, 5);
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/LLM 応答 content が空.*API は成功/),
    );
    // API 失敗ログは出ない
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('リトライ尽くし'));
  });

  it('JSON 抽出失敗時は "応答 parse 失敗" ログ + 応答先頭をプレビュー出力する', async () => {
    const chatMock = jest
      .fn()
      .mockResolvedValue({ content: 'not a json at all just plain text', toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));
    const out = await agent.generateMutants([eliteSeed], eliteScores, 5);
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('応答 parse 失敗'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not a json'));
  });

  it('Zod 部分失敗 (parsed=1/3) 時は内訳と path:message を含むログを出す', async () => {
    const validItem = validDsl('mut-good');
    const invalidItem = {
      ...(validItem as object),
      id: 'mut-bad',
      // entry.direction を不正値にして Zod を弾く
      entry: { ...((validItem as { entry: object }).entry), direction: 'sideways' },
    };
    const response = JSON.stringify([validItem, invalidItem, invalidItem]);
    const chatMock = jest.fn().mockResolvedValue({ content: response, toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));
    const out = await agent.generateMutants([eliteSeed], eliteScores, 3);

    expect(out.length).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/parsed=1\/3.*Zod 不適合 2 件/),
    );
    // path:message 形式が含まれる (Zod は union の root で `entry: Invalid input` を出す)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/entry:.*Invalid input/));
  });

  it('全件 Zod 失敗時は parsed=0 で空配列、内訳ログあり', async () => {
    const invalidItem = {
      ...(validDsl('mut-1') as object),
      entry: {
        direction: 'sideways', // Zod 不正
        trigger: {
          logic: 'AND',
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }],
        },
        orderType: 'market',
      },
    };
    const response = JSON.stringify([invalidItem, invalidItem]);
    const chatMock = jest.fn().mockResolvedValue({ content: response, toolCalls: [] });
    const agent = new MutationAgent(mockAi(chatMock));
    const out = await agent.generateMutants([eliteSeed], eliteScores, 2);

    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/parsed=0\/2/),
    );
  });
});
