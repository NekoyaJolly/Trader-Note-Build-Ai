/**
 * 進化ループ再設計 Phase 4: EvolutionPopulationRepository テスト。
 * Prisma を jest.mock で差し替え、loadAll / saveAll と Zod 検証・要素単位救済を検証する。
 */

const mockFindMany = jest.fn();
const mockUpsert = jest.fn();

jest.mock('../db/client', () => ({
  prisma: {
    evolutionPopulation: {
      findMany: mockFindMany,
      upsert: mockUpsert,
    },
    $disconnect: jest.fn(),
  },
}));

import { EvolutionPopulationRepository } from '../repositories/evolutionPopulationRepository';
import type { StrategyDSL } from '../../side-b/strategy_dsl/schema';

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

beforeEach(() => {
  mockFindMany.mockReset();
  mockUpsert.mockReset();
});

describe('EvolutionPopulationRepository.loadAll', () => {
  it('regime ごとに valid な members を復元する', async () => {
    mockFindMany.mockResolvedValue([
      { regime: 'trend', members: [makeDsl('a'), makeDsl('b')] },
      { regime: 'range', members: [makeDsl('c')] },
    ]);
    const repo = new EvolutionPopulationRepository();
    const out = await repo.loadAll();
    expect(Object.keys(out).sort()).toEqual(['range', 'trend']);
    expect(out.trend.map((d) => d.id)).toEqual(['a', 'b']);
    expect(out.range.map((d) => d.id)).toEqual(['c']);
  });

  it('壊れた member 1 件は要素単位で除外し、regime 全滅させない', async () => {
    mockFindMany.mockResolvedValue([
      { regime: 'trend', members: [makeDsl('a'), { id: 'broken' /* schema 不適合 */ }, makeDsl('b')] },
    ]);
    const repo = new EvolutionPopulationRepository();
    const out = await repo.loadAll();
    expect(out.trend.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('members が配列でない壊れ行は空配列で復元', async () => {
    mockFindMany.mockResolvedValue([{ regime: 'trend', members: { not: 'array' } }]);
    const repo = new EvolutionPopulationRepository();
    const out = await repo.loadAll();
    expect(out.trend).toEqual([]);
  });

  it('findMany が throw しても best-effort で空結果を返す（呼び出し元を壊さない）', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFindMany.mockRejectedValue(new Error('db down'));
    const repo = new EvolutionPopulationRepository();
    await expect(repo.loadAll()).resolves.toEqual({});
    jest.restoreAllMocks();
  });
});

describe('EvolutionPopulationRepository.saveAll', () => {
  it('regime ごとに upsert を呼ぶ（where/create/update）', async () => {
    mockUpsert.mockResolvedValue({});
    const repo = new EvolutionPopulationRepository();
    await repo.saveAll({ trend: [makeDsl('a')], range: [] });
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    const calls = mockUpsert.mock.calls.map((c) => c[0]);
    const trendCall = calls.find((c) => c.where.regime === 'trend');
    expect(trendCall).toBeDefined();
    expect(trendCall.create.regime).toBe('trend');
    expect(Array.isArray(trendCall.update.members)).toBe(true);
  });
});
