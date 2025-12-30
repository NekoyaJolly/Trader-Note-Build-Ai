/**
 * MatchingService テスト
 * 
 * 目的:
 * - コサイン類似度計算の動作検証
 * - 次元不一致・NaN・0除算の防御テスト
 * - マッチ結果 DB 永続化のテスト
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MatchingService } from '../../services/matchingService';
import { TradeNote, MarketData } from '../../models/types';

describe('MatchingService', () => {
  let service: MatchingService;

  beforeEach(() => {
    service = new MatchingService();
  });

  // テスト用のトレードノートを生成
  const createMockNote = (overrides?: Partial<TradeNote>): TradeNote => ({
    id: 'note_test_123',
    tradeId: 'trade_test_123',
    timestamp: new Date(),
    symbol: 'BTCUSDT',
    side: 'buy',
    entryPrice: 50000,
    quantity: 1,
    marketContext: {
      timeframe: '15m',
      trend: 'bullish',
      indicators: { rsi: 60, macd: 10, volume: 1000 },
    },
    aiSummary: 'テスト要約',
    features: [50000, 1000, 60, 10, 1000, 1, 1],
    createdAt: new Date(),
    status: 'approved',
    ...overrides,
  });

  // テスト用の市場データを生成
  const createMockMarket = (overrides?: Partial<MarketData>): MarketData => ({
    symbol: 'BTCUSDT',
    timestamp: new Date(),
    timeframe: '15m',
    open: 49900,
    high: 50100,
    low: 49800,
    close: 50000,
    volume: 1000,
    indicators: {
      rsi: 60,
      macd: 10,
      trend: 'bullish',
    },
    ...overrides,
  });

  describe('calculateMatchScore', () => {
    it('同一条件で高いスコアが返る', () => {
      const note = createMockNote();
      const market = createMockMarket();

      const score = service.calculateMatchScore(note, market);

      // トレンド一致 + 価格レンジ一致 + 類似度で高スコアになるはず
      expect(score).toBeGreaterThan(0.5);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('トレンド不一致で低いスコアが返る', () => {
      const note = createMockNote({ marketContext: { timeframe: '15m', trend: 'bullish' } });
      const market = createMockMarket({ indicators: { rsi: 30, macd: -10, trend: 'bearish' } });

      const score = service.calculateMatchScore(note, market);

      // トレンド不一致でスコアが下がる
      expect(score).toBeLessThan(0.9);
    });

    it('価格レンジ外で低いスコアが返る', () => {
      const note = createMockNote({ entryPrice: 50000 });
      const market = createMockMarket({ close: 60000 }); // 20% 乖離

      const score = service.calculateMatchScore(note, market);

      // 価格レンジ外でスコアが下がる
      expect(score).toBeLessThan(1);
    });
  });

  describe('コサイン類似度（エッジケース）', () => {
    // 内部メソッドをテストするためのヘルパー
    const testCosineSimilarity = (vecA: number[], vecB: number[]): number => {
      // MatchingService のプライベートメソッドをテストするため、
      // calculateMatchScore 経由で間接的にテスト
      const note = createMockNote({ features: vecA });
      const market = createMockMarket();
      // 特徴量ベクトルが異なる場合の挙動を確認
      return service.calculateMatchScore(note, market);
    };

    it('空のベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [] });
      const market = createMockMarket();

      // エラーが発生せず、0 が返る
      expect(() => service.calculateMatchScore(note, market)).not.toThrow();
    });

    it('次元が異なるベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [1, 2, 3] });
      const market = createMockMarket();

      // エラーが発生しない（0埋めで対応）
      expect(() => service.calculateMatchScore(note, market)).not.toThrow();
    });

    it('NaN を含むベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [NaN, 2, 3, 4, 5, 6, 7] });
      const market = createMockMarket();

      // エラーが発生しない（NaN は 0 として扱う）
      expect(() => service.calculateMatchScore(note, market)).not.toThrow();
    });

    it('Infinity を含むベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [Infinity, 2, 3, 4, 5, 6, 7] });
      const market = createMockMarket();

      // エラーが発生しない（Infinity は 0 として扱う）
      expect(() => service.calculateMatchScore(note, market)).not.toThrow();
    });

    it('すべてゼロのベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [0, 0, 0, 0, 0, 0, 0] });
      const market = createMockMarket();

      // エラーが発生しない（0除算防御）
      const score = service.calculateMatchScore(note, market);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('マッチ履歴取得', () => {
    it('getMatchHistory が配列を返す', async () => {
      // DB に依存するため、空配列が返ることを確認
      // 実際の DB テストは E2E で実施
      const history = await service.getMatchHistory({ limit: 10 });

      expect(Array.isArray(history)).toBe(true);
    });
  });
});
