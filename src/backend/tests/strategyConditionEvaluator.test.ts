/**
 * ストラテジー条件評価サービスのテスト
 * 
 * 目的:
 * - 共通条件評価ロジックの動作確認
 * - バックテストとリアルタイム評価の両方で使用される重要なロジックをテスト
 */

import {
  evaluateCondition,
  evaluateConditionGroup,
  getIndicatorValue,
  getPriceValue,
  EvaluationContext,
  IndicatorCondition,
  ConditionGroup,
  OHLCV,
} from '../services/strategyConditionEvaluator';

// モックストラテジー
const mockStrategy = {
  id: 'test-strategy',
  name: 'テストストラテジー',
  description: 'テスト用のストラテジー',
  symbol: 'USDJPY',
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
    test('RSI を計算してキャッシュする', async () => {
      // 100本の価格データを生成（RSI計算には最低14本必要）
      const mockData: OHLCV[] = [];
      let price = 150.0;
      for (let i = 0; i < 100; i++) {
        price += (Math.random() - 0.5) * 2;
        mockData.push({
          timestamp: new Date(`2024-01-01T${String(i).padStart(2, '0')}:00:00Z`),
          open: price - 0.1,
          high: price + 0.2,
          low: price - 0.2,
          close: price,
          volume: 1000,
        });
      }

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 50,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      const rsiValue = await getIndicatorValue(ctx, 'rsi', { period: 14 }, 'value');

      // RSI は 0〜100 の範囲内にあるべき
      expect(rsiValue).toBeDefined();
      expect(rsiValue!).toBeGreaterThanOrEqual(0);
      expect(rsiValue!).toBeLessThanOrEqual(100);

      // キャッシュに保存されているはず
      expect(ctx.indicatorCache.size).toBeGreaterThan(0);
    });

    test('SMA を計算してキャッシュする', async () => {
      const mockData: OHLCV[] = [];
      for (let i = 0; i < 50; i++) {
        mockData.push({
          timestamp: new Date(`2024-01-01T${String(i).padStart(2, '0')}:00:00Z`),
          open: 150.0,
          high: 151.0,
          low: 149.0,
          close: 150.0 + i * 0.1,
          volume: 1000,
        });
      }

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 30,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

      const smaValue = await getIndicatorValue(ctx, 'sma', { period: 20 }, 'value');

      expect(smaValue).toBeDefined();
      expect(smaValue!).toBeGreaterThan(150.0);
      expect(smaValue!).toBeLessThan(155.0);
    });
  });

  describe('evaluateCondition', () => {
    test('固定値との比較: RSI < 30', async () => {
      // RSI が低い状態を作るため、下降トレンドのデータを生成
      const mockData: OHLCV[] = [];
      let price = 160.0;
      for (let i = 0; i < 100; i++) {
        price -= 0.5; // 継続的な下降
        mockData.push({
          timestamp: new Date(`2024-01-01T${String(i).padStart(2, '0')}:00:00Z`),
          open: price + 0.2,
          high: price + 0.3,
          low: price - 0.1,
          close: price,
          volume: 1000,
        });
      }

      const ctx: EvaluationContext = {
        data: mockData,
        currentIndex: 50,
        indicatorCache: new Map(),
        strategy: mockStrategy,
      };

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

      // 強い下降トレンドなので RSI < 30 のはず
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

      // 急落後なので SMA > 現在価格 のはず
      expect(result).toBe(true);
    });
  });

  describe('evaluateConditionGroup', () => {
    test('AND 演算子: すべての条件が真の場合', async () => {
      // RSI が 30〜70 の範囲に収まるよう、上下に変動するデータを生成
      // 価格が一定範囲内で推移すると RSI は中央値付近（50前後）に収束する
      const mockData: OHLCV[] = [];
      for (let i = 0; i < 50; i++) {
        // sin波で価格を変動させる（150を中心に ±2 の範囲）
        const price = 150.0 + Math.sin(i * 0.3) * 2;
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

      // 変動するデータなので RSI は 30〜70 の範囲内のはず
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

      // SMA ≈ 150.0 なので OR の片方が真
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

      // フラットな価格なので RSI < 30 は偽、NOT で真
      expect(result).toBe(true);
    });
  });
});
