/**
 * 進化ループ再設計 Phase 3: generateDeterministicCrossovers のロジックテスト。
 *
 * analysis-engine への HTTP は stub 注入。負け減 + 勝ち維持の評価、エッジ無し時のスキップ、
 * SL/TP を触らない（slValues/tpValues 空）こと、lineage（createdBy='crossover'）を検証。
 */

import {
  generateDeterministicCrossovers,
  type DeterministicCrossoverDeps,
} from '../../evolution/deterministicCrossover';
import type {
  AnalysisEngineOptimizeRequestInput,
  AnalysisEngineOptimizeResponse,
  AnalysisEngineScreeningBacktestRequest,
  AnalysisEngineScreeningBacktestResponse,
} from '../../../schemas/external/analysisEngine';
import type { Condition, ConditionGroup, StrategyDSL } from '../../strategy_dsl/schema';

function makeDsl(id: string): StrategyDSL {
  return {
    id,
    generation: 2,
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
    metadata: { createdAt: '2026-06-02T00:00:00.000Z', createdBy: 'initial_random' },
  };
}

function screening(
  pf: number,
  winRate: number,
  tradeCount: number,
): AnalysisEngineScreeningBacktestResponse {
  return {
    summary: { pf, winRate, tradeCount, maxDD: -10, sharpe: 0.5, returnPct: 10 },
    trades: [],
    equity: null,
    engineVersion: 'stub',
    unsupportedConditions: [],
  };
}

function optimizeResp(): AnalysisEngineOptimizeResponse {
  return {
    bestParams: {},
    summary: { pf: 1.4, winRate: 0.5, tradeCount: 70, maxDD: -11, sharpe: 0.3, returnPct: 12 },
    equity: null,
    trades: [],
    engineVersion: 'stub',
    overfitGuard: {
      method: 'walk_forward',
      windows: 4,
      minTradesPerWindow: 25,
      trialCount: 1,
      evaluatedFoldCount: 4,
      folds: [],
      aggregateOos: { pf: 1.3, winRate: 0.5, tradeCount: 60, maxDD: null, sharpe: 0.2, returnPct: null },
      dsr: null,
      verdict: 'robust',
    },
  };
}

/** screening リクエストが「親 baseline（追加条件なし）」か判定。 */
function isBaseline(req: AnalysisEngineScreeningBacktestRequest): boolean {
  const tg = req.notePayload.triggerGroup;
  // baseline は条件 1 個（close>2000）、variant は 2 個（+ 追加インジ）。
  return !tg || tg.conditions.length <= 1;
}

const BASE_PARAMS = {
  startDate: '2025-01-01T00:00:00.000Z',
  endDate: '2025-12-31T00:00:00.000Z',
};

describe('generateDeterministicCrossovers', () => {
  it('負け減 + 勝ち維持の variant をエッジ採用し、createdBy=crossover を設定', async () => {
    const parent = makeDsl('p1');
    // baseline: 100 trades, winRate 0.4 → wins40 losses60。
    // variant: winRate 0.5, tradeCount 90 → wins45 losses45（負け 60→45 減・勝ち 40→45 維持）。
    const deps: DeterministicCrossoverDeps = {
      runScreeningBacktest: async (req) =>
        isBaseline(req) ? screening(1.0, 0.4, 100) : screening(1.6, 0.5, 90),
      runOptimize: async () => optimizeResp(),
    };

    const children = await generateDeterministicCrossovers(
      { parents: [parent], scores: new Map([['p1', 1]]), count: 1, ...BASE_PARAMS, variantOptions: { indicatorIds: ['rsi'] } },
      deps,
    );

    expect(children).toHaveLength(1);
    const child = children[0];
    expect(child.metadata.createdBy).toBe('crossover');
    expect(child.parentIds).toEqual(['p1']);
    expect(child.generation).toBe(3);
    expect(child.id.startsWith('x-det-')).toBe(true);
    // 追加条件が入っている（親 1 + rsi 1）
    const conds = (child.entry as { trigger: ConditionGroup }).trigger.conditions;
    expect(conds).toHaveLength(2);
    expect((conds[1] as Condition).feature).toBe('rsi');
    // SL/TP は親のまま不変
    expect(child.stopLoss).toEqual({ type: 'atr_multiple', value: 1.5 });
  });

  it('どの variant も負けを減らせない / 勝ちを壊すならエッジ無しでスキップ', async () => {
    const parent = makeDsl('p1');
    // variant が負け増 or 勝ち激減 → eligible なし。
    const deps: DeterministicCrossoverDeps = {
      runScreeningBacktest: async (req) =>
        isBaseline(req) ? screening(1.0, 0.5, 100) : screening(0.8, 0.3, 40), // wins12 << baseline wins50
      runOptimize: async () => optimizeResp(),
    };
    const children = await generateDeterministicCrossovers(
      { parents: [parent], scores: new Map([['p1', 1]]), count: 1, ...BASE_PARAMS, variantOptions: { indicatorIds: ['rsi'] } },
      deps,
    );
    expect(children).toHaveLength(0);
  });

  it('stage-2 WF は SL/TP を触らない（slValues/tpValues 空で呼ぶ）', async () => {
    const parent = makeDsl('p1');
    let optReq: AnalysisEngineOptimizeRequestInput | null = null;
    const deps: DeterministicCrossoverDeps = {
      runScreeningBacktest: async (req) =>
        isBaseline(req) ? screening(1.0, 0.4, 100) : screening(1.6, 0.5, 90),
      runOptimize: async (req) => {
        optReq = req;
        return optimizeResp();
      },
    };
    await generateDeterministicCrossovers(
      { parents: [parent], scores: new Map([['p1', 1]]), count: 1, ...BASE_PARAMS, variantOptions: { indicatorIds: ['rsi'] } },
      deps,
    );
    expect(optReq).not.toBeNull();
    expect(optReq!.slValues).toEqual([]);
    expect(optReq!.tpValues).toEqual([]);
  });

  it('baseline BT が失敗した親はスキップしてログする', async () => {
    const parent = makeDsl('p1');
    const logs: string[] = [];
    const deps: DeterministicCrossoverDeps = {
      runScreeningBacktest: async (req) => {
        if (isBaseline(req)) throw new Error('engine down');
        return screening(1.6, 0.5, 90);
      },
      runOptimize: async () => optimizeResp(),
    };
    const children = await generateDeterministicCrossovers(
      { parents: [parent], scores: new Map([['p1', 1]]), count: 1, ...BASE_PARAMS, variantOptions: { indicatorIds: ['rsi'] }, log: (m) => logs.push(m) },
      deps,
    );
    expect(children).toHaveLength(0);
    expect(logs.some((m) => m.includes('baseline BT failed parent=p1'))).toBe(true);
  });
});
