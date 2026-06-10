/**
 * ストラテジー ライブ条件評価サービス(Phase γ-1)のユニットテスト
 *
 * 検証観点:
 * - バックテストと同じ評価器・同じキャッシュ変換で「最終バー時点の条件成立」を判定する
 * - 成立時のみ triggerAlert に渡る(クールダウン等は triggerAlert の責務)
 * - 鮮度切れ・データ不足・整合ズレ・レガシー(timeframe なし)を理由付きでスキップする
 * - 1 ストラテジーの失敗が他のストラテジー評価を止めない
 *
 * 外部依存(DB / analysis-engine / cTrader)は全て DI モックで遮断する。
 */

import {
  LiveStrategyEvaluationService,
  isStatefulConditionGroup,
  type LiveStrategyEvaluationDeps,
} from '../services/strategyLiveEvaluationService';
import type { ConditionGroup, OHLCV } from '../services/strategyConditionEvaluator';
import type { StrategyDetail } from '../services/strategyService';
import type { AlertWithStrategy } from '../services/strategyAlertService';
import { makeIndicatorCacheKey } from '../services/analysisEngineClient';

const NOW = Date.now();
const BAR_MS = 15 * 60_000;
const BARS = 170;

/** 直近 NOW で終わる 15m バー列 */
function makeBars(count = BARS, endTime = NOW): OHLCV[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(endTime - (count - 1 - i) * BAR_MS),
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    volume: 1000,
  }));
}

/** RSI < 30 の単純条件グループ */
function makeRsiCondition(): ConditionGroup {
  return {
    groupId: 'g1',
    operator: 'AND',
    conditions: [
      {
        conditionId: 'c1',
        indicatorId: 'rsi',
        params: { period: 14 },
        field: 'value',
        operator: '<',
        compareTarget: { type: 'fixed', value: 30 },
      },
    ],
  };
}

function makeAlert(strategyId = 'strat-1'): AlertWithStrategy {
  return {
    id: `alert-${strategyId}`,
    strategyId,
    enabled: true,
    status: 'enabled',
    cooldownMinutes: 60,
    channels: ['in_app'],
    minMatchScore: 0.7,
    lastTriggeredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    strategy: { id: strategyId, name: 'テスト戦略', symbol: 'USDJPY' },
  };
}

function makeStrategy(overrides: Partial<StrategyDetail> = {}): StrategyDetail {
  return {
    id: 'strat-1',
    name: 'テスト戦略',
    symbol: 'USDJPY',
    timeframe: '15m',
    side: 'buy',
    status: 'active',
    currentVersionId: 'v1',
    currentVersion: {
      id: 'v1',
      versionNumber: 1,
      entryConditions: makeRsiCondition(),
      shortEntryConditions: null,
      exitSettings: {},
      entryTiming: 'next_open',
      changeNote: null,
      createdAt: new Date(),
    },
    versions: [],
    ...overrides,
  } as unknown as StrategyDetail;
}

/** rsi 系列(全バー同値)を含む analysis-engine レスポンス */
function makeSeries(rsiValue: number, length = BARS) {
  const key = makeIndicatorCacheKey('rsi', { period: 14 }, 'value');
  return {
    series: { [key]: Array.from({ length }, () => rsiValue) },
    patterns: {},
  };
}

function makeService(overrides: {
  alerts?: AlertWithStrategy[];
  strategy?: StrategyDetail | null;
  bars?: OHLCV[];
  rsiValue?: number;
  seriesLength?: number;
  triggerResult?: { triggered: boolean; skipReason?: string };
}) {
  const listEnabledAlertsFn = jest.fn().mockResolvedValue(overrides.alerts ?? [makeAlert()]);
  const getStrategyFn = jest
    .fn()
    .mockResolvedValue(overrides.strategy === undefined ? makeStrategy() : overrides.strategy);
  const bars = overrides.bars ?? makeBars();
  const fetchHistoricalDataFn = jest.fn().mockResolvedValue(bars);
  const fetchAndCacheOhlcvFn = jest.fn().mockResolvedValue({ success: true, cachedCount: 0 });
  const fetchIndicatorSeriesFn = jest
    .fn()
    .mockResolvedValue(makeSeries(overrides.rsiValue ?? 25, overrides.seriesLength ?? bars.length));
  const triggerAlertFn = jest
    .fn()
    .mockResolvedValue(overrides.triggerResult ?? { triggered: true, sentChannels: ['in_app'], logIds: ['log1'] });

  const deps = {
    listEnabledAlertsFn,
    getStrategyFn,
    fetchHistoricalDataFn,
    fetchAndCacheOhlcvFn,
    fetchIndicatorSeriesFn,
    triggerAlertFn,
  } as LiveStrategyEvaluationDeps;
  return {
    service: new LiveStrategyEvaluationService(deps),
    listEnabledAlertsFn,
    getStrategyFn,
    fetchHistoricalDataFn,
    fetchAndCacheOhlcvFn,
    fetchIndicatorSeriesFn,
    triggerAlertFn,
  };
}

describe('LiveStrategyEvaluationService', () => {
  test('最終バーで条件成立 → triggerAlert が matchScore=1.0 で呼ばれる', async () => {
    const { service, triggerAlertFn } = makeService({ rsiValue: 25 });

    const result = await service.evaluateActiveStrategyAlerts();

    expect(result.alertsEvaluated).toBe(1);
    expect(result.conditionMet).toBe(1);
    expect(result.triggered).toBe(1);
    expect(triggerAlertFn).toHaveBeenCalledTimes(1);
    expect(triggerAlertFn).toHaveBeenCalledWith(
      expect.objectContaining({ strategyId: 'strat-1', matchScore: 1.0 })
    );
    expect(result.strategies[0].evaluations).toEqual([{ side: 'buy', conditionMet: true }]);
  });

  test('条件不成立なら triggerAlert は呼ばれない', async () => {
    const { service, triggerAlertFn } = makeService({ rsiValue: 55 });

    const result = await service.evaluateActiveStrategyAlerts();

    expect(result.conditionMet).toBe(0);
    expect(result.triggered).toBe(0);
    expect(triggerAlertFn).not.toHaveBeenCalled();
  });

  test('triggerAlert のクールダウンスキップは alert_cooldown として集計される', async () => {
    const { service } = makeService({
      rsiValue: 25,
      triggerResult: { triggered: false, skipReason: 'クールダウン中: あと12分' },
    });

    const result = await service.evaluateActiveStrategyAlerts();

    expect(result.conditionMet).toBe(1);
    expect(result.triggered).toBe(0);
    expect(result.skipped['alert_cooldown']).toBe(1);
  });

  test('side=both は買い/売り条件を別々に評価する', async () => {
    // 買い条件: RSI<30(成立)、売り条件: RSI>70(不成立)
    const sellCondition: ConditionGroup = {
      groupId: 'g2',
      operator: 'AND',
      conditions: [
        {
          conditionId: 'c2',
          indicatorId: 'rsi',
          params: { period: 14 },
          field: 'value',
          operator: '>',
          compareTarget: { type: 'fixed', value: 70 },
        },
      ],
    };
    const { service, triggerAlertFn } = makeService({
      strategy: makeStrategy({
        side: 'both',
        currentVersion: {
          id: 'v1',
          versionNumber: 1,
          entryConditions: makeRsiCondition(),
          shortEntryConditions: sellCondition,
          exitSettings: {},
          entryTiming: 'next_open',
          changeNote: null,
          createdAt: new Date(),
        },
      }),
      rsiValue: 25,
    });

    const result = await service.evaluateActiveStrategyAlerts();

    expect(result.strategies[0].evaluations).toEqual([
      { side: 'buy', conditionMet: true },
      { side: 'sell', conditionMet: false },
    ]);
    expect(triggerAlertFn).toHaveBeenCalledTimes(1);
  });

  test('鮮度切れ(最終バーが古い)は stale_market_data でスキップし誤発火しない', async () => {
    // 最終バーが 3 時間前 + 補完フェッチでも更新されない状況
    const staleBars = makeBars(BARS, NOW - 3 * 60 * 60 * 1000);
    const { service, triggerAlertFn, fetchAndCacheOhlcvFn } = makeService({
      bars: staleBars,
      rsiValue: 25,
    });

    const result = await service.evaluateActiveStrategyAlerts();

    // 鮮度回復を 1 回試みた上で、それでも古ければ評価しない
    expect(fetchAndCacheOhlcvFn).toHaveBeenCalled();
    expect(result.skipped['stale_market_data']).toBe(1);
    expect(triggerAlertFn).not.toHaveBeenCalled();
  });

  test('バー列と指標系列の長さ不一致は series_alignment_mismatch でスキップする', async () => {
    const { service, triggerAlertFn } = makeService({ rsiValue: 25, seriesLength: BARS - 5 });

    const result = await service.evaluateActiveStrategyAlerts();

    expect(result.skipped['series_alignment_mismatch']).toBe(1);
    expect(triggerAlertFn).not.toHaveBeenCalled();
  });

  test('timeframe 未設定のレガシーストラテジーは no_timeframe でスキップする', async () => {
    const { service } = makeService({
      strategy: makeStrategy({ timeframe: null }),
    });

    const result = await service.evaluateActiveStrategyAlerts();

    expect(result.skipped['no_timeframe']).toBe(1);
  });

  test('active でないストラテジーは strategy_not_active でスキップする', async () => {
    const { service } = makeService({
      strategy: makeStrategy({ status: 'draft' }),
    });

    const result = await service.evaluateActiveStrategyAlerts();

    expect(result.skipped['strategy_not_active']).toBe(1);
  });

  test('1 ストラテジーの失敗は errors に積み、他の評価を継続する', async () => {
    const alerts = [makeAlert('strat-err'), makeAlert('strat-ok')];
    const getStrategyFn = jest
      .fn()
      .mockImplementation(async (id: string) => {
        if (id === 'strat-err') {
          throw new Error('DB error');
        }
        return makeStrategy({ id: 'strat-ok' });
      });
    const bars = makeBars();
    const deps = {
      listEnabledAlertsFn: jest.fn().mockResolvedValue(alerts),
      getStrategyFn,
      fetchHistoricalDataFn: jest.fn().mockResolvedValue(bars),
      fetchAndCacheOhlcvFn: jest.fn().mockResolvedValue({ success: true, cachedCount: 0 }),
      fetchIndicatorSeriesFn: jest.fn().mockResolvedValue(makeSeries(25, bars.length)),
      triggerAlertFn: jest.fn().mockResolvedValue({ triggered: true, sentChannels: ['in_app'], logIds: [] }),
    } as LiveStrategyEvaluationDeps;
    const service = new LiveStrategyEvaluationService(deps);

    const result = await service.evaluateActiveStrategyAlerts();

    expect(result.errors).toHaveLength(1);
    expect(result.alertsEvaluated).toBe(1);
    expect(result.triggered).toBe(1);
  });

  test('同一 symbol×timeframe のバー取得は run 内で 1 回に共有される', async () => {
    const alerts = [makeAlert('strat-1'), makeAlert('strat-2')];
    const bars = makeBars();
    const fetchHistoricalDataFn = jest.fn().mockResolvedValue(bars);
    const deps = {
      listEnabledAlertsFn: jest.fn().mockResolvedValue(alerts),
      getStrategyFn: jest
        .fn()
        .mockImplementation(async (id: string) => makeStrategy({ id })),
      fetchHistoricalDataFn,
      fetchAndCacheOhlcvFn: jest.fn().mockResolvedValue({ success: true, cachedCount: 0 }),
      fetchIndicatorSeriesFn: jest.fn().mockResolvedValue(makeSeries(55, bars.length)),
      triggerAlertFn: jest.fn(),
    } as LiveStrategyEvaluationDeps;
    const service = new LiveStrategyEvaluationService(deps);

    await service.evaluateActiveStrategyAlerts();

    // 新鮮なバーなら補完なしで 1 回のみ
    expect(fetchHistoricalDataFn).toHaveBeenCalledTimes(1);
  });
});

describe('isStatefulConditionGroup', () => {
  test('IF_THEN / SEQUENCE(ネスト含む)を状態ありと判定する', () => {
    expect(
      isStatefulConditionGroup({ groupId: 'g', operator: 'IF_THEN', conditions: [] })
    ).toBe(true);
    expect(
      isStatefulConditionGroup({ groupId: 'g', operator: 'SEQUENCE', conditions: [] })
    ).toBe(true);
    expect(
      isStatefulConditionGroup({
        groupId: 'g',
        operator: 'AND',
        conditions: [{ groupId: 'inner', operator: 'SEQUENCE', conditions: [] }],
      })
    ).toBe(true);
  });

  test('AND/OR/NOT のみは状態なし(最終バーのみ評価で足りる)', () => {
    expect(isStatefulConditionGroup(makeRsiCondition())).toBe(false);
    expect(
      isStatefulConditionGroup({
        groupId: 'g',
        operator: 'NOT',
        conditions: [makeRsiCondition()],
      })
    ).toBe(false);
  });
});
