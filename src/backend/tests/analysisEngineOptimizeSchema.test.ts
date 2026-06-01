/**
 * 進化ループ再設計 Phase 1: `/v1/optimize` の Zod schema 契約テスト。
 *
 * analysis-engine (Python) には Python テスト基盤がなく CI は Docker build のみのため、
 * Node ↔ Python 境界の契約は本テスト (request/response の round-trip + default 埋め) で守る。
 */

import {
  AnalysisEngineOptimizeRequestSchema,
  AnalysisEngineOptimizeResponseSchema,
  type ScreeningBacktestNotePayload,
} from '../../schemas/external/analysisEngine';

const NOTE_PAYLOAD: ScreeningBacktestNotePayload = {
  direction: 'long',
  conditions: [],
  stopLoss: { type: 'atr_multiple', value: 1.5 },
  takeProfit: { type: 'rr_ratio', value: 2.0 },
  indicators: [],
};

describe('AnalysisEngineOptimizeRequestSchema', () => {
  it('default 付きフィールドを省略しても parse でき、既定値が埋まる', () => {
    const parsed = AnalysisEngineOptimizeRequestSchema.parse({
      hypothesisId: 'hyp-1',
      symbol: 'EURUSD',
      timeframe: 'H1',
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2025-12-31T00:00:00.000Z',
      notePayload: NOTE_PAYLOAD,
    });

    // config / slValues / tpValues / maximize / method の既定値が埋まる
    expect(parsed.config).toEqual({ initialCapital: 10_000, leverage: 1, tradingCost: 0 });
    expect(parsed.slValues).toEqual([]);
    expect(parsed.tpValues).toEqual([]);
    expect(parsed.maximize).toBe('sharpe');
    expect(parsed.method).toBe('grid');
    expect(parsed.maxTries).toBeUndefined();
  });

  it('探索候補・最大化指標・method を明示すると保持される', () => {
    const parsed = AnalysisEngineOptimizeRequestSchema.parse({
      hypothesisId: 'hyp-2',
      symbol: 'XAUUSD',
      timeframe: 'H4',
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2025-12-31T00:00:00.000Z',
      notePayload: NOTE_PAYLOAD,
      slValues: [1.2, 1.5, 1.8],
      tpValues: [1.8, 2.2, 2.6],
      maximize: 'profit_factor',
      method: 'sambo',
      maxTries: 50,
    });

    expect(parsed.slValues).toEqual([1.2, 1.5, 1.8]);
    expect(parsed.tpValues).toEqual([1.8, 2.2, 2.6]);
    expect(parsed.maximize).toBe('profit_factor');
    expect(parsed.method).toBe('sambo');
    expect(parsed.maxTries).toBe(50);
  });

  it('不正な探索候補 (負値) / 未知の maximize は弾く', () => {
    expect(() =>
      AnalysisEngineOptimizeRequestSchema.parse({
        hypothesisId: 'hyp-3',
        symbol: 'EURUSD',
        timeframe: 'H1',
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2025-12-31T00:00:00.000Z',
        notePayload: NOTE_PAYLOAD,
        slValues: [-1],
      }),
    ).toThrow();

    expect(() =>
      AnalysisEngineOptimizeRequestSchema.parse({
        hypothesisId: 'hyp-4',
        symbol: 'EURUSD',
        timeframe: 'H1',
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2025-12-31T00:00:00.000Z',
        notePayload: NOTE_PAYLOAD,
        maximize: 'sortino',
      }),
    ).toThrow();
  });
});

describe('AnalysisEngineOptimizeResponseSchema', () => {
  it('Python 側レスポンスを parse し bestParams / summary を保持する', () => {
    const parsed = AnalysisEngineOptimizeResponseSchema.parse({
      bestParams: { opt_sl_value: 1.8, opt_tp_value: 2.2 },
      summary: {
        pf: 1.4,
        winRate: 0.42,
        tradeCount: 87,
        maxDD: -12.3,
        sharpe: 0.9,
        returnPct: 18.5,
      },
      trades: [],
      equity: [10_000, 10_120, 10_540],
      engineVersion: 'backtesting.py-0.6.5',
    });

    expect(parsed.bestParams).toEqual({ opt_sl_value: 1.8, opt_tp_value: 2.2 });
    expect(parsed.summary.tradeCount).toBe(87);
    expect(parsed.equity).toEqual([10_000, 10_120, 10_540]);
    expect(parsed.engineVersion).toBe('backtesting.py-0.6.5');
  });

  it('0 トレード (空探索) レスポンスの既定値で parse できる', () => {
    const parsed = AnalysisEngineOptimizeResponseSchema.parse({
      summary: {
        pf: 0,
        winRate: 0,
        tradeCount: 0,
        maxDD: null,
        sharpe: null,
        returnPct: null,
      },
      engineVersion: 'backtesting.py-0.6.5',
    });

    expect(parsed.bestParams).toEqual({});
    expect(parsed.trades).toEqual([]);
    expect(parsed.equity).toBeNull();
    // Phase 1b: overfitGuard 未指定なら null（WF 無効レスポンス互換）
    expect(parsed.overfitGuard).toBeNull();
  });
});

describe('AnalysisEngineOptimizeRequestSchema walkForward (Phase 1b)', () => {
  it('walkForward 未指定なら WF 有効・windows=4・floor=25 の既定が埋まる', () => {
    const parsed = AnalysisEngineOptimizeRequestSchema.parse({
      hypothesisId: 'hyp-wf-1',
      symbol: 'EURUSD',
      timeframe: 'H1',
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2025-12-31T00:00:00.000Z',
      notePayload: NOTE_PAYLOAD,
    });
    expect(parsed.walkForward).toEqual({ enabled: true, windows: 4, minTradesPerWindow: 25 });
  });

  it('walkForward を明示すると保持され、enabled=false（Phase 1 互換）も指定できる', () => {
    const parsed = AnalysisEngineOptimizeRequestSchema.parse({
      hypothesisId: 'hyp-wf-2',
      symbol: 'XAUUSD',
      timeframe: 'H4',
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2025-12-31T00:00:00.000Z',
      notePayload: NOTE_PAYLOAD,
      walkForward: { enabled: false, windows: 6, minTradesPerWindow: 50 },
    });
    expect(parsed.walkForward).toEqual({ enabled: false, windows: 6, minTradesPerWindow: 50 });
  });

  it('windows は 1..12 の範囲外を弾く', () => {
    expect(() =>
      AnalysisEngineOptimizeRequestSchema.parse({
        hypothesisId: 'hyp-wf-3',
        symbol: 'EURUSD',
        timeframe: 'H1',
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2025-12-31T00:00:00.000Z',
        notePayload: NOTE_PAYLOAD,
        walkForward: { windows: 0 },
      }),
    ).toThrow();
  });
});

describe('AnalysisEngineOptimizeResponseSchema overfitGuard (Phase 1b)', () => {
  it('WF 有効レスポンス（folds + dsr + verdict）を parse する', () => {
    const parsed = AnalysisEngineOptimizeResponseSchema.parse({
      bestParams: { slValue: 1.0, tpValue: 2.5 },
      summary: { pf: 1.37, winRate: 0.36, tradeCount: 271, maxDD: -15, sharpe: 0.2, returnPct: 22 },
      trades: [],
      equity: null,
      engineVersion: 'backtesting.py-0.6.5',
      overfitGuard: {
        method: 'walk_forward',
        windows: 4,
        minTradesPerWindow: 25,
        trialCount: 9,
        evaluatedFoldCount: 4,
        folds: [
          {
            foldIndex: 1,
            trainStartIndex: 0,
            trainEndIndex: 240,
            oosStartIndex: 240,
            oosEndIndex: 480,
            bestParams: { slValue: 1.0, tpValue: 2.5 },
            oosSummary: { pf: 1.4, winRate: 0.4, tradeCount: 50, maxDD: null, sharpe: 0.15, returnPct: null },
            oosTradeCount: 50,
            evaluated: true,
            skipReason: null,
          },
        ],
        aggregateOos: { pf: 1.38, winRate: 0.39, tradeCount: 233, maxDD: null, sharpe: 0.147, returnPct: null },
        dsr: {
          dsr: -30.87,
          sharpeRatio: 0.147,
          expectedMaxSr: 2.096,
          sampleSize: 233,
          notComputable: null,
        },
        verdict: 'robust',
      },
    });
    expect(parsed.overfitGuard?.verdict).toBe('robust');
    expect(parsed.overfitGuard?.folds).toHaveLength(1);
    expect(parsed.overfitGuard?.dsr?.dsr).toBeCloseTo(-30.87);
    expect(parsed.overfitGuard?.trialCount).toBe(9);
  });

  it('not_evaluated（dsr=null・folds 空）の WF レスポンスを parse する', () => {
    const parsed = AnalysisEngineOptimizeResponseSchema.parse({
      summary: { pf: 0, winRate: 0, tradeCount: 0, maxDD: null, sharpe: null, returnPct: null },
      engineVersion: 'backtesting.py-0.6.5',
      overfitGuard: {
        method: 'walk_forward',
        windows: 4,
        minTradesPerWindow: 25,
        trialCount: 9,
        evaluatedFoldCount: 0,
        aggregateOos: { pf: 0, winRate: 0, tradeCount: 0, maxDD: null, sharpe: null, returnPct: null },
        verdict: 'not_evaluated',
      },
    });
    expect(parsed.overfitGuard?.verdict).toBe('not_evaluated');
    expect(parsed.overfitGuard?.folds).toEqual([]);
    expect(parsed.overfitGuard?.dsr).toBeNull();
  });

  it('未知の verdict は弾く', () => {
    expect(() =>
      AnalysisEngineOptimizeResponseSchema.parse({
        summary: { pf: 0, winRate: 0, tradeCount: 0, maxDD: null, sharpe: null, returnPct: null },
        engineVersion: 'backtesting.py-0.6.5',
        overfitGuard: {
          method: 'walk_forward',
          windows: 4,
          minTradesPerWindow: 25,
          trialCount: 9,
          evaluatedFoldCount: 0,
          aggregateOos: { pf: 0, winRate: 0, tradeCount: 0, maxDD: null, sharpe: null, returnPct: null },
          verdict: 'maybe',
        },
      }),
    ).toThrow();
  });
});
