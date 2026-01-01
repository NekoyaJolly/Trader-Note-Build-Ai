/**
 * TradeDefinition サービス テスト
 * 
 * テスト対象:
 * - TradeDefinition 生成
 * - インジケーター計算
 * - 派生コンテキスト導出
 * - 特徴量ベクトル生成
 */

import {
  TradeDefinitionService,
  tradeDefinitionService,
} from '../../services/tradeDefinitionService';
import { createDefaultIndicatorSet } from '../../models/indicatorConfig';
import { Trade } from '../../models/types';

describe('TradeDefinitionService', () => {
  let service: TradeDefinitionService;

  beforeEach(() => {
    service = new TradeDefinitionService();
  });

  describe('generateDefinition', () => {
    it('正常なトレードから TradeDefinition を生成できること', async () => {
      const trade: Trade = {
        id: 'test-trade-1',
        timestamp: new Date('2024-01-15T10:30:00Z'),
        symbol: 'BTC/USD',
        side: 'buy',
        price: 42000,
        quantity: 0.5,
      };

      const indicatorConfigs = createDefaultIndicatorSet().configs;

      const result = await service.generateDefinition({
        trade,
        indicatorConfigs,
        timeframe: '15m',
      });

      expect(result.success).toBe(true);
      expect(result.definition).toBeDefined();
      expect(result.definition?.trade.symbol).toBe('BTC/USD');
      expect(result.definition?.trade.normalized).toBe(true);
    });

    it('未正規化トレードを自動で正規化すること', async () => {
      const trade: Trade = {
        id: 'test-trade-2',
        timestamp: new Date('2024-01-15T10:30:00Z'),
        symbol: 'BTCUSD', // 未正規化形式
        side: 'buy',
        price: 42000,
        quantity: 0.5,
      };

      const indicatorConfigs = createDefaultIndicatorSet().configs;

      const result = await service.generateDefinition({
        trade,
        indicatorConfigs,
        timeframe: '15m',
      });

      expect(result.success).toBe(true);
      // 正規化されていることを確認
      expect(result.definition?.trade.normalizedSymbol).toBe('BTC/USD');
    });

    it('インジケーター計算結果が含まれること', async () => {
      const trade: Trade = {
        id: 'test-trade-3',
        timestamp: new Date(),
        symbol: 'BTC/USD',
        side: 'buy',
        price: 42000,
        quantity: 0.5,
      };

      const indicatorConfigs = createDefaultIndicatorSet().configs;

      const result = await service.generateDefinition({
        trade,
        indicatorConfigs,
        timeframe: '15m',
      });

      expect(result.success).toBe(true);
      expect(result.definition?.indicatorSnapshot).toBeDefined();
      expect(result.definition?.indicatorSnapshot.results.length).toBeGreaterThan(0);
    });

    it('派生コンテキストが生成されること', async () => {
      const trade: Trade = {
        id: 'test-trade-4',
        timestamp: new Date(),
        symbol: 'BTC/USD',
        side: 'buy',
        price: 42000,
        quantity: 0.5,
      };

      const indicatorConfigs = createDefaultIndicatorSet().configs;

      const result = await service.generateDefinition({
        trade,
        indicatorConfigs,
        timeframe: '15m',
      });

      expect(result.success).toBe(true);
      expect(result.definition?.derivedContext).toBeDefined();
      expect(['uptrend', 'downtrend', 'neutral']).toContain(result.definition?.derivedContext.trend);
      expect(typeof result.definition?.derivedContext.trendStrength).toBe('number');
      expect(['low', 'medium', 'high']).toContain(result.definition?.derivedContext.volatility);
    });

    it('特徴量ベクトルが生成されること', async () => {
      const trade: Trade = {
        id: 'test-trade-5',
        timestamp: new Date(),
        symbol: 'BTC/USD',
        side: 'buy',
        price: 42000,
        quantity: 0.5,
      };

      const indicatorConfigs = createDefaultIndicatorSet().configs;

      const result = await service.generateDefinition({
        trade,
        indicatorConfigs,
        timeframe: '15m',
      });

      expect(result.success).toBe(true);
      expect(result.definition?.featureVector).toBeDefined();
      expect(Array.isArray(result.definition?.featureVector)).toBe(true);
      expect(result.definition?.featureVector.length).toBe(12); // 12次元ベクトル（統一後）
      expect(result.definition?.vectorDimension).toBe(12);
    });

    it('市場データ取得失敗時もモックデータで処理を継続すること', async () => {
      const trade: Trade = {
        id: 'test-trade-6',
        timestamp: new Date(),
        symbol: 'UNKNOWN/PAIR', // 存在しないペア
        side: 'buy',
        price: 100,
        quantity: 1,
      };

      const indicatorConfigs = createDefaultIndicatorSet().configs;

      const result = await service.generateDefinition({
        trade,
        indicatorConfigs,
        timeframe: '15m',
      });

      // モックデータで処理継続されるため成功
      expect(result.success).toBe(true);
      // 警告があってもなくても、定義が生成されることを確認
      expect(result.definition).toBeDefined();
    });
  });

  describe('generateDefinitionsBatch', () => {
    it('複数トレードを一括処理できること', async () => {
      const trades: Trade[] = [
        {
          id: 'batch-1',
          timestamp: new Date(),
          symbol: 'BTC/USD',
          side: 'buy',
          price: 42000,
          quantity: 0.5,
        },
        {
          id: 'batch-2',
          timestamp: new Date(),
          symbol: 'ETH/USD',
          side: 'sell',
          price: 2500,
          quantity: 2,
        },
      ];

      const indicatorConfigs = createDefaultIndicatorSet().configs;

      const result = await service.generateDefinitionsBatch(
        trades,
        indicatorConfigs,
        '15m'
      );

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.processingTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('シングルトンインスタンス', () => {
    it('tradeDefinitionService がエクスポートされていること', () => {
      expect(tradeDefinitionService).toBeDefined();
      expect(tradeDefinitionService).toBeInstanceOf(TradeDefinitionService);
    });
  });
});
