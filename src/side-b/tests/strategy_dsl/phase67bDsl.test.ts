/**
 * Phase 6.7b: ParameterRange グリッド・wait_for_trigger・DSLBacktestResult
 */

import { StrategyDSLSchema } from '../../strategy_dsl/schema';
import { enumerateParameterGrid, MAX_PARAMETER_GRID_COMBINATIONS } from '../../strategy_dsl/dslParameterUtils';
import { runDslSimulation, type OhlcvBar } from '../../strategy_dsl/dslBacktestSimulation';
import { toDSLBacktestResult } from '../../strategy_dsl/DSLBacktestAdapter';
import type { DslBacktestAggregate } from '../../strategy_dsl/DSLBacktestAdapter';

function barsUptrend(n: number, start: Date): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  for (let i = 0; i < n; i++) {
    const px = 1.1 + i * 0.001;
    out.push({
      timestamp: new Date(start.getTime() + i * 60 * 60 * 1000),
      open: px,
      high: px + 0.0002,
      low: px - 0.0002,
      close: px,
      volume: 1000,
    });
  }
  return out;
}

describe('ParameterRangeV2 グリッド', () => {
  it('2 キーの組み合わせを列挙できる', () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'g-1',
      generation: 0,
      parentIds: [],
      regimeTarget: 't',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }] },
      },
      stopLoss: { type: 'fixed_pips', value: 20 },
      takeProfit: { type: 'rr_ratio', value: 2 },
      parameters: {
        a: { kind: 'range' as const, min: 1, max: 2, step: 1, default: 1 },
        b: { kind: 'range' as const, min: 10, max: 12, step: 2, default: 10 },
      },
      metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    });
    const grid = enumerateParameterGrid(dsl);
    expect(grid.length).toBe(4);
  });

  it('組み合わせが上限超なら列挙時に例外', () => {
    const manySteps = 10;
    const dsl = StrategyDSLSchema.parse({
      id: 'g-2',
      generation: 0,
      parentIds: [],
      regimeTarget: 't',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }] },
      },
      stopLoss: { type: 'fixed_pips', value: 20 },
      takeProfit: { type: 'rr_ratio', value: 2 },
      parameters: {
        a: { kind: 'range' as const, min: 0, max: manySteps - 1, step: 1, default: 0 },
        b: { kind: 'range' as const, min: 0, max: manySteps - 1, step: 1, default: 0 },
        c: { kind: 'range' as const, min: 0, max: manySteps - 1, step: 1, default: 0 },
      },
      metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    });
    const combos = 10 * 10 * 10;
    expect(combos).toBeGreaterThan(MAX_PARAMETER_GRID_COMBINATIONS);
    expect(() => enumerateParameterGrid(dsl)).toThrow(/上限/);
  });
});

describe('wait_for_trigger バリデーション', () => {
  it('ohlcv 以外のレンズを triggerConditions に含むと Zod が失敗', () => {
    expect(() =>
      StrategyDSLSchema.parse({
        id: 'bad',
        generation: 0,
        parentIds: [],
        regimeTarget: 't',
        symbol: 'EURUSD',
        timeframe: '1h',
        entry: {
          type: 'wait_for_trigger',
          direction: 'long',
          maxWaitBars: 5,
          executionType: 'market',
          triggerConditions: {
            logic: 'AND',
            conditions: [{ lens: 'fantasy_lens', feature: 'x', op: '>', value: 0 }],
          },
        },
        stopLoss: { type: 'fixed_pips', value: 20 },
        takeProfit: { type: 'rr_ratio', value: 2 },
        parameters: {},
        metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
      }),
    ).toThrow();
  });
});

describe('wait_for_trigger シミュレーション', () => {
  it('maxWaitBars 超過でエントリーなし（全バー待機only）', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const bars = barsUptrend(80, start);
    const dsl = StrategyDSLSchema.parse({
      id: 'w-1',
      generation: 0,
      parentIds: [],
      regimeTarget: 't',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        type: 'wait_for_trigger',
        direction: 'long',
        maxWaitBars: 2,
        executionType: 'market',
        triggerConditions: {
          logic: 'AND',
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 99999 }],
        },
      },
      stopLoss: { type: 'fixed_pips', value: 20 },
      takeProfit: { type: 'rr_ratio', value: 2 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    });
    const r = runDslSimulation(bars, dsl, {});
    expect(r.trades.length).toBe(0);
  });
});

describe('toDSLBacktestResult', () => {
  it('validation の trades から pnls を取る', () => {
    const aggregate: DslBacktestAggregate = {
      dslId: 'x',
      period: { start: '2024-01-01', end: '2024-12-01' },
      train: { summary: {} as DslBacktestAggregate['train']['summary'], trades: [] },
      validation: {
        summary: {
          totalTrades: 1,
          winningTrades: 1,
          losingTrades: 0,
          winRate: 1,
          netProfit: 10,
          netProfitRate: 0.15,
          maxDrawdown: 0,
          maxDrawdownRate: 0,
          profitFactor: 2,
          averageWin: 10,
          averageLoss: 0,
          riskRewardRatio: 1,
          maxConsecutiveWins: 1,
          maxConsecutiveLosses: 0,
        },
        trades: [
          {
            eventId: '1',
            entryTime: '2024-01-01',
            entryPrice: 1,
            exitTime: '2024-01-02',
            exitPrice: 1.1,
            side: 'buy',
            lotSize: 1,
            pnl: 25,
            pnlPercent: 0,
            exitReason: 'take_profit',
          },
        ],
      },
      overfitScore: 0.1,
      trainPf: 1.2,
      validationPf: 1.1,
    };
    const dto = toDSLBacktestResult(aggregate, { k: 1 });
    expect(dto.pnls).toEqual([25]);
    expect(dto.finalReturn).toBe(0.15);
    expect(dto.optimizedParams).toEqual({ k: 1 });
  });
});
