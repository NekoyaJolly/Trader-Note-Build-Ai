/**
 * 特徴量抽出サービスのテスト
 * 
 * テスト観点:
 * - 正常系: 特徴量が正しく計算されるか
 * - 境界値: 極端な値でも正しく動作するか
 * - デフォルト値: 市場コンテキストがない場合のフォールバック
 */

import { FeatureExtractor, MarketContext } from '../../services/note-generator/featureExtractor';
import { Trade, TradeSide, Prisma } from '@prisma/client';

describe('FeatureExtractor', () => {
  let extractor: FeatureExtractor;

  // テスト用のモックトレードデータ
  const createMockTrade = (overrides?: Partial<Trade>): Trade => ({
    id: 'test-trade-id',
    timestamp: new Date('2025-12-26T10:00:00Z'),
    symbol: 'BTCUSD',
    side: TradeSide.buy,
    price: new Prisma.Decimal(50000),
    quantity: new Prisma.Decimal(1.5),
    fee: null,
    exchange: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    extractor = new FeatureExtractor();
  });

  describe('extractFeatures', () => {
    test('市場コンテキストなしで特徴量を抽出できる', () => {
      const trade = createMockTrade();
      const result = extractor.extractFeatures(trade);

      // 特徴量ベクトルは固定長 7
      expect(result.values).toHaveLength(7);
      expect(result.version).toBe('1.0.0');

      // 市場コンテキストがない場合のデフォルト値
      expect(result.values[0]).toBe(0); // 価格変化率 (前日終値なし)
      expect(result.values[1]).toBe(0.5); // 取引量 (平均取引量なし)
      expect(result.values[2]).toBe(0.5); // RSI (デフォルト)
      expect(result.values[3]).toBe(0); // MACD (デフォルト)
      expect(result.values[4]).toBe(0); // トレンド (横ばい)
      expect(result.values[5]).toBe(0); // ボラティリティ
      expect(result.values[6]).toBe(0); // 時間帯フラグ (通常時間)
    });

    test('市場コンテキストありで特徴量を抽出できる', () => {
      const trade = createMockTrade({ price: new Prisma.Decimal(51000) });
      const context: MarketContext = {
        previousClose: 50000,
        averageVolume: 2.0,
        rsi: 65,
        macd: 0.5,
        timeframe: '15m',
      };

      const result = extractor.extractFeatures(trade, context);

      expect(result.values).toHaveLength(7);

      // 価格変化率: (51000 - 50000) / 50000 = 0.02 (2%)
      expect(result.values[0]).toBeCloseTo(0.02, 2);

      // 取引量: 1.5 / (2.0 * 2) = 0.375
      expect(result.values[1]).toBeCloseTo(0.375, 2);

      // RSI: 65 / 100 = 0.65
      expect(result.values[2]).toBeCloseTo(0.65, 2);

      // MACD: tanh(0.5 / 10)
      expect(result.values[3]).toBeCloseTo(Math.tanh(0.05), 2);

      // トレンド: 価格変化率 > 0.01 なので 1 (上昇)
      expect(result.values[4]).toBe(1);

      // ボラティリティ: abs(0.02) = 0.02
      expect(result.values[5]).toBeCloseTo(0.02, 2);

      // 時間帯フラグ: 通常時間
      expect(result.values[6]).toBe(0);
    });

    test('価格上昇時はトレンドが上昇になる', () => {
      const trade = createMockTrade({ price: new Prisma.Decimal(51000) });
      const context: MarketContext = {
        previousClose: 50000, // 2% 上昇
      };

      const result = extractor.extractFeatures(trade, context);

      // トレンド: 上昇 (1)
      expect(result.values[4]).toBe(1);
    });

    test('価格下降時はトレンドが下降になる', () => {
      const trade = createMockTrade({ price: new Prisma.Decimal(49000) });
      const context: MarketContext = {
        previousClose: 50000, // 2% 下降
      };

      const result = extractor.extractFeatures(trade, context);

      // トレンド: 下降 (-1)
      expect(result.values[4]).toBe(-1);
    });

    test('価格変化が小さい場合はトレンドが横ばいになる', () => {
      const trade = createMockTrade({ price: new Prisma.Decimal(50200) });
      const context: MarketContext = {
        previousClose: 50000, // 0.4% 上昇 (閾値 1% 未満)
      };

      const result = extractor.extractFeatures(trade, context);

      // トレンド: 横ばい (0)
      expect(result.values[4]).toBe(0);
    });

    test('オープン/クローズ付近の時間帯フラグが立つ', () => {
      const trade = createMockTrade();
      const context: MarketContext = {
        marketHours: {
          isOpen: true,
          isNearOpen: true,
          isNearClose: false,
        },
      };

      const result = extractor.extractFeatures(trade, context);

      // 時間帯フラグ: オープン付近 (1)
      expect(result.values[6]).toBe(1);
    });

    test('極端な価格変化率はクリップされる', () => {
      const trade = createMockTrade({ price: new Prisma.Decimal(150000) });
      const context: MarketContext = {
        previousClose: 50000, // 200% 上昇
      };

      const result = extractor.extractFeatures(trade, context);

      // 価格変化率: 1.0 にクリップされる
      expect(result.values[0]).toBe(1.0);
    });

    test('極端な取引量は正規化される', () => {
      const trade = createMockTrade({ quantity: new Prisma.Decimal(100) });
      const context: MarketContext = {
        averageVolume: 2.0,
      };

      const result = extractor.extractFeatures(trade, context);

      // 取引量: 100 / (2.0 * 2) = 25 → 1.0 にクリップ
      expect(result.values[1]).toBe(1.0);
    });
  });

  describe('describeFeatures', () => {
    test('特徴量を人間が読める形式で説明できる', () => {
      const trade = createMockTrade({ price: new Prisma.Decimal(51000) });
      const context: MarketContext = {
        previousClose: 50000,
        rsi: 65,
      };

      const result = extractor.extractFeatures(trade, context);
      const description = extractor.describeFeatures(result);

      expect(description).toContain('価格変化率');
      expect(description).toContain('RSI');
      expect(description).toContain('上昇');
    });
  });
});
