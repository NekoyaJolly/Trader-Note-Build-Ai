/**
 * ロバストネス（複数執行仮定）と ATR 比例コスト
 */

import { StrategyDSLSchema } from '../../strategy_dsl/schema';
import { runSurrogateFitnessRobustnessOnBars, defaultCommercialScenarios } from '../../strategy_dsl/surrogateFitnessRobustness';
import { runDslSimulation, type OhlcvBar } from '../../strategy_dsl/surrogateFitnessSimulation';

function trendBars(n: number, start: Date, stepMin: number): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  for (let i = 0; i < n; i++) {
    const px = 100 + i * 0.01;
    out.push({
      timestamp: new Date(start.getTime() + i * stepMin * 60 * 1000),
      open: px,
      high: px + 0.02,
      low: px - 0.02,
      close: px,
      volume: 100,
    });
  }
  return out;
}

describe('runSurrogateFitnessRobustnessOnBars', () => {
  it('defaultCommercialScenarios 本数分の run が返る', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const bars = trendBars(100, start, 60);
    const dsl = StrategyDSLSchema.parse({
      id: 'rb-1',
      generation: 0,
      parentIds: [],
      regimeTarget: 't',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }] },
      },
      stopLoss: { type: 'fixed_pips', value: 200 },
      takeProfit: { type: 'fixed_pips', value: 100 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    });
    const report = runSurrogateFitnessRobustnessOnBars(
      dsl,
      {},
      { start: '2024-01-01', end: '2024-06-01' },
      bars,
    );
    expect(report.runs.length).toBe(defaultCommercialScenarios().length);
    expect(report.validationPfMax).toBeGreaterThanOrEqual(report.validationPfMin);
    expect(report.validationPfRange).toBeGreaterThanOrEqual(0);
  });
});

describe('roundTripCostAtrMult', () => {
  it('ATR 係数が大きいほど合計 PnL が厳しくなる（同トレード列）', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const bars = trendBars(50, start, 60);
    const dsl = StrategyDSLSchema.parse({
      id: 'at-1',
      generation: 0,
      parentIds: [],
      regimeTarget: 't',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 }] },
      },
      stopLoss: { type: 'fixed_pips', value: 5 },
      takeProfit: { type: 'fixed_pips', value: 200 },
      parameters: {},
      metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    });
    // 両方 ATR>0 で前計算（ウォームアップ開始を一致）。係数だけ変えて厳しさ比較
    const lightAtr = runDslSimulation(bars, dsl, {}, { lotSize: 1, roundTripCostPips: 1, roundTripCostAtrMult: 0.01 });
    const heavyAtr = runDslSimulation(bars, dsl, {}, { lotSize: 1, roundTripCostPips: 1, roundTripCostAtrMult: 0.5 });
    expect(lightAtr.trades.length).toBeGreaterThan(0);
    expect(heavyAtr.trades.length).toBe(lightAtr.trades.length);
    const sumL = lightAtr.trades.reduce((a, t) => a + t.pnl, 0);
    const sumH = heavyAtr.trades.reduce((a, t) => a + t.pnl, 0);
    expect(sumH).toBeLessThan(sumL);
  });
});
