/**
 * ストラテジー条件評価サービスのテスト
 * 
 * 目的:
 * - 共通条件評価ロジックの動作確認
 * - バックテストとリアルタイム評価の両方で使用される重要なロジックをテスト
 */

import type {
  EvaluationContext,
  IndicatorCondition,
  PatternCondition,
  TimeCondition,
  CandlePatternId,
  ConditionGroup,
  OHLCV} from '../services/strategyConditionEvaluator';
import {
  evaluateCondition,
  evaluateConditionGroup,
  evaluateLensCondition,
  evaluateTimeConditionAt,
  getIndicatorValue,
  getPriceValue,
  buildTimeframeIndexMap,
  collectLensConditions,
  collectTimeframeOverrides,
  makeLensCacheKey,
  type LensCondition,
  type TimeframeView,
} from '../services/strategyConditionEvaluator';
import { makeIndicatorCacheKey } from '../services/analysisEngineClient';

// モックストラテジー
const mockStrategy = {
  id: 'test-strategy',
  name: 'テストストラテジー',
  description: 'テスト用のストラテジー',
  symbol: 'USDJPY',
  timeframe: '1h' as const,
  side: 'buy' as const,
  status: 'draft' as const,
  currentVersionId: 'v1',
  tags: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  currentVersion: null,
  versions: [],
};

describe('StrategyConditionEvaluator', () => {
  describe('getPriceValue', () => {
    test('指定した価格タイプの値を正しく取得できる', () => {
      const mockData: OHLCV[] = [
        {
          timestamp: new Date('2024-01-01T00:00:00Z'),
          open: 150.0,
          high: 151.0,
          low: 149.0,
          close: 150.5,
          volume: 1000,
        },
      ];

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 0,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      expect(getPriceValue(ctx, 'open')).toBe(150.0);
      expect(getPriceValue(ctx, 'high')).toBe(151.0);
      expect(getPriceValue(ctx, 'low')).toBe(149.0);
      expect(getPriceValue(ctx, 'close')).toBe(150.5);
    });
  });

  describe('getIndicatorValue', () => {
    test('キャッシュに存在しない場合は undefined を返す（Node 側で計算しない）', async () => {
      const mockData: OHLCV[] = [
        {
          timestamp: new Date('2024-01-01T00:00:00Z'),
          open: 150.0,
          high: 151.0,
          low: 149.0,
          close: 150.5,
          volume: 1000,
        },
      ];

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 0,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      const value = await getIndicatorValue(ctx, 'rsi', { period: 14 }, 'value');
      expect(value).toBeUndefined();
      expect(ctx.indicatorCache.size).toBe(0);
    });

    test('キャッシュに存在する場合はその値を返す', async () => {
      const mockData: OHLCV[] = Array.from({ length: 3 }).map((_, i) => ({
        timestamp: new Date(`2024-01-01T0${i}:00:00Z`),
        open: 150.0,
        high: 151.0,
        low: 149.0,
        close: 150.0,
        volume: 1000,
      }));

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 1,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      const key = makeIndicatorCacheKey('rsi', { period: 14 }, 'value');
      ctx.indicatorCache.set(key, [10, 20, 30]);

      const value = await getIndicatorValue(ctx, 'rsi', { period: 14 }, 'value');
      expect(value).toBe(20);
    });

    test('キャッシュ値が NaN の場合は undefined に寄せる', async () => {
      const mockData: OHLCV[] = Array.from({ length: 2 }).map((_, i) => ({
        timestamp: new Date(`2024-01-01T0${i}:00:00Z`),
        open: 150.0,
        high: 151.0,
        low: 149.0,
        close: 150.0,
        volume: 1000,
      }));

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 1,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      const key = makeIndicatorCacheKey('sma', { period: 20 }, 'value');
      ctx.indicatorCache.set(key, [Number.NaN, Number.NaN]);

      const value = await getIndicatorValue(ctx, 'sma', { period: 20 }, 'value');
      expect(value).toBeUndefined();
    });
  });

  describe('evaluateCondition', () => {
    test('固定値との比較: RSI < 30', async () => {
      const mockData: OHLCV[] = [];
      for (let i = 0; i < 100; i++) {
        mockData.push({
          timestamp: new Date(`2024-01-01T${String(i).padStart(2, '0')}:00:00Z`),
          open: 150,
          high: 151,
          low: 149,
          close: 150,
          volume: 1000,
        });
      }

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 50,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      // analysis-engine から取得済みの想定で、RSI をキャッシュに投入
      const key = makeIndicatorCacheKey('rsi', { period: 14 }, 'value');
      ctx.indicatorCache.set(key, Array.from({ length: 100 }).map(() => 20));

      const condition: IndicatorCondition = {
        conditionId: 'c1',
        indicatorId: 'rsi',
        params: { period: 14 },
        field: 'value',
        operator: '<',
        compareTarget: {
          type: 'fixed',
          value: 30,
        },
      };

      const result = await evaluateCondition(ctx, condition);

      expect(result).toBe(true);
    });

    test('価格との比較: SMA > close', async () => {
      const mockData: OHLCV[] = [];
      let price = 150.0;
      for (let i = 0; i < 50; i++) {
        if (i < 40) {
          price += 0.2; // 上昇トレンド
        } else {
          price -= 1.0; // 急落
        }
        mockData.push({
          timestamp: new Date(`2024-01-01T${String(i).padStart(2, '0')}:00:00Z`),
          open: price,
          high: price + 0.1,
          low: price - 0.1,
          close: price,
          volume: 1000,
        });
      }

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 45,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      // SMA をキャッシュに投入（急落後でも SMA が高い想定）
      const key = makeIndicatorCacheKey('sma', { period: 20 }, 'value');
      ctx.indicatorCache.set(key, Array.from({ length: 50 }).map(() => 155));

      const condition: IndicatorCondition = {
        conditionId: 'c2',
        indicatorId: 'sma',
        params: { period: 20 },
        field: 'value',
        operator: '>',
        compareTarget: {
          type: 'price',
          priceType: 'close',
        },
      };

      const result = await evaluateCondition(ctx, condition);

      expect(result).toBe(true);
    });

    test('終値タッチ: SMA が close に一致（touch_close）', async () => {
      const mockData: OHLCV[] = [
        {
          timestamp: new Date('2024-01-01T00:00:00Z'),
          open: 150.0,
          high: 151.0,
          low: 149.0,
          close: 150.0,
          volume: 1000,
        },
      ];

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 0,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      const key = makeIndicatorCacheKey('sma', { period: 20 }, 'value');
      ctx.indicatorCache.set(key, [150.0]);

      const condition: IndicatorCondition = {
        conditionId: 'touch-close-1',
        indicatorId: 'sma',
        params: { period: 20 },
        field: 'value',
        operator: 'touch_close',
        compareTarget: { type: 'price', priceType: 'close' },
      };

      const result = await evaluateCondition(ctx, condition);
      expect(result).toBe(true);
    });

    test('ヒゲタッチ: レートレンジが SMA を含む（touch_wick）', async () => {
      const mockData: OHLCV[] = [
        {
          timestamp: new Date('2024-01-01T00:00:00Z'),
          open: 150.5,
          high: 151.0,
          low: 149.0,
          close: 150.2,
          volume: 1000,
        },
      ];

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 0,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      const key = makeIndicatorCacheKey('sma', { period: 20 }, 'value');
      ctx.indicatorCache.set(key, [150.0]);

      const condition: IndicatorCondition = {
        conditionId: 'touch-wick-1',
        indicatorId: 'sma',
        params: { period: 20 },
        field: 'value',
        operator: 'touch_wick',
        compareTarget: { type: 'price', priceType: 'close' },
      };

      const result = await evaluateCondition(ctx, condition);
      expect(result).toBe(true);
    });
  });

  describe('evaluateConditionGroup', () => {
    test('AND 演算子: すべての条件が真の場合', async () => {
      const mockData: OHLCV[] = [];
      for (let i = 0; i < 50; i++) {
        const price = 150.0;
        mockData.push({
          timestamp: new Date(`2024-01-01T${String(i).padStart(2, '0')}:00:00Z`),
          open: price - 0.5,
          high: price + 0.5,
          low: price - 0.5,
          close: price,
          volume: 1000,
        });
      }

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 30,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      // RSI が 50 付近にある想定
      const key = makeIndicatorCacheKey('rsi', { period: 14 }, 'value');
      ctx.indicatorCache.set(key, Array.from({ length: 50 }).map(() => 50));

      const group: ConditionGroup = {
        groupId: 'g1',
        operator: 'AND',
        conditions: [
          {
            conditionId: 'c1',
            indicatorId: 'rsi',
            params: { period: 14 },
            field: 'value',
            operator: '>',
            compareTarget: { type: 'fixed', value: 30 },
          },
          {
            conditionId: 'c2',
            indicatorId: 'rsi',
            params: { period: 14 },
            field: 'value',
            operator: '<',
            compareTarget: { type: 'fixed', value: 70 },
          },
        ],
      };

      const result = await evaluateConditionGroup(ctx, group);

      expect(result).toBe(true);
    });

    test('OR 演算子: いずれかの条件が真の場合', async () => {
      const mockData: OHLCV[] = [];
      for (let i = 0; i < 50; i++) {
        mockData.push({
          timestamp: new Date(`2024-01-01T${String(i).padStart(2, '0')}:00:00Z`),
          open: 150.0,
          high: 151.0,
          low: 149.0,
          close: 150.0,
          volume: 1000,
        });
      }

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 30,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      // RSI は 50（<30 は偽）
      const rsiKey = makeIndicatorCacheKey('rsi', { period: 14 }, 'value');
      ctx.indicatorCache.set(rsiKey, Array.from({ length: 50 }).map(() => 50));

      // SMA は 150（=150 は真）
      const smaKey = makeIndicatorCacheKey('sma', { period: 20 }, 'value');
      ctx.indicatorCache.set(smaKey, Array.from({ length: 50 }).map(() => 150));

      const group: ConditionGroup = {
        groupId: 'g2',
        operator: 'OR',
        conditions: [
          {
            conditionId: 'c1',
            indicatorId: 'rsi',
            params: { period: 14 },
            field: 'value',
            operator: '<',
            compareTarget: { type: 'fixed', value: 30 },
          },
          {
            conditionId: 'c2',
            indicatorId: 'sma',
            params: { period: 20 },
            field: 'value',
            operator: '=',
            compareTarget: { type: 'fixed', value: 150.0 },
          },
        ],
      };

      const result = await evaluateConditionGroup(ctx, group);

      expect(result).toBe(true);
    });

    test('NOT 演算子: 条件が偽の場合', async () => {
      const mockData: OHLCV[] = [];
      for (let i = 0; i < 50; i++) {
        mockData.push({
          timestamp: new Date(`2024-01-01T${String(i).padStart(2, '0')}:00:00Z`),
          open: 150.0,
          high: 151.0,
          low: 149.0,
          close: 150.0,
          volume: 1000,
        });
      }

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 30,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      // RSI は 50（<30 は偽）→ NOT で真
      const key = makeIndicatorCacheKey('rsi', { period: 14 }, 'value');
      ctx.indicatorCache.set(key, Array.from({ length: 50 }).map(() => 50));

      const group: ConditionGroup = {
        groupId: 'g3',
        operator: 'NOT',
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

      const result = await evaluateConditionGroup(ctx, group);

      expect(result).toBe(true);
    });

    test('SEQUENCE: ステップ順に成立（状態ベース、間隔制限あり）', async () => {
      const mockData: OHLCV[] = Array.from({ length: 20 }).map((_, i) => ({
        timestamp: new Date(`2024-01-01T${String(i).padStart(2, '0')}:00:00Z`),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
      }));

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 0,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      const keyA = makeIndicatorCacheKey('sma', { period: 20 }, 'value');
      // step1 は index>=10 で true（left=1、right=0）
      ctx.indicatorCache.set(keyA, mockData.map((_, i) => (i >= 10 ? 1 : -1)));

      const step1: IndicatorCondition = {
        conditionId: 'seq-step-1',
        indicatorId: 'sma',
        params: { period: 20 },
        field: 'value',
        operator: '>',
        compareTarget: { type: 'fixed', value: 0 },
      };

      const keyB = makeIndicatorCacheKey('ema', { period: 20 }, 'value');
      // step2 は index==11 だけ true
      ctx.indicatorCache.set(keyB, mockData.map((_, i) => (i === 11 ? 1 : -1)));

      const step2: IndicatorCondition = {
        conditionId: 'seq-step-2',
        indicatorId: 'ema',
        params: { period: 20 },
        field: 'value',
        operator: '>',
        compareTarget: { type: 'fixed', value: 0 },
      };

      const group: ConditionGroup = {
        groupId: 'seq-1',
        operator: 'SEQUENCE',
        conditions: [step1, step2],
        maxBarsBetweenSteps: 2,
      };

      // index=9: step1 false
      ctx.currentIndex = 9;
      expect(await evaluateConditionGroup(ctx, group)).toBe(false);

      // index=10: step1 true（step進行）
      ctx.currentIndex = 10;
      expect(await evaluateConditionGroup(ctx, group)).toBe(false);

      // index=11: step2 true（完了）
      ctx.currentIndex = 11;
      expect(await evaluateConditionGroup(ctx, group)).toBe(true);
    });

    test('パターン条件: hammer が出現した（is_true）', async () => {
      const mockData: OHLCV[] = Array.from({ length: 3 }).map((_, i) => ({
        timestamp: new Date(`2024-01-01T0${i}:00:00Z`),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
      }));

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 1,
        indicatorCache: new Map(),
        patternCache: new Map([['hammer', [false, true, false]]]),
        strategy: mockStrategy,
      };

      const pattern: PatternCondition = {
        conditionId: 'p1',
        type: 'pattern',
        patternId: 'hammer',
        operator: 'is_true',
      };

      const group: ConditionGroup = {
        groupId: 'g-pattern',
        operator: 'AND',
        conditions: [pattern],
      };

      expect(await evaluateConditionGroup(ctx, group)).toBe(true);
    });

    test('パターン条件: pinbar_bear（上ヒゲピンバー）が出現した（is_true）', async () => {
      const mockData: OHLCV[] = Array.from({ length: 3 }).map((_, i) => ({
        timestamp: new Date(`2024-01-01T0${i}:00:00Z`),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
      }));

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 1,
        indicatorCache: new Map(),
        patternCache: new Map([['pinbar_bear', [false, true, false]]]),
        strategy: mockStrategy,
      };

      const pattern: PatternCondition = {
        conditionId: 'p2',
        type: 'pattern',
        patternId: 'pinbar_bear',
        operator: 'is_true',
      };

      const group: ConditionGroup = {
        groupId: 'g-pattern-2',
        operator: 'AND',
        conditions: [pattern],
      };

      expect(await evaluateConditionGroup(ctx, group)).toBe(true);
    });

    test('パターン条件: hammer_bull（陽線ハンマー）が出現した（is_true）', async () => {
      const mockData: OHLCV[] = Array.from({ length: 3 }).map((_, i) => ({
        timestamp: new Date(`2024-01-01T0${i}:00:00Z`),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
      }));

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 1,
        indicatorCache: new Map(),
        patternCache: new Map([['hammer_bull', [false, true, false]]]),
        strategy: mockStrategy,
      };

      const pattern: PatternCondition = {
        conditionId: 'p3',
        type: 'pattern',
        patternId: 'hammer_bull',
        operator: 'is_true',
      };

      const group: ConditionGroup = {
        groupId: 'g-pattern-3',
        operator: 'AND',
        conditions: [pattern],
      };

      expect(await evaluateConditionGroup(ctx, group)).toBe(true);
    });
  });
});

describe('時間条件（JST基準、フロント types/strategy とミラー）', () => {
  // UTC で epoch を組み立てる。evaluateTimeConditionAt は内部で +9h して JST にする。
  const utc = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo, d, h, mi);

  test('時間帯・日跨ぎ・曜日・セッション・negate を正しく判定する', () => {
    // 時間帯 09:00–15:00 JST
    const range: TimeCondition = { conditionId: 't', type: 'time', kind: 'time_range', startMinutes: 9 * 60, endMinutes: 15 * 60 };
    expect(evaluateTimeConditionAt(range, utc(2026, 0, 1, 0))).toBe(true); // JST 09:00
    expect(evaluateTimeConditionAt(range, utc(2026, 0, 1, 10))).toBe(false); // JST 19:00

    // 日跨ぎ 22:00–翌05:00 JST
    const overnight: TimeCondition = { conditionId: 't', type: 'time', kind: 'time_range', startMinutes: 22 * 60, endMinutes: 5 * 60 };
    expect(evaluateTimeConditionAt(overnight, utc(2026, 0, 1, 14))).toBe(true); // JST 23:00
    expect(evaluateTimeConditionAt(overnight, utc(2026, 0, 1, 3))).toBe(false); // JST 12:00

    // negate（以外で成立）
    const negated: TimeCondition = { ...range, negate: true };
    expect(evaluateTimeConditionAt(negated, utc(2026, 0, 1, 0))).toBe(false);

    // 曜日（月〜金）: 2026-01-01 は木曜
    const weekdays: TimeCondition = { conditionId: 't', type: 'time', kind: 'day_of_week', days: [1, 2, 3, 4, 5] };
    expect(evaluateTimeConditionAt(weekdays, utc(2026, 0, 1, 1))).toBe(true);
    expect(evaluateTimeConditionAt(weekdays, utc(2026, 0, 3, 1))).toBe(false); // 土曜

    // セッション（NY 21:00–翌06:00 JST、日跨ぎ）
    const ny: TimeCondition = { conditionId: 't', type: 'time', kind: 'session', session: 'newyork' };
    expect(evaluateTimeConditionAt(ny, utc(2026, 0, 1, 14))).toBe(true); // JST 23:00
    expect(evaluateTimeConditionAt(ny, utc(2026, 0, 1, 3))).toBe(false); // JST 12:00
  });

  test('evaluateConditionGroup が AND グループ内の時間条件をバー timestamp で評価する', async () => {
    const data: OHLCV[] = [
      { timestamp: new Date(utc(2026, 0, 1, 0)), open: 1, high: 1, low: 1, close: 1, volume: 0 }, // JST 09:00
    ];
    const ctx: EvaluationContext = {
      data,
      currentIndex: 0,
      indicatorCache: new Map(),
      strategy: mockStrategy,
    };
    const inSession: TimeCondition = { conditionId: 't', type: 'time', kind: 'time_range', startMinutes: 9 * 60, endMinutes: 15 * 60 };
    const group: ConditionGroup = { groupId: 'g', operator: 'AND', conditions: [inSession] };
    expect(await evaluateConditionGroup(ctx, group)).toBe(true);

    // 時間外（JST 19:00）のバーでは false
    ctx.data[0].timestamp = new Date(utc(2026, 0, 1, 10));
    expect(await evaluateConditionGroup(ctx, group)).toBe(false);
  });
});

describe('範囲条件（between / not_between）', () => {
  const makeCtx = (rsi: number): EvaluationContext => {
    const ctx: EvaluationContext = {
      data: [{ timestamp: new Date(), open: 1, high: 1, low: 1, close: 1, volume: 0 }],
      currentIndex: 0,
      indicatorCache: new Map(),
      strategy: mockStrategy,
    };
    ctx.indicatorCache.set(makeIndicatorCacheKey('rsi', { period: 14 }, 'value'), [rsi]);
    return ctx;
  };
  const between: IndicatorCondition = {
    conditionId: 'c', indicatorId: 'rsi', params: { period: 14 }, field: 'value',
    operator: 'between',
    compareTarget: { type: 'fixed', value: 30 },
    compareTargetUpper: { type: 'fixed', value: 70 },
  };

  test('範囲内: between=true / not_between=false', async () => {
    expect(await evaluateCondition(makeCtx(50), between)).toBe(true);
    expect(await evaluateCondition(makeCtx(50), { ...between, operator: 'not_between' })).toBe(false);
  });

  test('範囲外: between=false / not_between=true', async () => {
    expect(await evaluateCondition(makeCtx(80), between)).toBe(false);
    expect(await evaluateCondition(makeCtx(80), { ...between, operator: 'not_between' })).toBe(true);
  });

  test('下限・上限が逆順でも min/max で正規化される', async () => {
    const reversed: IndicatorCondition = { ...between, compareTarget: { type: 'fixed', value: 70 }, compareTargetUpper: { type: 'fixed', value: 30 } };
    expect(await evaluateCondition(makeCtx(50), reversed)).toBe(true);
  });

  test('上限未指定なら不成立', async () => {
    const noUpper: IndicatorCondition = { ...between, compareTargetUpper: undefined };
    expect(await evaluateCondition(makeCtx(50), noUpper)).toBe(false);
  });
});

describe('直近ルックバック（lookbackBars）', () => {
  const data: OHLCV[] = Array.from({ length: 5 }, () => ({
    timestamp: new Date(), open: 1, high: 1, low: 1, close: 1, volume: 0,
  }));
  // hammer は index 1 でのみ出現
  const patternCache = new Map<CandlePatternId, boolean[]>();
  patternCache.set('hammer', [false, true, false, false, false]);
  const ctxAt = (i: number): EvaluationContext => ({
    data, currentIndex: i, indicatorCache: new Map(), patternCache, strategy: mockStrategy,
  });
  const hammer: PatternCondition = { conditionId: 'p', type: 'pattern', patternId: 'hammer', operator: 'is_true', lookbackBars: 3 };

  test('パターンが直近N本以内に出現で成立、窓外なら不成立', async () => {
    const group: ConditionGroup = { groupId: 'g', operator: 'AND', conditions: [hammer] };
    // index 3: 窓 [1,3] に hammer(index1) を含む → true
    expect(await evaluateConditionGroup(ctxAt(3), group)).toBe(true);
    // index 4: 窓 [2,4] に hammer なし → false
    expect(await evaluateConditionGroup(ctxAt(4), group)).toBe(false);
  });

  test('lookback 無しは現在足のみで判定する', async () => {
    const group: ConditionGroup = { groupId: 'g', operator: 'AND', conditions: [{ ...hammer, lookbackBars: undefined }] };
    expect(await evaluateConditionGroup(ctxAt(1), group)).toBe(true);
    expect(await evaluateConditionGroup(ctxAt(3), group)).toBe(false);
  });
});

describe('マルチタイムフレーム条件（timeframeOverride、Phase γ）', () => {
  /** 連続バー列を作る (timestamp は startMs から tfMs 間隔、close は値配列) */
  const makeBars = (startMs: number, tfMs: number, closes: number[]): OHLCV[] =>
    closes.map((close, i) => ({
      timestamp: new Date(startMs + i * tfMs),
      open: close, high: close, low: close, close, volume: 0,
    }));

  const M15 = 15 * 60_000;
  const H1 = 60 * 60_000;
  const T0 = Date.UTC(2026, 0, 5, 0, 0, 0); // 月曜 00:00 UTC

  describe('buildTimeframeIndexMap (lookahead 防止の核)', () => {
    test('上位足は「確定した直前バー」のみを指す (進行中バーを見ない)', () => {
      // 基準 15m × 8 本 (00:00〜01:45)、ビュー 1h × 2 本 (00:00, 01:00)
      const base = makeBars(T0, M15, [1, 2, 3, 4, 5, 6, 7, 8]);
      const view = makeBars(T0, H1, [10, 20]);
      const map = buildTimeframeIndexMap(base, M15, view, H1);

      // 00:00〜00:30 の 15m バー (close 00:15〜00:45) では 1h バーは未確定 → -1
      expect(map[0]).toBe(-1);
      expect(map[1]).toBe(-1);
      expect(map[2]).toBe(-1);
      // 00:45 の 15m バー (close 01:00) で最初の 1h バー (close 01:00) が確定 → index 0
      expect(map[3]).toBe(0);
      // 01:00〜01:30 はまだ 2 本目の 1h が進行中 → 引き続き index 0
      expect(map[4]).toBe(0);
      expect(map[6]).toBe(0);
      // 01:45 (close 02:00) で 2 本目 (close 02:00) が確定 → index 1
      expect(map[7]).toBe(1);
    });

    test('下位足ビュー (基準より細かい足) は基準バー終了時点までの最新バーを指す', () => {
      // 基準 1h × 2 本、ビュー 15m × 8 本
      const base = makeBars(T0, H1, [1, 2]);
      const view = makeBars(T0, M15, [1, 2, 3, 4, 5, 6, 7, 8]);
      const map = buildTimeframeIndexMap(base, H1, view, M15);

      // 1h バー 0 (close 01:00) → 15m index 3 (close 01:00) まで参照可
      expect(map[0]).toBe(3);
      expect(map[1]).toBe(7);
    });
  });

  describe('collectTimeframeOverrides', () => {
    test('ネスト・IF_THEN・SEQUENCE から重複なく収集し、基準足は除外する', () => {
      const leaf = (tf?: string): IndicatorCondition => ({
        conditionId: 'c', indicatorId: 'rsi', params: { period: 14 }, field: 'value',
        operator: '>', compareTarget: { type: 'fixed', value: 50 },
        ...(tf !== undefined ? { timeframeOverride: tf } : {}),
      });
      const group: ConditionGroup = {
        groupId: 'root', operator: 'AND',
        conditions: [
          leaf('1h'),
          leaf('15m'), // 基準足と同じ → 除外
          { groupId: 'nested', operator: 'OR', conditions: [leaf('4h'), leaf()] },
        ],
        ifCondition: leaf('1h'),
        sequence: [leaf('30m')],
      };

      const tfs = collectTimeframeOverrides(group, '15m');
      expect([...tfs].sort()).toEqual(['1h', '30m', '4h']);
      expect(collectTimeframeOverrides(null, '15m').size).toBe(0);
    });
  });

  describe('evaluateConditionGroup のビュー参照', () => {
    /** RSI 系列をビュー側にだけ持たせた MTF コンテキストを組む */
    const buildMtfCtx = (
      baseLen: number,
      currentIndex: number,
      viewRsi: number[],
      indexMapOverride?: number[]
    ): EvaluationContext => {
      const base = makeBars(T0, M15, Array.from({ length: baseLen }, () => 1));
      const view = makeBars(T0, H1, Array.from({ length: viewRsi.length }, () => 1));
      const viewIndicatorCache = new Map<string, number[]>();
      viewIndicatorCache.set(
        makeIndicatorCacheKey('rsi', { period: 14 }, 'value'),
        viewRsi
      );
      const timeframeViews = new Map<string, TimeframeView>();
      timeframeViews.set('1h', {
        data: view,
        indicatorCache: viewIndicatorCache,
        indexMap: indexMapOverride ?? buildTimeframeIndexMap(base, M15, view, H1),
      });
      return {
        data: base,
        currentIndex,
        indicatorCache: new Map(), // 基準足側には RSI を入れない (ビュー参照の証明)
        // 基準足は 15m。override '1h' は上位足なのでビュー参照される
        // (基準足同値ロジックと衝突しないよう timeframe を 15m に揃える)
        strategy: { ...mockStrategy, timeframe: '15m' as const },
        timeframeViews,
      };
    };

    const rsiOver50On1h: ConditionGroup = {
      groupId: 'g', operator: 'AND',
      conditions: [{
        conditionId: 'c1', indicatorId: 'rsi', params: { period: 14 }, field: 'value',
        operator: '>', compareTarget: { type: 'fixed', value: 50 },
        timeframeOverride: '1h',
      }],
    };

    test('override 条件はビュー側の確定バーの指標値で判定される (正常系)', async () => {
      // 1h RSI: [40, 60]。基準 15m index 7 (close 02:00) → 1h index 1 (RSI 60) → true
      const ctx = buildMtfCtx(8, 7, [40, 60]);
      expect(await evaluateConditionGroup(ctx, rsiOver50On1h)).toBe(true);
      // 基準 index 4 (close 01:15) → 1h index 0 (RSI 40) → false
      const ctx2 = buildMtfCtx(8, 4, [40, 60]);
      expect(await evaluateConditionGroup(ctx2, rsiOver50On1h)).toBe(false);
    });

    test('対応する確定バーがまだ無い場合は不成立 (lookahead 防止の境界値)', async () => {
      // 基準 index 0 (close 00:15) → 1h バー未確定 (indexMap=-1) → false
      const ctx = buildMtfCtx(8, 0, [99, 99]);
      expect(await evaluateConditionGroup(ctx, rsiOver50On1h)).toBe(false);
    });

    test('ビューが未準備 (timeframeViews に無い足) は不成立として安全に倒す (異常系)', async () => {
      const ctx = buildMtfCtx(8, 7, [40, 60]);
      const groupOn4h: ConditionGroup = {
        ...rsiOver50On1h,
        conditions: [{ ...(rsiOver50On1h.conditions[0] as IndicatorCondition), timeframeOverride: '4h' }],
      };
      expect(await evaluateConditionGroup(ctx, groupOn4h)).toBe(false);
    });

    test('lookback は override した足の本数で数える', async () => {
      // 1h RSI: [60, 40]。基準 index 7 → 1h index 1 (RSI 40)。
      // lookback 無しなら false、lookbackBars=2 なら 1h 2 本以内に RSI>50 (index 0) があり true
      const noLookback = buildMtfCtx(8, 7, [60, 40]);
      expect(await evaluateConditionGroup(noLookback, rsiOver50On1h)).toBe(false);

      const withLookback: ConditionGroup = {
        ...rsiOver50On1h,
        conditions: [{ ...(rsiOver50On1h.conditions[0] as IndicatorCondition), lookbackBars: 2 }],
      };
      const ctx = buildMtfCtx(8, 7, [60, 40]);
      expect(await evaluateConditionGroup(ctx, withLookback)).toBe(true);
    });

    test('timeframeOverride が基準足と同値なら基準コンテキストで評価する (Copilot 指摘1)', async () => {
      // 基準足 15m と同じ '15m' を override 指定。ビューは準備されないが、
      // 基準コンテキスト(基準足側の指標)で評価され「常に不成立」にはならない。
      // 基準足側 RSI を 60 にしておけば RSI>50 で true になる。
      const base = makeBars(T0, M15, Array.from({ length: 8 }, () => 1));
      const baseIndicatorCache = new Map<string, number[]>();
      baseIndicatorCache.set(
        makeIndicatorCacheKey('rsi', { period: 14 }, 'value'),
        Array.from({ length: 8 }, () => 60)
      );
      const ctx: EvaluationContext = {
        data: base,
        currentIndex: 7,
        indicatorCache: baseIndicatorCache,
        strategy: mockStrategy, // timeframe '1h'
        timeframeViews: new Map(), // ビューは空
      };
      const sameTf: ConditionGroup = {
        ...rsiOver50On1h,
        // mockStrategy.timeframe は '1h' なので '1h' を override 指定 = 基準足同値
        conditions: [{ ...(rsiOver50On1h.conditions[0] as IndicatorCondition), timeframeOverride: '1h' }],
      };
      expect(await evaluateConditionGroup(ctx, sameTf)).toBe(true);
    });
  });
});

describe('レンズ条件(レンズ条件タイプ #3。設計書 §12.4)', () => {
  /** 3 バーのダミーデータ */
  const lensBars: OHLCV[] = [0, 1, 2].map((i) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, i)),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));

  /** lens キャッシュ入りの評価コンテキストを作る(系列は数値エンコード済み前提) */
  function lensCtx(series: Record<string, number[]>, currentIndex = 0): EvaluationContext {
    return {
      data: lensBars,
      currentIndex,
      indicatorCache: new Map(Object.entries(series)),
      strategy: mockStrategy,
    };
  }

  /** rsi_zone = oversold を既定とするレンズ条件 */
  function lensCond(overrides: Partial<LensCondition> = {}): LensCondition {
    return {
      conditionId: 'lc1',
      type: 'lens',
      lensId: 'ind:rsi#p14',
      featureKey: 'rsi_zone',
      operator: '=',
      value: 'oversold',
      ...overrides,
    };
  }

  // orderedEnum のエンコード規約: order の index(oversold=0 / neutral=1 / overbought=2)

  test('enum 一致(=)で成立、不一致なら不成立', () => {
    const key = makeLensCacheKey('ind:rsi#p14', 'rsi_zone');
    expect(evaluateLensCondition(lensCtx({ [key]: [0] }), lensCond())).toBe(true);
    expect(evaluateLensCondition(lensCtx({ [key]: [1] }), lensCond())).toBe(false);
  });

  test('enum 不一致(!=)で成立', () => {
    const key = makeLensCacheKey('ind:rsi#p14', 'rsi_zone');
    expect(evaluateLensCondition(lensCtx({ [key]: [1] }), lensCond({ operator: '!=' }))).toBe(true);
    expect(evaluateLensCondition(lensCtx({ [key]: [0] }), lensCond({ operator: '!=' }))).toBe(false);
  });

  test('orderedEnum は順序 index で大小比較できる(順序範囲演算子)', () => {
    const key = makeLensCacheKey('ind:rsi#p14', 'rsi_zone');
    // エンコード規約: oversold=0 / neutral=1 / overbought=2
    const lte = lensCond({ operator: '<=', value: 'neutral' });
    expect(evaluateLensCondition(lensCtx({ [key]: [0] }), lte)).toBe(true); // 売られすぎ ≤ 中立
    expect(evaluateLensCondition(lensCtx({ [key]: [1] }), lte)).toBe(true); // 中立 ≤ 中立
    expect(evaluateLensCondition(lensCtx({ [key]: [2] }), lte)).toBe(false); // 買われすぎ > 中立
    const gt = lensCond({ operator: '>', value: 'neutral' });
    expect(evaluateLensCondition(lensCtx({ [key]: [2] }), gt)).toBe(true);
    expect(evaluateLensCondition(lensCtx({ [key]: [1] }), gt)).toBe(false);
  });

  test('数値系 featureKey は比較演算子で判定する(bb_position < 0.2)', () => {
    const key = makeLensCacheKey('ind:bb#p20', 'bb_position');
    const cond = lensCond({ lensId: 'ind:bb#p20', featureKey: 'bb_position', operator: '<', value: 0.2 });
    expect(evaluateLensCondition(lensCtx({ [key]: [0.1] }), cond)).toBe(true);
    expect(evaluateLensCondition(lensCtx({ [key]: [0.5] }), cond)).toBe(false);
  });

  test('イベント値(macd_cross)は bull=1/none=0/bear=-1 エンコードで一致判定できる', () => {
    const key = makeLensCacheKey('ind:macd#f12s26g9', 'macd_cross');
    const cond = lensCond({ lensId: 'ind:macd#f12s26g9', featureKey: 'macd_cross', operator: '=', value: 'bull' });
    expect(evaluateLensCondition(lensCtx({ [key]: [1] }), cond)).toBe(true);
    expect(evaluateLensCondition(lensCtx({ [key]: [0] }), cond)).toBe(false);
    expect(evaluateLensCondition(lensCtx({ [key]: [-1] }), cond)).toBe(false);
    // 継承プロパティ名 (constructor 等) はエンコード不能 = 不成立 (prototype 汚染防御)
    const polluted = lensCond({ lensId: 'ind:macd#f12s26g9', featureKey: 'macd_cross', operator: '!=', value: 'constructor' });
    expect(evaluateLensCondition(lensCtx({ [key]: [1] }), polluted)).toBe(false);
  });

  test('sentinel(-1 = イベント未発生)は数値比較せず不成立に倒す(誤判定防止)', () => {
    const key = makeLensCacheKey('ind:macd#f12s26g9', 'macd_bars_since_cross');
    const cond = lensCond({
      lensId: 'ind:macd#f12s26g9',
      featureKey: 'macd_bars_since_cross',
      operator: '<',
      value: 5,
    });
    // sentinel(-1) は「-1 < 5 = true」になってしまうため、比較前に弾かれること
    expect(evaluateLensCondition(lensCtx({ [key]: [-1] }), cond)).toBe(false);
    expect(evaluateLensCondition(lensCtx({ [key]: [3] }), cond)).toBe(true);
  });

  test('欠損バー(NaN)・キャッシュ未登録は不成立に倒す(§12.4-4)', () => {
    const key = makeLensCacheKey('ind:rsi#p14', 'rsi_zone');
    expect(evaluateLensCondition(lensCtx({ [key]: [Number.NaN] }), lensCond())).toBe(false);
    expect(evaluateLensCondition(lensCtx({}), lensCond())).toBe(false);
  });

  test('evaluateConditionGroup 経由でも判定でき、lookbackBars(直近N本)が効く', async () => {
    const key = makeLensCacheKey('ind:rsi#p14', 'rsi_zone');
    // index=0 だけ oversold(0)、以降は neutral(1)
    const ctx = lensCtx({ [key]: [0, 1, 1] }, 2);
    const group: ConditionGroup = { groupId: 'g', operator: 'AND', conditions: [lensCond()] };
    expect(await evaluateConditionGroup(ctx, group)).toBe(false);

    const lookbackGroup: ConditionGroup = {
      groupId: 'g',
      operator: 'AND',
      conditions: [lensCond({ lookbackBars: 3 })],
    };
    expect(await evaluateConditionGroup({ ...ctx }, lookbackGroup)).toBe(true);
  });

  test('collectLensConditions が入れ子グループ・ifCondition・sequence から収集する', () => {
    const group: ConditionGroup = {
      groupId: 'root',
      operator: 'AND',
      conditions: [
        lensCond({ conditionId: 'a' }),
        {
          groupId: 'sub',
          operator: 'OR',
          conditions: [lensCond({ conditionId: 'b' })],
        },
      ],
      ifCondition: lensCond({ conditionId: 'c' }),
      sequence: [lensCond({ conditionId: 'd' })],
    };
    const collected = collectLensConditions(group).map((c) => c.conditionId);
    expect(collected.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(collectLensConditions(null)).toEqual([]);
  });

  test('collectTimeframeOverrides がレンズ条件の timeframeOverride も収集する', () => {
    const group: ConditionGroup = {
      groupId: 'g',
      operator: 'AND',
      conditions: [lensCond({ timeframeOverride: '4h' })],
    };
    expect([...collectTimeframeOverrides(group, '1h')]).toEqual(['4h']);
  });

  test('timeframeOverride 付きレンズ条件はビュー側のレンズ系列で判定する(確定バーのみ)', async () => {
    const key = makeLensCacheKey('ind:rsi#p14', 'rsi_zone');
    const viewBars: OHLCV[] = [
      { timestamp: new Date(Date.UTC(2026, 0, 1, 0)), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
    ];
    const view: TimeframeView = {
      data: viewBars,
      indicatorCache: new Map([[key, [0]]]), // ビュー側は oversold
      indexMap: [0, 0, 0],
    };
    const ctx: EvaluationContext = {
      data: lensBars,
      currentIndex: 2,
      // 基準足側は neutral(=不成立)にして、ビュー側が参照されたことを判別する
      indicatorCache: new Map([[key, [1, 1, 1]]]),
      strategy: mockStrategy, // timeframe '1h'
      timeframeViews: new Map([['4h', view]]),
    };
    const group: ConditionGroup = {
      groupId: 'g',
      operator: 'AND',
      conditions: [lensCond({ timeframeOverride: '4h' })],
    };
    expect(await evaluateConditionGroup(ctx, group)).toBe(true);

    // 対応する確定バーがまだ無い(indexMap=-1)場合は不成立
    const noBarView: TimeframeView = { ...view, indexMap: [-1, -1, -1] };
    const ctx2: EvaluationContext = { ...ctx, timeframeViews: new Map([['4h', noBarView]]) };
    expect(await evaluateConditionGroup(ctx2, group)).toBe(false);
  });
});
