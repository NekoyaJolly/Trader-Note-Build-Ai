/**
 * EvolutionLoop（モックで 1 世代）（Phase 5）
 */

import type { EdgeLedger } from '../../ledger/EdgeLedger';
import { CrossoverAgent } from '../../agents/CrossoverAgent';
import { MutationAgent } from '../../agents/MutationAgent';
import { DiversityEnforcer } from '../../evolution/DiversityEnforcer';
import { EvolutionLoop } from '../../evolution/EvolutionLoop';
import { StrategyPopulation } from '../../evolution/StrategyPopulation';
import { DSLBacktestAdapter } from '../../strategy_dsl/DSLBacktestAdapter';
import { StrategyDSLSchema } from '../../strategy_dsl/schema';

describe('EvolutionLoop.runOneGeneration（モック）', () => {
  it('空集団ならシード後にスコアが付き、レポートが返る', async () => {
    const dsl = StrategyDSLSchema.parse({
      id: 'loop-test-1',
      generation: 0,
      parentIds: [],
      regimeTarget: 'trending_with_pullback',
      symbol: 'EURUSD',
      timeframe: '1h',
      entry: {
        direction: 'long',
        trigger: {
          logic: 'AND',
          conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 0 }],
        },
      },
      stopLoss: { type: 'fixed_pips', value: 30 },
      takeProfit: { type: 'rr_ratio', value: 1.5 },
      parameters: {},
      metadata: {
        createdAt: new Date().toISOString(),
        createdBy: 'initial_random',
      },
    });

    const bars = Array.from({ length: 60 }, (_, i) => ({
      timestamp: new Date(`2024-06-01T${String(i).padStart(2, '0')}:00:00Z`),
      open: 1 + i * 0.0001,
      high: 1 + i * 0.0001 + 0.0002,
      low: 1 + i * 0.0001 - 0.0002,
      close: 1 + i * 0.0001,
      volume: 1000,
    }));

    const adapter = new DSLBacktestAdapter();
    jest.spyOn(adapter, 'runBacktest').mockImplementation(async (strategy, _params, _period) => {
      const agg = adapter.runBacktestOnBars(strategy, {}, { start: '2024-06-01', end: '2024-06-03' }, bars);
      return Promise.resolve(agg);
    });

    const mutationAgent = new MutationAgent();
    jest.spyOn(mutationAgent, 'generateMutants').mockResolvedValue([
      StrategyDSLSchema.parse({
        ...dsl,
        id: 'm1',
        parentIds: [dsl.id],
        generation: 1,
        metadata: { ...dsl.metadata, createdBy: 'mutation' },
      }),
    ]);
    jest.spyOn(mutationAgent, 'generateDiverse').mockResolvedValue([]);

    const crossoverAgent = new CrossoverAgent();
    jest.spyOn(crossoverAgent, 'generateCrossovers').mockResolvedValue([]);

    const ledger: Pick<EdgeLedger, 'create' | 'markConfirmed'> = {
      create: jest.fn().mockResolvedValue({ id: 'edge-1' }),
      markConfirmed: jest.fn().mockResolvedValue(undefined),
    };

    const loop = new EvolutionLoop({
      population: new StrategyPopulation(undefined),
      adapter,
      mutationAgent,
      crossoverAgent,
      enforcer: new DiversityEnforcer(),
      edgeLedger: ledger as unknown as EdgeLedger,
      defaultPeriod: { start: '2024-01-01', end: '2024-12-31' },
    });

    const report = await loop.runOneGeneration('trending_with_pullback');

    expect(report.eliteIds.length).toBeGreaterThanOrEqual(0);
    expect(report.scores).toBeDefined();
    expect(ledger.create).not.toHaveBeenCalled();
  });
});
