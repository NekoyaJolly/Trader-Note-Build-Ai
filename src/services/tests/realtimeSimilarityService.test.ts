/**
 * RealtimeSimilarityService (Phase δ-1: レンズエンジン統一) のユニットテスト
 *
 * 検証観点:
 * - バー確定でレンズ評価 (正規パイプライン) が trigger='realtime' + symbolFilter で起動する
 * - 同一シンボルのクールダウン中はスキップする
 * - 評価走行中 (in-flight) は多重起動しない
 * - symbol 未設定のバーはスキップする
 * - パイプライン結果が RealtimeEvaluationResult に変換され、onEvaluation が発火する
 *
 * rollingWindow と runPipelineFn は DI で差し替え、実 DB / 実 cTrader なしで実行する。
 */

import {
  RealtimeSimilarityService,
  type RunMatchingPipelineFn,
} from '../realtime/realtimeSimilarityService';
import type {
  RollingWindowService,
  BarCompleteCallback,
} from '../realtime/rollingWindowService';
import type { OHLCVBar } from '../../infrastructure/market/IMarketDataProvider';
import type { MatchingPipelineRunResult } from '../matchingService';

/** onBarComplete で登録されたコールバックを捕捉し、テストから手動でバーを流せる fake */
function makeFakeRollingWindow(): {
  rollingWindow: RollingWindowService;
  emitBar: (bar: OHLCVBar) => void;
} {
  let callback: BarCompleteCallback | null = null;
  const rollingWindow = {
    onBarComplete: (cb: BarCompleteCallback) => {
      callback = cb;
    },
    offBarComplete: () => {
      callback = null;
    },
  } as unknown as RollingWindowService;
  return {
    rollingWindow,
    emitBar: (bar) => callback?.(bar),
  };
}

/** 最小の OHLCVBar (symbol だけ意味を持つ。symbol は optional) */
function makeBar(symbol: string | undefined): OHLCVBar {
  return {
    symbol,
    timestamp: new Date(),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  };
}

/** runMatchingPipeline の戻り値 (テスト用) */
function makeRunResult(overrides: Partial<MatchingPipelineRunResult> = {}): MatchingPipelineRunResult {
  return {
    runId: 'run-1',
    totalMatches: 2,
    notified: 1,
    skipped: 0,
    errors: [],
    skipReasons: {},
    status: 'success',
    ...overrides,
  };
}

/** 非同期処理 (then/finally) を 1 マイクロタスク分待つ */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('RealtimeSimilarityService (Phase δ-1 レンズ統一)', () => {
  test('バー確定でレンズ評価が trigger=realtime + symbolFilter で起動する', async () => {
    const { rollingWindow, emitBar } = makeFakeRollingWindow();
    const runPipelineFn: jest.MockedFunction<RunMatchingPipelineFn> = jest
      .fn()
      .mockResolvedValue(makeRunResult());
    const service = new RealtimeSimilarityService(rollingWindow, {}, { runPipelineFn });

    service.start();
    emitBar(makeBar('XAUUSD'));
    await flush();

    expect(runPipelineFn).toHaveBeenCalledTimes(1);
    expect(runPipelineFn).toHaveBeenCalledWith({ trigger: 'realtime', symbolFilter: 'XAUUSD' });
  });

  test('symbol 未設定のバーはスキップする', async () => {
    const { rollingWindow, emitBar } = makeFakeRollingWindow();
    const runPipelineFn = jest.fn().mockResolvedValue(makeRunResult());
    const service = new RealtimeSimilarityService(rollingWindow, {}, { runPipelineFn });

    service.start();
    emitBar(makeBar(undefined));
    await flush();

    expect(runPipelineFn).not.toHaveBeenCalled();
  });

  test('同一シンボルのクールダウン中は再評価しない', async () => {
    const { rollingWindow, emitBar } = makeFakeRollingWindow();
    const runPipelineFn = jest.fn().mockResolvedValue(makeRunResult());
    const service = new RealtimeSimilarityService(
      rollingWindow,
      { minEvaluationIntervalSeconds: 60 },
      { runPipelineFn }
    );

    service.start();
    emitBar(makeBar('XAUUSD'));
    await flush();
    // 1 件目の評価完了後、すぐ 2 件目を流してもクールダウンでスキップ
    emitBar(makeBar('XAUUSD'));
    await flush();

    expect(runPipelineFn).toHaveBeenCalledTimes(1);
  });

  test('別シンボルはクールダウンの影響を受けず独立に評価される', async () => {
    const { rollingWindow, emitBar } = makeFakeRollingWindow();
    const runPipelineFn = jest.fn().mockResolvedValue(makeRunResult());
    const service = new RealtimeSimilarityService(
      rollingWindow,
      { minEvaluationIntervalSeconds: 60 },
      { runPipelineFn }
    );

    service.start();
    emitBar(makeBar('XAUUSD'));
    await flush();
    emitBar(makeBar('EURUSD'));
    await flush();

    expect(runPipelineFn).toHaveBeenCalledTimes(2);
    expect(runPipelineFn).toHaveBeenNthCalledWith(1, { trigger: 'realtime', symbolFilter: 'XAUUSD' });
    expect(runPipelineFn).toHaveBeenNthCalledWith(2, { trigger: 'realtime', symbolFilter: 'EURUSD' });
  });

  test('評価走行中の同一シンボルは多重起動しない', async () => {
    const { rollingWindow, emitBar } = makeFakeRollingWindow();
    // パイプラインを未解決のまま保留し「走行中」を作る
    let resolvePipeline: (r: MatchingPipelineRunResult) => void = () => {};
    const runPipelineFn = jest.fn().mockReturnValue(
      new Promise<MatchingPipelineRunResult>((resolve) => {
        resolvePipeline = resolve;
      })
    );
    const service = new RealtimeSimilarityService(
      rollingWindow,
      { minEvaluationIntervalSeconds: 0 },
      { runPipelineFn }
    );

    service.start();
    emitBar(makeBar('XAUUSD')); // 1 件目: 走行開始 (未解決)
    await flush();
    emitBar(makeBar('XAUUSD')); // 2 件目: 走行中なのでスキップ
    await flush();
    expect(runPipelineFn).toHaveBeenCalledTimes(1);

    // 1 件目を解決すると in-flight が解除され、次のバーで再評価できる
    resolvePipeline(makeRunResult());
    await flush();
    emitBar(makeBar('XAUUSD'));
    await flush();
    expect(runPipelineFn).toHaveBeenCalledTimes(2);
  });

  test('evaluateWithPersistence がパイプライン結果を変換し onEvaluation が発火する', async () => {
    const { rollingWindow } = makeFakeRollingWindow();
    const runPipelineFn = jest
      .fn()
      .mockResolvedValue(makeRunResult({ totalMatches: 5, notified: 2, errors: ['e1'] }));
    const service = new RealtimeSimilarityService(rollingWindow, {}, { runPipelineFn });

    const seen: Array<{ symbol: string; totalMatches: number; notified: number }> = [];
    service.onEvaluation((r) => seen.push({ symbol: r.symbol, totalMatches: r.totalMatches, notified: r.notified }));

    const result = await service.evaluateWithPersistence('USDJPY');

    expect(result.symbol).toBe('USDJPY');
    expect(result.totalMatches).toBe(5);
    expect(result.notified).toBe(2);
    expect(result.errors).toEqual(['e1']);
    expect(seen).toEqual([{ symbol: 'USDJPY', totalMatches: 5, notified: 2 }]);
  });

  test('stop 後はバー確定で評価が起動しない', async () => {
    const { rollingWindow, emitBar } = makeFakeRollingWindow();
    const runPipelineFn = jest.fn().mockResolvedValue(makeRunResult());
    const service = new RealtimeSimilarityService(rollingWindow, {}, { runPipelineFn });

    service.start();
    service.stop();
    emitBar(makeBar('XAUUSD'));
    await flush();

    expect(runPipelineFn).not.toHaveBeenCalled();
  });
});
