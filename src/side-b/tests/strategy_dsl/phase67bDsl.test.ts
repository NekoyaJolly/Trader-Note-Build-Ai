/**
 * Phase 6.7b: ParameterRange グリッド・wait_for_trigger・SurrogateFitnessResult
 */

import { StrategyDSLSchema } from '../../strategy_dsl/schema';
import { enumerateParameterGrid, MAX_PARAMETER_GRID_COMBINATIONS } from '../../strategy_dsl/dslParameterUtils';
import { runDslSimulation, type OhlcvBar } from '../../strategy_dsl/surrogateFitnessSimulation';
import { toSurrogateFitnessResult } from '../../strategy_dsl/SurrogateFitnessSimulator';
import type { SurrogateFitnessAggregate } from '../../strategy_dsl/SurrogateFitnessSimulator';
import { toDslSimulationOptions } from '../../strategy_dsl/executionSimulation';

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

describe('toSurrogateFitnessResult', () => {
  it('validation の trades から pnls を取る', () => {
    const aggregate: SurrogateFitnessAggregate = {
      dslId: 'x',
      period: { start: '2024-01-01', end: '2024-12-01' },
      train: { summary: {} as SurrogateFitnessAggregate['train']['summary'], trades: [] },
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
      execution: {
        executionModel: 'bar_l1_v1',
        executionConfigHash: 'hash',
        dataSource: 'ctrader',
        costSummary: {
          model: 'bar_l1_v1',
          dataSource: 'ctrader',
          roundTripCostPips: 1,
          roundTripCostAtrMult: 0,
          totalCost: 3,
        },
      },
    };
    const dto = toSurrogateFitnessResult(aggregate, { k: 1 });
    expect(dto.pnls).toEqual([25]);
    expect(dto.grossPnls).toEqual([25]);
    expect(dto.netPnls).toEqual([25]);
    expect(dto.finalReturn).toBe(0.15);
    expect(dto.optimizedParams).toEqual({ k: 1 });
    expect(dto.executionModel).toBe('bar_l1_v1');
    expect(dto.executionConfigHash).toBe('hash');
  });
});

describe('Phase 6.8 execution metadata', () => {
  it('コストありでは netPnl が grossPnl を下回り、設定ハッシュを保持する', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const bars = barsUptrend(80, start);
    const dsl = StrategyDSLSchema.parse({
      id: 'exec-1',
      generation: 0,
      parentIds: [],
      regimeTarget: 't',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }] },
      },
      stopLoss: { type: 'fixed_pips', value: 5 },
      takeProfit: { type: 'rr_ratio', value: 1 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    });

    const r = runDslSimulation(
      bars,
      dsl,
      {},
      toDslSimulationOptions({
        model: 'bar_l1_v1',
        dataSource: 'ctrader',
        roundTripCostPips: 2,
      }),
    );
    expect(r.execution.executionModel).toBe('bar_l1_v1');
    expect(r.execution.executionConfigHash).toHaveLength(16);
    expect(r.execution.costSummary.totalCost).toBeGreaterThan(0);
    expect(r.trades.length).toBeGreaterThan(0);
    const first = r.trades[0]!;
    expect(first.indicatorValues?.grossPnl).toBeGreaterThan(first.pnl);
    expect(first.indicatorValues?.transactionCost).toBeGreaterThan(0);
  });

  it('bar_l2_v1 は建値と決済値そのものを不利方向へ調整する', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const bars = barsUptrend(80, start);
    const dsl = StrategyDSLSchema.parse({
      id: 'exec-2',
      generation: 0,
      parentIds: [],
      regimeTarget: 't',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }] },
      },
      stopLoss: { type: 'fixed_pips', value: 5 },
      takeProfit: { type: 'rr_ratio', value: 1 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    });

    const zero = runDslSimulation(
      bars,
      dsl,
      {},
      toDslSimulationOptions({
        model: 'legacy_zero_cost',
        dataSource: 'ctrader',
        roundTripCostPips: 0,
      }),
    );
    const l2 = runDslSimulation(
      bars,
      dsl,
      {},
      toDslSimulationOptions({
        model: 'bar_l2_v1',
        dataSource: 'ctrader',
        roundTripCostPips: 2,
      }),
    );
    expect(l2.trades.length).toBeGreaterThan(0);
    expect(zero.trades.length).toBeGreaterThan(0);
    expect(l2.trades[0]!.entryPrice).toBeGreaterThan(zero.trades[0]!.entryPrice);
    expect(l2.trades[0]!.exitPrice).toBeLessThan(zero.trades[0]!.exitPrice);
    expect(l2.trades[0]!.indicatorValues?.grossPnl).toBeGreaterThan(l2.trades[0]!.pnl);
  });
});
