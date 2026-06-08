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
  ConditionGroup,
  OHLCV} from '../services/strategyConditionEvaluator';
import {
  evaluateCondition,
  evaluateConditionGroup,
  evaluateTimeConditionAt,
  getIndicatorValue,
  getPriceValue
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
