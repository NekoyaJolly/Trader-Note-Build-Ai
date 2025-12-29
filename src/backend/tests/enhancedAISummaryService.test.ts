/**
 * 拡張 AI 要約サービステスト
 * 
 * 目的: 拡張 AI 要約サービスの動作検証
 * 
 * テスト内容:
 * - 詳細テンプレート生成
 * - 判断モード推定
 * - 市場コンテキスト構築
 */

import {
  EnhancedAISummaryService,
  ExtendedTradeData,
} from '../../services/enhancedAISummaryService';
import { FeatureSnapshot } from '../../services/indicators/indicatorService';

describe('EnhancedAISummaryService', () => {
  let service: EnhancedAISummaryService;

  beforeAll(() => {
    service = new EnhancedAISummaryService();
  });

  describe('テンプレートフォールバック', () => {
    it('順張り買いのテンプレートを生成できる', async () => {
      const tradeData: ExtendedTradeData = {
        symbol: 'BTCUSD',
        side: 'buy',
        price: 50000,
        quantity: 0.1,
        timestamp: new Date('2024-01-15T10:30:00Z'),
        marketContext: {
          trend: 'uptrend',
          rsi: 55,
          timeframe: '1h',
        },
        estimatedMode: 'trend_follow',
      };

      const result = await service.generateEnhancedSummary(tradeData);

      expect(result.summary).toContain('BTCUSD');
      expect(result.summary).toContain('買い');
      expect(result.summary).toContain('順張り');
      expect(result.model).toContain('template');
    });

    it('逆張り売りのテンプレートを生成できる', async () => {
      const tradeData: ExtendedTradeData = {
        symbol: 'ETHUSD',
        side: 'sell',
        price: 3000,
        quantity: 1,
        timestamp: new Date('2024-01-15T14:00:00Z'),
        marketContext: {
          trend: 'uptrend',
          rsi: 75,
        },
        estimatedMode: 'counter_trend',
      };

      const result = await service.generateEnhancedSummary(tradeData);

      expect(result.summary).toContain('ETHUSD');
      expect(result.summary).toContain('売り');
      expect(result.summary).toContain('逆張り');
    });

    it('ニュートラルなテンプレートを生成できる', async () => {
      const tradeData: ExtendedTradeData = {
        symbol: 'SOLUSD',
        side: 'buy',
        price: 100,
        quantity: 10,
        timestamp: new Date(),
        estimatedMode: 'neutral',
      };

      const result = await service.generateEnhancedSummary(tradeData);

      expect(result.summary).toContain('レンジ');
    });
  });

  describe('特徴量スナップショットからの市場コンテキスト生成', () => {
    it('特徴量スナップショットからコンテキストを生成できる', async () => {
      const snapshot: FeatureSnapshot = {
        timestamp: new Date(),
        timeframe: '1h',
        close: 50000,
        volume: 1000,
        rsi: 60,
        sma: 49000,
        ema: 49500,
        macd: {
          macdLine: [100, 150, 200],
          signalLine: [80, 120, 150],
          histogram: [20, 30, 50],
        },
      };

      const tradeData: ExtendedTradeData = {
        symbol: 'BTCUSD',
        side: 'buy',
        price: 50000,
        quantity: 0.1,
        timestamp: new Date(),
        featureSnapshot: snapshot,
      };

      const result = await service.generateEnhancedSummary(tradeData);

      expect(result.summary).toContain('RSI');
      expect(result.summary).toContain('60');
    });
  });

  describe('類似トレード情報の表示', () => {
    it('類似トレード情報がある場合に表示される', async () => {
      const tradeData: ExtendedTradeData = {
        symbol: 'BTCUSD',
        side: 'buy',
        price: 50000,
        quantity: 0.1,
        timestamp: new Date(),
        similarTrades: {
          count: 5,
          winRate: 0.6,
        },
      };

      const result = await service.generateEnhancedSummary(tradeData);

      expect(result.summary).toContain('類似');
      expect(result.summary).toContain('5件');
      expect(result.summary).toContain('60');
    });
  });

  describe('インジケーター表示', () => {
    it('RSI が買われすぎの場合にコメントが追加される', async () => {
      const tradeData: ExtendedTradeData = {
        symbol: 'BTCUSD',
        side: 'sell',
        price: 55000,
        quantity: 0.1,
        timestamp: new Date(),
        marketContext: {
          rsi: 75,
          trend: 'uptrend',
        },
      };

      const result = await service.generateEnhancedSummary(tradeData);

      expect(result.summary).toContain('買われすぎ');
    });

    it('RSI が売られすぎの場合にコメントが追加される', async () => {
      const tradeData: ExtendedTradeData = {
        symbol: 'BTCUSD',
        side: 'buy',
        price: 45000,
        quantity: 0.1,
        timestamp: new Date(),
        marketContext: {
          rsi: 25,
          trend: 'downtrend',
        },
      };

      const result = await service.generateEnhancedSummary(tradeData);

      expect(result.summary).toContain('売られすぎ');
    });
  });

  describe('判断モード推定', () => {
    it('上昇トレンドで買いは順張りと推定', async () => {
      const snapshot: FeatureSnapshot = {
        timestamp: new Date(),
        timeframe: '1h',
        close: 50000,
        volume: 1000,
        rsi: 60,
        sma: 48000,  // 価格がSMAより上
        ema: 49000,  // 価格がEMAより上
        macd: {
          macdLine: [100],
          signalLine: [80],
          histogram: [20],  // プラス
        },
      };

      const tradeData: ExtendedTradeData = {
        symbol: 'BTCUSD',
        side: 'buy',
        price: 50000,
        quantity: 0.1,
        timestamp: new Date(),
        featureSnapshot: snapshot,
      };

      const result = await service.generateEnhancedSummary(tradeData);

      // 上昇トレンドでの買い = 順張り
      expect(result.summary).toContain('順張り');
    });

    it('下降トレンドで買いは逆張りと推定', async () => {
      const snapshot: FeatureSnapshot = {
        timestamp: new Date(),
        timeframe: '1h',
        close: 45000,
        volume: 1000,
        rsi: 35,
        sma: 48000,  // 価格がSMAより下
        ema: 47000,  // 価格がEMAより下
        macd: {
          macdLine: [-100],
          signalLine: [-80],
          histogram: [-20],  // マイナス
        },
      };

      const tradeData: ExtendedTradeData = {
        symbol: 'BTCUSD',
        side: 'buy',
        price: 45000,
        quantity: 0.1,
        timestamp: new Date(),
        featureSnapshot: snapshot,
      };

      const result = await service.generateEnhancedSummary(tradeData);

      // 下降トレンドでの買い = 逆張り
      expect(result.summary).toContain('逆張り');
    });
  });
});
