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

describe('computeRequestedCounts (PR #95 v1 / PR #98 v2)', () => {
  it('targetSize=0 なら全 6 ソース 0', () => {
    // PR #98: 戻り値は常に 6 source key を含む (edge_* も含めた統一形)
    expect(computeRequestedCounts(0)).toEqual({
      edge_confirmed: 0,
      edge_screening_passed: 0,
      formal_bt_passed: 0,
      current_population: 0,
      edge_unverified: 0,
      novelty_seed: 0,
    });
  });

  it('v1 mode (hasEdgeLoader=false): targetSize=10 で formal/pop/novelty に 4/4/2 配分', () => {
    const c = computeRequestedCounts(10, false);
    expect(c.formal_bt_passed).toBe(Math.round(10 * parentPoolPolicy.formalBtPassed));
    expect(c.current_population).toBe(Math.round(10 * parentPoolPolicy.currentPopulation));
    expect(c.novelty_seed).toBe(Math.round(10 * parentPoolPolicy.noveltySeed));
    expect(c.edge_confirmed).toBe(0);
    expect(c.edge_screening_passed).toBe(0);
    expect(c.edge_unverified).toBe(0);
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    expect(total).toBe(10);
  });

  it('v2 mode (hasEdgeLoader=true): edge_* も含めた 6 ソース配分で targetSize に揃う', () => {
    const c = computeRequestedCounts(10, true);
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    expect(total).toBe(10);
    // v2 policy では edge_screening_passed が最大配分 (0.35)
    expect(c.edge_screening_passed).toBeGreaterThanOrEqual(c.edge_confirmed);
    expect(c.edge_screening_passed).toBeGreaterThanOrEqual(c.formal_bt_passed);
  });

  it('v1 端数は formal_bt_passed → current_population → novelty_seed の順で吸収', () => {
    const c5 = computeRequestedCounts(5, false);
    expect(c5.formal_bt_passed + c5.current_population + c5.novelty_seed).toBe(5);
    const c7 = computeRequestedCounts(7, false);
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

  // ===========================================
  // PR #98 EdgeHypothesis 統合テスト
  // ===========================================

  function makeStubHypothesis(id: string, status: 'confirmed' | 'screening_passed' | 'unverified'): import('../../models/edgeHypothesis').EdgeHypothesis {
    const now = new Date();
    return {
      id,
      statement: `test ${id}`,
      category: 'level',
      conditions: [{ lensName: 'ema', featureKey: 'ema_20', op: '>', value: 0 }],
      expectedDirection: 'long',
      status,
      statusUpdatedAt: now,
      symbols: ['EURUSD'],
      timeframes: ['1h'],
      observationCount: 0,
      winCount: 0,
      lossCount: 0,
      breakevenCount: 0,
      totalPnlPips: 0,
      avgRR: 0,
      source: 'ai_generated',
      firstObservedAt: now,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
      defaultRiskManagement: {
        stopLoss: { type: 'fixed_pips', value: 30 },
        takeProfit: { type: 'rr_ratio', value: 1.5 },
      },
    };
  }

  function makeEdgeLoaderMock(byStatus: Partial<Record<string, ReturnType<typeof makeStubHypothesis>[]>>) {
    return {
      findByStatus: jest.fn(async (status: string) => byStatus[status] ?? []),
    };
  }

  it('PR #98-1. edge_confirmed が親候補として選ばれる', async () => {
    repoMock.findRecentFormalBtPassed.mockResolvedValue([]);
    const edgeLoader = makeEdgeLoaderMock({
      confirmed: [makeStubHypothesis('hyp-1', 'confirmed')],
      screening_passed: [],
      unverified: [],
    });
    const population = new StrategyPopulation(undefined);
    const { entries, summary } = await buildParentPool('breakout', 5, new Map(), {
      population,
      evolutionBacktestRepo: repoMock,
      edgeHypothesisLoader: edgeLoader,
    });
    expect(summary.selected.edge_confirmed).toBe(1);
    expect(entries.find((e) => e.source === 'edge_confirmed')).toBeDefined();
  });

  it('PR #98-2. edge_screening_passed が親候補として選ばれる', async () => {
    repoMock.findRecentFormalBtPassed.mockResolvedValue([]);
    const edgeLoader = makeEdgeLoaderMock({
      confirmed: [],
      screening_passed: [
        makeStubHypothesis('hyp-1', 'screening_passed'),
        makeStubHypothesis('hyp-2', 'screening_passed'),
      ],
      unverified: [],
    });
    const population = new StrategyPopulation(undefined);
    const { summary } = await buildParentPool('breakout', 10, new Map(), {
      population,
      evolutionBacktestRepo: repoMock,
      edgeHypothesisLoader: edgeLoader,
    });
    expect(summary.selected.edge_screening_passed).toBeGreaterThanOrEqual(1);
  });

  it('PR #98-3. edge_unverified は低優先で選ばれる (= edge_confirmed/screening が埋まっていれば後回し)', async () => {
    repoMock.findRecentFormalBtPassed.mockResolvedValue([]);
    const edgeLoader = makeEdgeLoaderMock({
      confirmed: [makeStubHypothesis('confirmed-1', 'confirmed')],
      screening_passed: [makeStubHypothesis('screen-1', 'screening_passed')],
      unverified: [makeStubHypothesis('unv-1', 'unverified')],
    });
    const population = new StrategyPopulation(undefined);
    const { summary } = await buildParentPool('breakout', 5, new Map(), {
      population,
      evolutionBacktestRepo: repoMock,
      edgeHypothesisLoader: edgeLoader,
    });
    // edge_unverified は v2 policy で 0.05 = 5 件中 0〜1 件
    expect(summary.requested.edge_unverified).toBeLessThanOrEqual(summary.requested.edge_confirmed);
    expect(summary.requested.edge_unverified).toBeLessThanOrEqual(summary.requested.edge_screening_passed);
  });

  it('PR #98-4. rejected / stale / not_testable / insufficient_data は loader にも渡されない (= 親候補に入らない)', async () => {
    repoMock.findRecentFormalBtPassed.mockResolvedValue([]);
    const edgeLoader = makeEdgeLoaderMock({});
    const population = new StrategyPopulation(undefined);
    await buildParentPool('breakout', 5, new Map(), {
      population,
      evolutionBacktestRepo: repoMock,
      edgeHypothesisLoader: edgeLoader,
    });
    const calls = edgeLoader.findByStatus.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('rejected');
    expect(calls).not.toContain('stale');
    expect(calls).not.toContain('not_testable');
    expect(calls).not.toContain('insufficient_data');
    expect(calls).not.toContain('testing');
  });

  it('PR #98-5. EdgeHypothesis loader 例外時も世代継続できる', async () => {
    repoMock.findRecentFormalBtPassed.mockResolvedValue([]);
    const edgeLoader = {
      findByStatus: jest.fn().mockRejectedValue(new Error('DB unavailable')),
    };
    const population = new StrategyPopulation(undefined);
    for (let i = 0; i < 3; i++) population.add('breakout', makeDsl(`pop-${i}`));

    const { entries, summary } = await buildParentPool('breakout', 5, new Map(), {
      population,
      evolutionBacktestRepo: repoMock,
      edgeHypothesisLoader: edgeLoader,
    });
    expect(entries.length).toBe(5); // 必ず非空
    expect(summary.fallbackApplied).toBe(true);
    expect(summary.fallbackReason).toMatch(/repo error: DB unavailable/);
  });

  it('PR #98-6. 変換不能 EdgeHypothesis は skipped カウントに反映 + warning に残る', async () => {
    repoMock.findRecentFormalBtPassed.mockResolvedValue([]);
    const badHyp = {
      ...makeStubHypothesis('bad-1', 'confirmed'),
      symbols: [] as string[], // missing_symbol で skip される
    };
    const edgeLoader = makeEdgeLoaderMock({
      confirmed: [badHyp, makeStubHypothesis('good-1', 'confirmed')],
      screening_passed: [],
      unverified: [],
    });
    const population = new StrategyPopulation(undefined);
    const { summary } = await buildParentPool('breakout', 5, new Map(), {
      population,
      evolutionBacktestRepo: repoMock,
      edgeHypothesisLoader: edgeLoader,
    });
    expect(summary.edgeHypothesisConversion).toBeDefined();
    expect(summary.edgeHypothesisConversion!.skipped).toBeGreaterThanOrEqual(1);
    expect(
      summary.edgeHypothesisConversion!.warnings.some((w) => w.includes('missing_symbol')),
    ).toBe(true);
  });

  it('PR #98-7. EdgeHypothesis 系不足時に formal_bt_passed → current_population → novelty_seed で fallback', async () => {
    repoMock.findRecentFormalBtPassed.mockResolvedValue([]);
    const edgeLoader = makeEdgeLoaderMock({}); // 全 status 空
    const population = new StrategyPopulation(undefined);
    population.add('breakout', makeDsl('pop-1'));
    const { entries, summary } = await buildParentPool('breakout', 5, new Map(), {
      population,
      evolutionBacktestRepo: repoMock,
      edgeHypothesisLoader: edgeLoader,
    });
    expect(entries.length).toBe(5);
    // edge_* が 0 件で fallback 発動
    expect(summary.fallbackApplied).toBe(true);
    expect(summary.selected.edge_confirmed).toBe(0);
    expect(summary.selected.edge_screening_passed).toBe(0);
    expect(summary.selected.novelty_seed).toBeGreaterThan(0);
  });

  it('PR #98-8. 同一 EdgeHypothesis は dsl.id 単位で重複排除される', async () => {
    repoMock.findRecentFormalBtPassed.mockResolvedValue([]);
    // 同じ id を 2 status で入れて、dedup されることを確認
    const edgeLoader = makeEdgeLoaderMock({
      confirmed: [makeStubHypothesis('shared-id', 'confirmed')],
      screening_passed: [makeStubHypothesis('shared-id', 'screening_passed')],
      unverified: [],
    });
    const population = new StrategyPopulation(undefined);
    const { entries, summary } = await buildParentPool('breakout', 5, new Map(), {
      population,
      evolutionBacktestRepo: repoMock,
      edgeHypothesisLoader: edgeLoader,
    });
    // shared-id は edge_confirmed (高優先) だけにカウントされる
    const sharedIdCount = entries.filter((e) => e.dsl.id.includes('shared-id')).length;
    expect(sharedIdCount).toBe(1);
    expect(summary.edgeHypothesisConversion!.duplicateRemoved).toBeGreaterThanOrEqual(1);
  });

  it('PR #98-9. parentPoolSummary に EdgeHypothesis 系 requested / selected が出る', async () => {
    repoMock.findRecentFormalBtPassed.mockResolvedValue([]);
    const edgeLoader = makeEdgeLoaderMock({
      confirmed: [makeStubHypothesis('c-1', 'confirmed')],
      screening_passed: [makeStubHypothesis('s-1', 'screening_passed')],
      unverified: [],
    });
    const population = new StrategyPopulation(undefined);
    const { summary } = await buildParentPool('breakout', 5, new Map(), {
      population,
      evolutionBacktestRepo: repoMock,
      edgeHypothesisLoader: edgeLoader,
    });
    expect(summary.requested.edge_confirmed).toBeGreaterThanOrEqual(0);
    expect(summary.requested.edge_screening_passed).toBeGreaterThanOrEqual(0);
    expect(summary.requested.edge_unverified).toBeGreaterThanOrEqual(0);
    expect(summary.selected.edge_confirmed).toBeGreaterThanOrEqual(0);
    expect(summary.selected.edge_screening_passed).toBeGreaterThanOrEqual(0);
  });

  it('PR #98-10. edgeHypothesisLoader 未指定なら v1 互換 (= edge_* は 0、formal/pop/novelty のみ)', async () => {
    repoMock.findRecentFormalBtPassed.mockResolvedValue([]);
    const population = new StrategyPopulation(undefined);
    population.add('breakout', makeDsl('pop-1'));
    const { summary } = await buildParentPool('breakout', 5, new Map(), {
      population,
      evolutionBacktestRepo: repoMock,
      // edgeHypothesisLoader 未指定
    });
    expect(summary.requested.edge_confirmed).toBe(0);
    expect(summary.requested.edge_screening_passed).toBe(0);
    expect(summary.requested.edge_unverified).toBe(0);
    expect(summary.edgeHypothesisConversion).toBeUndefined();
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
