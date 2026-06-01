/**
 * 進化ループ再設計 Phase 1c: optimizeIndicatorPeriods のロジックテスト。
 *
 * analysis-engine への HTTP は stub 注入し、2 段階の選抜ロジック（screening ランク →
 * 上位 K に WF → verdict/集計でベスト確定）と wf_all 戦略・フォールバックを検証する。
 */

import {
  optimizeIndicatorPeriods,
  type OptimizeIndicatorPeriodsDeps,
  type OptimizeIndicatorPeriodsParams,
} from '../../strategy_dsl/optimizeIndicatorPeriods';
import type {
  AnalysisEngineOptimizeRequestInput,
  AnalysisEngineOptimizeResponse,
  AnalysisEngineOverfitGuard,
  AnalysisEngineScreeningBacktestRequest,
  AnalysisEngineScreeningBacktestResponse,
} from '../../../schemas/external/analysisEngine';
import type { StrategyDSL } from '../../strategy_dsl/schema';

function makeDsl(period: number): StrategyDSL {
  return {
    id: 'dsl-1',
    generation: 0,
    parentIds: [],
    regimeTarget: 'trend',
    symbol: 'XAUUSD',
    timeframe: '15m',
    entry: {
      direction: 'long',
      trigger: {
        logic: 'AND',
        conditions: [
          { lens: 'ohlcv', feature: 'ema', op: '>', value: 2000, params: { period } },
        ],
      },
      orderType: 'market',
    },
    stopLoss: { type: 'atr_multiple', value: 1.5 },
    takeProfit: { type: 'rr_ratio', value: 2.0 },
    parameters: {},
    metadata: { createdAt: '2026-06-02T00:00:00.000Z', createdBy: 'mutation' },
  };
}

const BASE_PARAMS: OptimizeIndicatorPeriodsParams = {
  dsl: makeDsl(20), // ±20%/3点 → [16,20,24]
  hypothesisId: 'hyp-1c',
  symbol: 'XAUUSD',
  timeframe: '15m',
  startDate: '2025-01-01T00:00:00.000Z',
  endDate: '2025-12-31T00:00:00.000Z',
  config: { initialCapital: 10_000, leverage: 1, tradingCost: 0 },
  slValues: [1.0, 1.5, 2.0],
  tpValues: [1.5, 2.0, 2.5],
};

/** リクエストの notePayload から ema period を取り出す（stub のスコア決定用）。 */
function periodOf(
  req: AnalysisEngineScreeningBacktestRequest | AnalysisEngineOptimizeRequestInput,
): number {
  const spec = req.notePayload.indicators?.[0];
  const p = spec?.params?.period;
  if (typeof p !== 'number') throw new Error('period not found in notePayload');
  return p;
}

function screeningResp(
  sharpe: number,
  pf: number,
  tradeCount: number,
): AnalysisEngineScreeningBacktestResponse {
  return {
    summary: { pf, winRate: 0.4, tradeCount, maxDD: -10, sharpe, returnPct: 10 },
    trades: [],
    equity: null,
    engineVersion: 'stub',
    unsupportedConditions: [],
  };
}

function overfitGuard(
  verdict: AnalysisEngineOverfitGuard['verdict'],
  aggSharpe: number,
  aggPf: number,
): AnalysisEngineOverfitGuard {
  return {
    method: 'walk_forward',
    windows: 4,
    minTradesPerWindow: 25,
    trialCount: 9,
    evaluatedFoldCount: verdict === 'not_evaluated' ? 0 : 4,
    folds: [],
    aggregateOos: { pf: aggPf, winRate: 0.4, tradeCount: 100, maxDD: null, sharpe: aggSharpe, returnPct: null },
    dsr: null,
    verdict,
  };
}

function optimizeResp(
  guard: AnalysisEngineOverfitGuard | null,
  period: number,
): AnalysisEngineOptimizeResponse {
  return {
    bestParams: { slValue: 1.5, tpValue: 2.0, _period: period },
    summary: { pf: 1.2, winRate: 0.4, tradeCount: 120, maxDD: -12, sharpe: 0.3, returnPct: 15 },
    equity: null,
    trades: [],
    engineVersion: 'stub',
    overfitGuard: guard,
  };
}

describe('optimizeIndicatorPeriods (two_stage)', () => {
  it('screening を sharpe でランクし、上位1の variant にだけ WF をかけてベストを返す', async () => {
    const screeningCalls: number[] = [];
    const wfCalls: number[] = [];
    // sharpe: period24=1.5(best) > 20=1.0 > 16=0.5、いずれも eligible
    const sharpeByPeriod: Record<number, number> = { 16: 0.5, 20: 1.0, 24: 1.5 };
    const deps: OptimizeIndicatorPeriodsDeps = {
      runScreeningBacktest: async (req) => {
        const p = periodOf(req);
        screeningCalls.push(p);
        return screeningResp(sharpeByPeriod[p], 1.3, 100);
      },
      runOptimize: async (req) => {
        const p = periodOf(req);
        wfCalls.push(p);
        return optimizeResp(overfitGuard('robust', 0.9, 1.4), p);
      },
    };

    const res = await optimizeIndicatorPeriods(BASE_PARAMS, deps);

    // 3 variant 全てを screening、WF は top-1 のみ
    expect(screeningCalls.sort((a, b) => a - b)).toEqual([16, 20, 24]);
    expect(wfCalls).toEqual([24]);
    // ベストは sharpe 最大の period=24
    expect(res.bestParams._period).toBe(24);
    expect(res.overfitGuard?.verdict).toBe('robust');
    expect(res.strategyUsed).toBe('two_stage');
    expect(res.variantMeta.returnedCount).toBe(3);
    // screening はランク済み（先頭が最良 = period 24）
    expect(res.screening[0].fitness).toBe(1.5);
  });

  it('topK=2 のとき WF は上位2件、verdict 優先でベスト選択（robust > overfit_suspected）', async () => {
    const wfCalls: number[] = [];
    const sharpeByPeriod: Record<number, number> = { 16: 0.5, 20: 1.4, 24: 1.5 };
    // sharpe 上位は 24,20。WF で 24=overfit_suspected, 20=robust → 20 を選ぶべき
    const guardByPeriod: Record<number, AnalysisEngineOverfitGuard> = {
      24: overfitGuard('overfit_suspected', 0.2, 1.05),
      20: overfitGuard('robust', 0.5, 1.3),
    };
    const deps: OptimizeIndicatorPeriodsDeps = {
      runScreeningBacktest: async (req) => screeningResp(sharpeByPeriod[periodOf(req)], 1.3, 100),
      runOptimize: async (req) => {
        const p = periodOf(req);
        wfCalls.push(p);
        return optimizeResp(guardByPeriod[p], p);
      },
    };

    const res = await optimizeIndicatorPeriods({ ...BASE_PARAMS, topK: 2 }, deps);
    expect(wfCalls.sort((a, b) => a - b)).toEqual([20, 24]);
    expect(res.bestParams._period).toBe(20); // robust が overfit_suspected に勝つ
    expect(res.overfitGuard?.verdict).toBe('robust');
  });

  it('eligible が皆無（全 variant が floor 未満）なら base にフォールバックして WF を 1 本回す', async () => {
    const wfCalls: number[] = [];
    const deps: OptimizeIndicatorPeriodsDeps = {
      runScreeningBacktest: async () => screeningResp(2.0, 2.0, 5), // tradeCount=5 < floor30
      runOptimize: async (req) => {
        const p = periodOf(req);
        wfCalls.push(p);
        return optimizeResp(overfitGuard('not_evaluated', 0, 0), p);
      },
    };
    const res = await optimizeIndicatorPeriods(BASE_PARAMS, deps);
    expect(wfCalls).toEqual([20]); // base = period 20
    expect(res.bestParams._period).toBe(20);
    expect(res.screening.every((e) => !e.eligible)).toBe(true);
  });
});

describe('optimizeIndicatorPeriods (wf_all)', () => {
  it('全 variant に WF をかけ、screening は空、verdict→集計OOSでベスト選択', async () => {
    const wfCalls: number[] = [];
    let screeningCount = 0;
    const guardByPeriod: Record<number, AnalysisEngineOverfitGuard> = {
      16: overfitGuard('overfit_suspected', 0.1, 1.05),
      20: overfitGuard('robust', 0.4, 1.2),
      24: overfitGuard('robust', 0.6, 1.5), // robust 同士は aggregate sharpe で 24 勝ち
    };
    const deps: OptimizeIndicatorPeriodsDeps = {
      runScreeningBacktest: async () => {
        screeningCount += 1;
        return screeningResp(1, 1, 100);
      },
      runOptimize: async (req) => {
        const p = periodOf(req);
        wfCalls.push(p);
        return optimizeResp(guardByPeriod[p], p);
      },
    };
    const res = await optimizeIndicatorPeriods({ ...BASE_PARAMS, strategy: 'wf_all' }, deps);
    expect(screeningCount).toBe(0); // screening を回さない
    expect(wfCalls.sort((a, b) => a - b)).toEqual([16, 20, 24]);
    expect(res.bestParams._period).toBe(24); // robust かつ aggregate sharpe 最大
    expect(res.screening).toEqual([]);
    expect(res.evaluated).toHaveLength(3);
  });
});

describe('optimizeIndicatorPeriods (no axes)', () => {
  it('period 系 param が無い戦略は base 1 件だけ WF にかける', async () => {
    const wfCalls = { n: 0 };
    const noAxisDsl: StrategyDSL = {
      ...makeDsl(20),
      entry: {
        direction: 'long',
        trigger: { logic: 'AND', conditions: [{ lens: 'rsi', feature: 'value', op: '<', value: 30 }] },
        orderType: 'market',
      },
    };
    const deps: OptimizeIndicatorPeriodsDeps = {
      runScreeningBacktest: async () => screeningResp(1, 1.2, 100),
      runOptimize: async () => {
        wfCalls.n += 1;
        return optimizeResp(overfitGuard('robust', 0.5, 1.3), 0);
      },
    };
    const res = await optimizeIndicatorPeriods({ ...BASE_PARAMS, dsl: noAxisDsl }, deps);
    expect(res.variantMeta.axisCount).toBe(0);
    expect(res.variantMeta.returnedCount).toBe(1);
    expect(wfCalls.n).toBe(1);
  });
});
