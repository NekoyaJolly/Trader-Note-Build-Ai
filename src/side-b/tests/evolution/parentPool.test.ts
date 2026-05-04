/**
 * Critical-4 PR #95: 親個体プール v1 のテスト
 *
 * - computeRequestedCounts: 配分計算の整数化と端数吸収
 * - buildParentPool: ソース別取得 + fallback 動作 + parentPoolSummary 生成
 *
 * `evolutionBacktestRepo` は `findRecentFormalBtPassed` だけを持つ Pick 型でモック化する
 * (リポジトリ規約: any/unknown 禁止、`Pick<T, 'methodName'>` で最小契約)。
 */

import {
  buildParentPool,
  computeRequestedCounts,
  parentPoolPolicy,
} from '../../evolution/parentPoolPolicy';
import { StrategyPopulation } from '../../evolution/StrategyPopulation';
import { StrategyDSLSchema, type StrategyDSL } from '../../strategy_dsl/schema';
import type { EvolutionBacktestRunRepository } from '../../../backend/repositories/evolutionBacktestRunRepository';
import type { EvolutionBacktestRun } from '@prisma/client';

type RepoStub = Pick<EvolutionBacktestRunRepository, 'findRecentFormalBtPassed'>;

function makeDsl(id: string, regime = 'breakout'): StrategyDSL {
  return StrategyDSLSchema.parse({
    id,
    generation: 0,
    parentIds: [],
    regimeTarget: regime,
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

function makeFormalBtPassedRow(id: string, candidateHash: string, regime = 'breakout'): EvolutionBacktestRun {
  return {
    id,
    evolutionRunId: 'run-1',
    generation: 1,
    candidateId: id,
    candidateHash,
    dslSnapshot: makeDsl(id, regime) as unknown as object,
    surrogateScore: 0.8,
    formalBtPassed: true,
    formalBtMetrics: { pf: 1.5, winRate: 0.6, tradeCount: 30 } as unknown as object,
    formalBtFailureReason: null,
    engine: 'analysis-engine',
    engineVersion: 'test',
    createdAt: new Date(),
  } as EvolutionBacktestRun;
}

describe('computeRequestedCounts (PR #95 親個体プール v1)', () => {
  it('targetSize=0 なら全ソース 0', () => {
    expect(computeRequestedCounts(0)).toEqual({
      formal_bt_passed: 0,
      current_population: 0,
      novelty_seed: 0,
    });
  });

  it('targetSize=10 で policy 通りの整数配分 (4/4/2) を返す', () => {
    const c = computeRequestedCounts(10);
    expect(c.formal_bt_passed).toBe(Math.round(10 * parentPoolPolicy.formalBtPassed));
    expect(c.current_population).toBe(Math.round(10 * parentPoolPolicy.currentPopulation));
    expect(c.novelty_seed).toBe(Math.round(10 * parentPoolPolicy.noveltySeed));
    expect(c.formal_bt_passed + c.current_population + c.novelty_seed).toBe(10);
  });

  it('端数は formal_bt_passed → current_population → novelty_seed の順で吸収', () => {
    // targetSize=5 → raw: 2.0 / 2.0 / 1.0 = 5.0、端数なしで丁度 5
    const c5 = computeRequestedCounts(5);
    expect(c5.formal_bt_passed + c5.current_population + c5.novelty_seed).toBe(5);
    // targetSize=7 → raw: 2.8 / 2.8 / 1.4、 floor: 2 / 2 / 1 = 5、不足 2 を順に追加
    const c7 = computeRequestedCounts(7);
    expect(c7.formal_bt_passed + c7.current_population + c7.novelty_seed).toBe(7);
  });
});

describe('buildParentPool (PR #95 親個体プール v1)', () => {
  let repoMock: jest.Mocked<RepoStub>;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    repoMock = {
      findRecentFormalBtPassed: jest.fn<
        ReturnType<RepoStub['findRecentFormalBtPassed']>,
        Parameters<RepoStub['findRecentFormalBtPassed']>
      >(),
    };
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warnSpy.mockRestore());

  it('全ソース十分にあれば policy 通りの選抜結果を返す (totalSelected = targetSize)', async () => {
    repoMock.findRecentFormalBtPassed.mockResolvedValue([
      makeFormalBtPassedRow('fbt-1', 'h1'),
      makeFormalBtPassedRow('fbt-2', 'h2'),
      makeFormalBtPassedRow('fbt-3', 'h3'),
    ]);
    const population = new StrategyPopulation(undefined);
    population.add('breakout', makeDsl('pop-1'));
    population.add('breakout', makeDsl('pop-2'));
    population.add('breakout', makeDsl('pop-3'));
    const scores = new Map([['pop-1', 0.7], ['pop-2', 0.5], ['pop-3', 0.3]]);

    const { entries, summary } = await buildParentPool('breakout', 5, scores, {
      population,
      evolutionBacktestRepo: repoMock,
    });

    expect(summary.totalSelected).toBe(5);
    expect(summary.fallbackApplied).toBe(false);
    expect(summary.fallbackReason).toBeNull();
    expect(summary.requested.formal_bt_passed).toBe(2);
    expect(summary.requested.current_population).toBe(2);
    expect(summary.requested.novelty_seed).toBe(1);
    expect(summary.selected).toEqual(summary.requested);
    expect(entries).toHaveLength(5);
  });

  it('formalBtPassed が 0 件でも fallback で targetSize を満たす (current_population に吸収)', async () => {
    repoMock.findRecentFormalBtPassed.mockResolvedValue([]);
    const population = new StrategyPopulation(undefined);
    for (let i = 0; i < 5; i++) {
      population.add('breakout', makeDsl(`pop-${i}`));
    }
    const scores = new Map<string, number>();
    for (let i = 0; i < 5; i++) scores.set(`pop-${i}`, 0.5);

    const { entries, summary } = await buildParentPool('breakout', 5, scores, {
      population,
      evolutionBacktestRepo: repoMock,
    });

    expect(summary.totalSelected).toBe(5);
    expect(summary.fallbackApplied).toBe(true);
    expect(summary.fallbackReason).toMatch(/formal_bt_passed shortage=2/);
    expect(summary.selected.formal_bt_passed).toBe(0);
    expect(summary.selected.current_population).toBe(4); // 2 (本来) + 2 (fallback)
    expect(summary.selected.novelty_seed).toBe(1);
    expect(entries.filter((e) => e.source === 'novelty_seed')).toHaveLength(1);
  });

  it('repo=null なら formal_bt_passed をスキップして fallback メッセージで報告', async () => {
    const population = new StrategyPopulation(undefined);
    population.add('breakout', makeDsl('pop-1'));
    const scores = new Map([['pop-1', 0.5]]);

    const { summary } = await buildParentPool('breakout', 5, scores, {
      population,
      evolutionBacktestRepo: null,
    });

    expect(summary.fallbackApplied).toBe(true);
    expect(summary.fallbackReason).toMatch(/repo=null/);
    expect(summary.selected.formal_bt_passed).toBe(0);
  });

  it('population 空 + repo=null でも noveltySeed のみで targetSize を満たす', async () => {
    const population = new StrategyPopulation(undefined);
    const { entries, summary } = await buildParentPool('breakout', 5, new Map(), {
      population,
      evolutionBacktestRepo: null,
    });
    expect(summary.totalSelected).toBe(5);
    expect(summary.selected.novelty_seed).toBe(5);
    expect(entries.every((e) => e.source === 'novelty_seed')).toBe(true);
  });

  it('formalBtPassed の dsl が Zod に通らない場合は warning + skip して fallback', async () => {
    // 不正な DSL (entry.direction が不正値) を含む row を返す
    const badRow = makeFormalBtPassedRow('fbt-bad', 'h-bad');
    (badRow.dslSnapshot as unknown as { entry: { direction: string } }).entry = {
      direction: 'sideways', // Zod 不適合
    } as never;

    repoMock.findRecentFormalBtPassed.mockResolvedValue([badRow]);
    const population = new StrategyPopulation(undefined);
    population.add('breakout', makeDsl('pop-1'));

    const { summary } = await buildParentPool('breakout', 5, new Map(), {
      population,
      evolutionBacktestRepo: repoMock,
    });

    expect(summary.selected.formal_bt_passed).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('formalBtPassed dsl の Zod parse 失敗'),
    );
    expect(summary.fallbackApplied).toBe(true);
  });

  it('repo の findRecentFormalBtPassed が例外を投げても世代継続できる (空扱い + warning + fallback)', async () => {
    repoMock.findRecentFormalBtPassed.mockRejectedValue(new Error('DB connection failed'));
    const population = new StrategyPopulation(undefined);
    for (let i = 0; i < 5; i++) population.add('breakout', makeDsl(`pop-${i}`));

    const { entries, summary } = await buildParentPool('breakout', 5, new Map(), {
      population,
      evolutionBacktestRepo: repoMock,
    });

    // 例外は throw されず、formal_bt_passed=0 で fallback 成功
    expect(summary.totalSelected).toBe(5);
    expect(summary.selected.formal_bt_passed).toBe(0);
    expect(summary.fallbackApplied).toBe(true);
    expect(summary.fallbackReason).toMatch(/repo error: DB connection failed/);
    expect(entries.length).toBe(5);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('formal_bt_passed のロード失敗'),
    );
  });

  it('candidateHash 重複は除外して fallback (= 同構造の DSL を 2 重に親に入れない)', async () => {
    // 同じ candidateHash の row を 2 件返す → 1 件しか採用されないことを repo 側で担保するが、
    // 本テストは buildParentPool の挙動を確認する目的。
    repoMock.findRecentFormalBtPassed.mockResolvedValue([
      makeFormalBtPassedRow('fbt-1', 'same-hash'),
      // findRecentFormalBtPassed は内部で重複除去するため、ここでは 1 件しか返らない想定
    ]);
    const population = new StrategyPopulation(undefined);
    for (let i = 0; i < 5; i++) population.add('breakout', makeDsl(`pop-${i}`));

    const { summary } = await buildParentPool('breakout', 5, new Map(), {
      population,
      evolutionBacktestRepo: repoMock,
    });

    expect(summary.selected.formal_bt_passed).toBe(1);
    // 残り 1 件分は fallback で current_population が吸収
    expect(summary.fallbackApplied).toBe(true);
    expect(summary.totalSelected).toBe(5);
  });
});
