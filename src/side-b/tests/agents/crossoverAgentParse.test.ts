/**
 * Critical-4 段階 4a.PDCA: CrossoverAgent silent-empty 観測ログのテスト
 *
 * AIProvider をモックし、failureBuckets 集計 (apiError / noContent / jsonExtract /
 * zodInvalid / other) と最終ログ出力を検証する。EvolutionLoop 経由のテストでは
 * CrossoverAgent をまるごとモックしているため、本ファイルが分類精度の唯一の砦。
 */

import { CrossoverAgent } from '../../agents/CrossoverAgent';
import type { AIProvider } from '../../agent/aiProvider';
import { StrategyDSLSchema, type StrategyDSL } from '../../strategy_dsl/schema';

function mockAi(impl: jest.Mock): AIProvider {
  return {
    chat: impl,
  } as unknown as AIProvider;
}

function makeElite(id: string): StrategyDSL {
  return StrategyDSLSchema.parse({
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
    metadata: { createdAt: new Date().toISOString(), createdBy: 'initial_random' },
  });
}

const elites = [makeElite('elite-1'), makeElite('elite-2')];
const scores = new Map([
  ['elite-1', 0.5],
  ['elite-2', 0.4],
]);

describe('CrossoverAgent silent-empty 観測ログ (4a.PDCA)', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('全試行が API エラーで終わると apiError バケットでログ集計される', async () => {
    const chatMock = jest.fn().mockRejectedValue(new Error('500 Internal Server Error'));
    const agent = new CrossoverAgent(mockAi(chatMock));
    const out = await agent.generateCrossovers(elites, scores, 1);
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/apiError=1.*noContent=0.*jsonExtract=0.*zodInvalid=0/),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('500 Internal Server Error'),
    );
  });

  it('content が空のときは noContent バケットに集計される', async () => {
    const chatMock = jest.fn().mockResolvedValue({ content: '', toolCalls: [] });
    const agent = new CrossoverAgent(mockAi(chatMock));
    const out = await agent.generateCrossovers(elites, scores, 1);
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/apiError=0.*noContent=1.*jsonExtract=0/),
    );
  });

  it('JSON 抽出失敗時は jsonExtract バケットに集計される', async () => {
    const chatMock = jest.fn().mockResolvedValue({ content: 'plain text not json', toolCalls: [] });
    const agent = new CrossoverAgent(mockAi(chatMock));
    const out = await agent.generateCrossovers(elites, scores, 1);
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/jsonExtract=1/),
    );
  });

  it('Zod 不適合な JSON は zodInvalid バケットに集計される', async () => {
    const invalidObj = {
      id: 'x-1',
      // direction が不正値
      entry: { direction: 'sideways', trigger: { logic: 'AND', conditions: [] }, orderType: 'market' },
    };
    const chatMock = jest.fn().mockResolvedValue({ content: JSON.stringify(invalidObj), toolCalls: [] });
    const agent = new CrossoverAgent(mockAi(chatMock));
    const out = await agent.generateCrossovers(elites, scores, 1);
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/zodInvalid=1/),
    );
  });

  it('成功すれば失敗ログは出さない', async () => {
    const validObj = {
      id: 'tmp-id', // CrossoverAgent が後から x-${uuid} で上書きするが Zod parse には必須
      generation: 1,
      parentIds: ['elite-1', 'elite-2'],
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
      metadata: { createdAt: new Date().toISOString(), createdBy: 'crossover' },
    };
    const chatMock = jest.fn().mockResolvedValue({ content: JSON.stringify(validObj), toolCalls: [] });
    const agent = new CrossoverAgent(mockAi(chatMock));
    const out = await agent.generateCrossovers(elites, scores, 1);
    expect(out).toHaveLength(1);
    // 失敗内訳ログは発火しない (試行 0 件成功時のみ出る)
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringMatching(/試行で 0 件成功/));
  });
});
