/**
 * MatchingService テスト
 * 
 * 目的:
 * - NoteEvaluator 経由のマッチング動作検証
 * - 次元不一致・NaN・0除算の防御テスト
 * - マッチ結果 DB 永続化のテスト
 * 
 * 設計（Task 6）:
 * - Service は NoteEvaluator.evaluate() を呼ぶだけ
 * - similarity を直接計算しない
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MatchingService } from '../../services/matchingService';
import { TradeNote, MarketData } from '../../models/types';
import { 
  createNoteEvaluatorFromFSNote, 
  convertMarketDataToSnapshot 
} from '../../services/legacyNoteEvaluatorAdapter';

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

  /**
   * ヘルパー関数: NoteEvaluator 経由でスコアを計算
   * 
   * Task 6 設計: Service は similarity を直接計算しない
   * テストでも NoteEvaluator を使用する
   */
  const evaluateMatchViaEvaluator = (note: TradeNote, market: MarketData): number => {
    const evaluator = createNoteEvaluatorFromFSNote(note);
    const snapshot = convertMarketDataToSnapshot(market);
    const result = evaluator.evaluate(snapshot);
    return result.similarity;
  };

  describe('NoteEvaluator 経由のマッチスコア計算', () => {
    it('同一条件で類似度が計算される', () => {
      const note = createMockNote();
      const market = createMockMarket();

      const similarity = evaluateMatchViaEvaluator(note, market);

      // 類似度が 0-1 の範囲内
      expect(similarity).toBeGreaterThanOrEqual(0);
      expect(similarity).toBeLessThanOrEqual(1);
    });

    it('トレンド不一致でも類似度は計算される', () => {
      const note = createMockNote({ marketContext: { timeframe: '15m', trend: 'bullish' } });
      const market = createMockMarket({ indicators: { rsi: 30, macd: -10, trend: 'bearish' } });

      const similarity = evaluateMatchViaEvaluator(note, market);

      // 類似度が 0-1 の範囲内
      expect(similarity).toBeGreaterThanOrEqual(0);
      expect(similarity).toBeLessThanOrEqual(1);
    });

    it('価格レンジ外でも類似度は計算される', () => {
      const note = createMockNote({ entryPrice: 50000 });
      const market = createMockMarket({ close: 60000 }); // 20% 乖離

      const similarity = evaluateMatchViaEvaluator(note, market);

      // 類似度が 0-1 の範囲内
      expect(similarity).toBeGreaterThanOrEqual(0);
      expect(similarity).toBeLessThanOrEqual(1);
    });
  });

  describe('NoteEvaluator（エッジケース）', () => {
    it('空のベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [] });
      const market = createMockMarket();

      // エラーが発生しない
      expect(() => evaluateMatchViaEvaluator(note, market)).not.toThrow();
    });

    it('次元が異なるベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [1, 2, 3] });
      const market = createMockMarket();

      // エラーが発生しない
      expect(() => evaluateMatchViaEvaluator(note, market)).not.toThrow();
    });

    it('NaN を含むベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [NaN, 2, 3, 4, 5, 6, 7] });
      const market = createMockMarket();

      // エラーが発生しない
      expect(() => evaluateMatchViaEvaluator(note, market)).not.toThrow();
    });

    it('Infinity を含むベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [Infinity, 2, 3, 4, 5, 6, 7] });
      const market = createMockMarket();

      // エラーが発生しない
      expect(() => evaluateMatchViaEvaluator(note, market)).not.toThrow();
    });

    it('すべてゼロのベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [0, 0, 0, 0, 0, 0, 0] });
      const market = createMockMarket();

      // エラーが発生しない（0除算防御）
      const similarity = evaluateMatchViaEvaluator(note, market);
      expect(similarity).toBeLessThanOrEqual(1);
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
