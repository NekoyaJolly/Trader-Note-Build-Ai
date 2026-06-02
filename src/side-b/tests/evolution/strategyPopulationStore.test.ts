/**
 * 進化ループ再設計 Phase 4: StrategyPopulation の DB store 経路テスト。
 * store 注入時に load/save が file ではなく store を使うこと（cron 跨ぎ durable）を検証する。
 */

import {
  StrategyPopulation,
  type PopulationStore,
} from '../../evolution/StrategyPopulation';
import type { StrategyDSL } from '../../strategy_dsl/schema';

function makeDsl(id: string): StrategyDSL {
  return {
    id,
    generation: 1,
    parentIds: [],
    regimeTarget: 'trend',
    symbol: 'XAUUSD',
    timeframe: '15m',
    entry: {
      direction: 'long',
      trigger: { logic: 'AND', conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 2000 }] },
      orderType: 'market',
    },
    stopLoss: { type: 'atr_multiple', value: 1.5 },
    takeProfit: { type: 'rr_ratio', value: 2.0 },
    parameters: {},
    metadata: { createdAt: '2026-06-02T00:00:00.000Z', createdBy: 'mutation' },
  };
}

/** in-memory stub store（DB 不要でロジック検証）。 */
class StubStore implements PopulationStore {
  saved: Record<string, StrategyDSL[]> | null = null;
  constructor(private readonly seed: Record<string, StrategyDSL[]> = {}) {}
  loadAll(): Promise<Record<string, StrategyDSL[]>> {
    return Promise.resolve(this.seed);
  }
  saveAll(populations: Record<string, readonly StrategyDSL[]>): Promise<void> {
    this.saved = Object.fromEntries(
      Object.entries(populations).map(([k, v]) => [k, [...v]]),
    );
    return Promise.resolve();
  }
}

describe('StrategyPopulation DB store 経路 (Phase 4)', () => {
  it('store 注入時、load は store からスナップショットを復元する', async () => {
    const store = new StubStore({ trend: [makeDsl('a'), makeDsl('b')] });
    const pop = new StrategyPopulation(undefined, store);
    await pop.load();
    expect(pop.getByRegime('trend').map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('store 注入時、save は store.saveAll に現在の集団を渡す（file には書かない）', async () => {
    const store = new StubStore();
    const pop = new StrategyPopulation('/should/not/be/used.json', store);
    pop.add('trend', makeDsl('x'));
    pop.add('range', makeDsl('y'));
    await pop.save();
    expect(store.saved).not.toBeNull();
    expect(store.saved?.trend.map((d) => d.id)).toEqual(['x']);
    expect(store.saved?.range.map((d) => d.id)).toEqual(['y']);
  });

  it('store の loadAll が throw しても空集団で継続（種注入経路に倒れる）', async () => {
    const store: PopulationStore = {
      loadAll: () => Promise.reject(new Error('db down')),
      saveAll: () => Promise.resolve(),
    };
    const pop = new StrategyPopulation(undefined, store);
    await expect(pop.load()).resolves.toBeUndefined();
    expect(pop.getByRegime('trend')).toEqual([]);
  });

  it('store 未注入なら従来の file 経路（persistPath なしは no-op で安全）', async () => {
    const pop = new StrategyPopulation();
    await expect(pop.load()).resolves.toBeUndefined();
    await expect(pop.save()).resolves.toBeUndefined();
  });
});
