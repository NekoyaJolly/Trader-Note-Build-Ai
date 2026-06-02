/**
 * PR #110: defaultOosBacktestRunner adapter のテスト。
 *
 * Side-B から analysis-engine `/v1/oos-validation` を呼ぶ adapter が:
 *   1. DSL を notePayload に変換 + symbol/timeframe 正規化して HTTP に乗せる
 *   2. response の verdict をそのまま運ぶ (= Side-B では再判定しない、PR #105 維持)
 *   3. unsupportedConditions を warnings に積む
 *   4. 例外は throw (= EvolutionLoop 側で `oos_engine_error` 観測される)
 *
 * 実 HTTP は飛ばさない。`runOosValidation` を Jest mock にする。
 */

import { defaultOosBacktestRunner } from '../../evolution/analysisEngineRobustnessAdapter';
import { StrategyDSLSchema, type StrategyDSL } from '../../strategy_dsl/schema';
import * as analysisEngineClient from '../../../backend/services/analysisEngineClient';

jest.mock('../../../backend/services/analysisEngineClient', () => ({
  ...jest.requireActual('../../../backend/services/analysisEngineClient'),
  runOosValidation: jest.fn(),
}));

const mockedRun = analysisEngineClient.runOosValidation as jest.MockedFunction<
  typeof analysisEngineClient.runOosValidation
>;

function makeDsl(id = 'd1'): StrategyDSL {
  return StrategyDSLSchema.parse({
    id,
    generation: 0,
    parentIds: [],
    regimeTarget: 'breakout',
    symbol: 'EUR/USD',
    timeframe: '1H',
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

beforeEach(() => {
  mockedRun.mockReset();
});

describe('defaultOosBacktestRunner', () => {
  it('1. analysis-engine の verdict をそのまま運ぶ (passed)', async () => {
    mockedRun.mockResolvedValue({
      metrics: { pf: 1.4, tradeCount: 35, maxDrawdown: 12, expectancy: null, winRate: 0.55 },
      verdict: 'passed',
      failureReasons: [],
      evaluationKind: 'oos',
      warnings: [],
      engineVersion: 'analysis-engine/backtesting.py@0.6.5',
      unsupportedConditions: [],
    });
    const r = await defaultOosBacktestRunner({
      dsl: makeDsl(),
      startDate: '2024-10-01',
      endDate: '2024-12-31',
    });
    expect(r.verdict).toBe('passed');
    expect(r.metrics.pf).toBe(1.4);
    expect(r.metrics.tradeCount).toBe(35);
    expect(r.evaluationKind).toBe('oos');
  });

  it('2. analysis-engine の verdict をそのまま運ぶ (failed + reasons)', async () => {
    mockedRun.mockResolvedValue({
      metrics: { pf: 0.7, tradeCount: 22, maxDrawdown: 35, expectancy: null, winRate: 0.4 },
      verdict: 'failed',
      failureReasons: ['low_oos_pf', 'high_oos_drawdown'],
      evaluationKind: 'oos',
      warnings: [],
      engineVersion: 'analysis-engine/backtesting.py@0.6.5',
      unsupportedConditions: [],
    });
    const r = await defaultOosBacktestRunner({
      dsl: makeDsl(),
      startDate: '2024-10-01',
      endDate: '2024-12-31',
    });
    expect(r.verdict).toBe('failed');
    expect(r.failureReasons).toEqual(['low_oos_pf', 'high_oos_drawdown']);
  });

  it('3. unsupportedConditions が warnings に積まれる', async () => {
    mockedRun.mockResolvedValue({
      metrics: { pf: null, tradeCount: 0, maxDrawdown: null, expectancy: null, winRate: null },
      verdict: 'unknown',
      failureReasons: ['unknown'],
      evaluationKind: 'oos',
      warnings: ['engine 制約により評価不能'],
      engineVersion: 'analysis-engine/backtesting.py@0.6.5',
      unsupportedConditions: ['lens.foo > 1'],
    });
    const r = await defaultOosBacktestRunner({
      dsl: makeDsl(),
      startDate: '2024-10-01',
      endDate: '2024-12-31',
    });
    expect(r.verdict).toBe('unknown');
    expect(r.warnings?.some((w) => w.includes('engine 制約'))).toBe(true);
    expect(r.warnings?.some((w) => w.includes('unsupportedConditions=lens.foo > 1'))).toBe(true);
  });

  it('4. analysis-engine 例外は throw される (= EvolutionLoop 側で oos_engine_error 観測)', async () => {
    mockedRun.mockRejectedValue(new Error('analysis-engine OOS unreachable'));
    await expect(
      defaultOosBacktestRunner({
        dsl: makeDsl(),
        startDate: '2024-10-01',
        endDate: '2024-12-31',
      }),
    ).rejects.toThrow(/unreachable/);
  });

  it('5. symbol/timeframe を正規化して HTTP payload に乗せる (EUR/USD → EURUSD, 1H → 1h)', async () => {
    mockedRun.mockResolvedValue({
      metrics: { pf: 1.0, tradeCount: 10, maxDrawdown: 5, expectancy: null, winRate: 0.5 },
      verdict: 'unknown',
      failureReasons: ['insufficient_oos_trades'],
      evaluationKind: 'oos',
      warnings: [],
      engineVersion: 'analysis-engine/backtesting.py@0.6.5',
      unsupportedConditions: [],
    });
    await defaultOosBacktestRunner({
      dsl: makeDsl(),
      startDate: '2024-10-01',
      endDate: '2024-12-31',
    });
    const call = mockedRun.mock.calls[0]?.[0];
    expect(call?.symbol).toBe('EURUSD');
    expect(call?.timeframe).toBe('1h');
    // ISO datetime に正規化される (= Z 付き RFC3339)
    expect(call?.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(call?.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('6. PR #110 Copilot #1: T 付き TZ なし datetime も Z 付き UTC ISO に正規化される', async () => {
    mockedRun.mockResolvedValue({
      metrics: { pf: 1.0, tradeCount: 10, maxDrawdown: 5, expectancy: null, winRate: 0.5 },
      verdict: 'unknown',
      failureReasons: ['insufficient_oos_trades'],
      evaluationKind: 'oos',
      warnings: [],
      engineVersion: 'analysis-engine/backtesting.py@0.6.5',
      unsupportedConditions: [],
    });
    await defaultOosBacktestRunner({
      dsl: makeDsl(),
      // T 付きで Z 無し (= 旧実装ではそのまま渡って Zod `datetime()` で弾かれていたケース)
      startDate: '2024-10-01T00:00:00Z',
      endDate: '2024-12-31T23:59:59Z',
    });
    const call = mockedRun.mock.calls[0]?.[0];
    expect(call?.startDate).toMatch(/Z$/);
    expect(call?.endDate).toMatch(/Z$/);
  });

  it('7. PR #110 Copilot #2: thresholds / config を adapter で重複定義せず、schema defaults に任せる (drift 防止)', async () => {
    mockedRun.mockResolvedValue({
      metrics: { pf: 1.5, tradeCount: 30, maxDrawdown: 8, expectancy: null, winRate: 0.6 },
      verdict: 'passed',
      failureReasons: [],
      evaluationKind: 'oos',
      warnings: [],
      engineVersion: 'analysis-engine/backtesting.py@0.6.5',
      unsupportedConditions: [],
    });
    await defaultOosBacktestRunner({
      dsl: makeDsl(),
      startDate: '2024-10-01',
      endDate: '2024-12-31',
    });
    const call = mockedRun.mock.calls[0]?.[0];
    // adapter は `thresholds` / `config` を **明示的に渡さない** (= undefined)。
    // schema の `.default(...)` が parse 内で値を埋めるため、HTTP payload には乗る。
    expect(call?.thresholds).toBeUndefined();
    expect(call?.config).toBeUndefined();
  });

  it('8. correlationId 指定時は analysis-engine client の options に引き継ぐ', async () => {
    mockedRun.mockResolvedValue({
      metrics: { pf: 1.2, tradeCount: 18, maxDrawdown: 6, expectancy: null, winRate: 0.52 },
      verdict: 'unknown',
      failureReasons: [],
      evaluationKind: 'oos',
      warnings: [],
      engineVersion: 'analysis-engine/backtesting.py@0.6.5',
      unsupportedConditions: [],
    });
    await defaultOosBacktestRunner({
      dsl: makeDsl(),
      startDate: '2024-10-01',
      endDate: '2024-12-31',
      correlationId: 'evolution-oos-20260603',
    });
    const options = mockedRun.mock.calls[0]?.[1];
    expect(options?.correlationId).toBe('evolution-oos-20260603');
  });
});
