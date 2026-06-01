/**
 * 進化ループ再設計 Phase 2: generateDeterministicMutants のロジックテスト。
 *
 * analysis-engine への HTTP は stub 注入。親選抜（スコア降順 top count）、
 * optimizeIndicatorPeriods 経由の最適化、SL/TP 適用、lineage（createdBy='mutation'）を検証。
 */

import {
  generateDeterministicMutants,
  type DeterministicMutationDeps,
} from '../../evolution/deterministicMutation';
import type {
  AnalysisEngineOptimizeRequestInput,
  AnalysisEngineOptimizeResponse,
  AnalysisEngineScreeningBacktestResponse,
} from '../../../schemas/external/analysisEngine';
import type { StrategyDSL } from '../../strategy_dsl/schema';

function makeDsl(id: string, period: number, generation = 1): StrategyDSL {
  return {
    id,
    generation,
    parentIds: [],
    regimeTarget: 'trend',
    symbol: 'XAUUSD',
    timeframe: '15m',
    entry: {
      direction: 'long',
      trigger: {
        logic: 'AND',
        conditions: [{ lens: 'ohlcv', feature: 'ema', op: '>', value: 2000, params: { period } }],
      },
      orderType: 'market',
    },
    stopLoss: { type: 'atr_multiple', value: 1.5 },
    takeProfit: { type: 'rr_ratio', value: 2.0 },
    parameters: {},
    metadata: { createdAt: '2026-06-02T00:00:00.000Z', createdBy: 'initial_random' },
  };
}

function screeningResp(sharpe: number): AnalysisEngineScreeningBacktestResponse {
  return {
    summary: { pf: 1.3, winRate: 0.4, tradeCount: 100, maxDD: -10, sharpe, returnPct: 10 },
    trades: [],
    equity: null,
    engineVersion: 'stub',
    unsupportedConditions: [],
  };
}

function optimizeResp(): AnalysisEngineOptimizeResponse {
  return {
    bestParams: { slValue: 1.8, tpValue: 2.4 }, // WF が選んだ SL/TP
    summary: { pf: 1.4, winRate: 0.42, tradeCount: 120, maxDD: -11, sharpe: 0.3, returnPct: 16 },
    equity: null,
    trades: [],
    engineVersion: 'stub',
    overfitGuard: {
      method: 'walk_forward',
      windows: 4,
      minTradesPerWindow: 25,
      trialCount: 9,
      evaluatedFoldCount: 4,
      folds: [],
      aggregateOos: { pf: 1.3, winRate: 0.4, tradeCount: 90, maxDD: null, sharpe: 0.2, returnPct: null },
      dsr: null,
      verdict: 'robust',
    },
  };
}

function emaPeriodOf(req: AnalysisEngineOptimizeRequestInput): number {
  const p = req.notePayload.indicators?.[0]?.params?.period;
  if (typeof p !== 'number') throw new Error('period missing');
  return p;
}

describe('generateDeterministicMutants', () => {
  it('スコア降順 top count の親を最適化し、createdBy=mutation / lineage を設定する', async () => {
    const parents = [makeDsl('p-lo', 20, 2), makeDsl('p-hi', 20, 3)];
    const scores = new Map([
      ['p-lo', 0.5],
      ['p-hi', 1.5],
    ]);
    const deps: DeterministicMutationDeps = {
      runScreeningBacktest: async () => screeningResp(1.0),
      runOptimize: async () => optimizeResp(),
    };

    const mutants = await generateDeterministicMutants(
      { parents, scores, count: 1, startDate: '2025-01-01T00:00:00.000Z', endDate: '2025-12-31T00:00:00.000Z' },
      deps,
    );

    expect(mutants).toHaveLength(1);
    const m = mutants[0];
    expect(m.parentIds).toEqual(['p-hi']); // スコア最大の親
    expect(m.generation).toBe(4); // parent.generation(3)+1
    expect(m.metadata.createdBy).toBe('mutation');
    expect(m.id.startsWith('mut-det-')).toBe(true);
  });

  it('WF が返した bestParams の SL/TP を mutant に適用する', async () => {
    const parents = [makeDsl('p1', 20)];
    const scores = new Map([['p1', 1.0]]);
    const deps: DeterministicMutationDeps = {
      runScreeningBacktest: async () => screeningResp(1.0),
      runOptimize: async () => optimizeResp(),
    };
    const mutants = await generateDeterministicMutants(
      { parents, scores, count: 1, startDate: '2025-01-01T00:00:00.000Z', endDate: '2025-12-31T00:00:00.000Z' },
      deps,
    );
    const m = mutants[0];
    expect(m.stopLoss).toEqual({ type: 'atr_multiple', value: 1.8 });
    expect(m.takeProfit).toEqual({ type: 'rr_ratio', value: 2.4 });
  });

  it('count=2 で 2 親、各親に screening(複数 variant) と WF が走る', async () => {
    const parents = [makeDsl('p1', 20), makeDsl('p2', 30)];
    const scores = new Map([
      ['p1', 1.0],
      ['p2', 0.9],
    ]);
    let screeningCount = 0;
    const wfPeriods: number[] = [];
    const deps: DeterministicMutationDeps = {
      runScreeningBacktest: async () => {
        screeningCount += 1;
        return screeningResp(1.0);
      },
      runOptimize: async (req) => {
        wfPeriods.push(emaPeriodOf(req));
        return optimizeResp();
      },
    };
    const mutants = await generateDeterministicMutants(
      { parents, scores, count: 2, startDate: '2025-01-01T00:00:00.000Z', endDate: '2025-12-31T00:00:00.000Z' },
      deps,
    );
    expect(mutants).toHaveLength(2);
    // 各親 3 variant (±20%/3点) → screening 3×2=6 回、WF は top-1×2=2 回
    expect(screeningCount).toBe(6);
    expect(wfPeriods).toHaveLength(2);
  });

  it('個別 optimize が throw した親はスキップして部分結果を返す', async () => {
    // p1=period20 (variants 16/20/24)、p2=period50 (40/50/60)。period<=30 の screening を
    // throw させ p1 の optimize を全滅 → スキップ、p2 のみ成功する。
    const parents = [makeDsl('p1', 20), makeDsl('p2', 50)];
    const scores = new Map([
      ['p1', 1.0],
      ['p2', 0.9],
    ]);
    const deps: DeterministicMutationDeps = {
      runScreeningBacktest: async (req) => {
        const period = req.notePayload.indicators?.[0]?.params?.period;
        if (typeof period === 'number' && period <= 30) throw new Error('engine down');
        return screeningResp(1.0);
      },
      runOptimize: async () => optimizeResp(),
    };
    const mutants = await generateDeterministicMutants(
      { parents, scores, count: 2, startDate: '2025-01-01T00:00:00.000Z', endDate: '2025-12-31T00:00:00.000Z' },
      deps,
    );
    expect(mutants).toHaveLength(1);
    expect(mutants[0].parentIds).toEqual(['p2']);
  });
});
