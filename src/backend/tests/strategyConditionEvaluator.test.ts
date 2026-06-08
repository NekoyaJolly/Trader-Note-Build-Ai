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
  ConditionGroup,
  OHLCV} from '../services/strategyConditionEvaluator';
import {
  evaluateCondition,
  evaluateConditionGroup,
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
