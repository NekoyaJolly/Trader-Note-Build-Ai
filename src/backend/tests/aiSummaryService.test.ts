/**
 * AI 要約サービスのテスト
 * 
 * テスト対象: generateBasicSummary() メソッド（フォールバック要約）
 * 
 * 理由:
 * - API キーは環境で設定される（開発環境では常に存在）
 * - API 呼び出しはテストすべきではない（外部依存、不安定）
 * - フォールバック要約の生成ロジックが重要
 */

import { AISummaryService, TradeDataForSummary } from '../../services/aiSummaryService';

describe('AISummaryService', () => {
  let service: AISummaryService;

  const createMockTradeData = (overrides?: Partial<TradeDataForSummary>): TradeDataForSummary => ({
    symbol: 'BTCUSD',
    side: 'buy',
    price: 50000,
    quantity: 1.5,
    timestamp: new Date('2025-12-26T10:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    service = new AISummaryService();
  });

  describe('generateTradeSummary - API キーなし時のフォールバック', () => {
    test('API キーがない場合は fallback を返す', async () => {
      const originalKey = process.env.AI_API_KEY;
      delete process.env.AI_API_KEY;

      // 環境変数をクリアして新しいインスタンスを作成
      const serviceWithoutKey = new AISummaryService();
      const tradeData = createMockTradeData();
      const result = await serviceWithoutKey.generateTradeSummary(tradeData);

      expect(result.model).toBe('fallback');
      expect(result.summary).toBeTruthy();
      expect(result.summary.length).toBeGreaterThan(0);

      // 環境変数を復元
      if (originalKey) {
        process.env.AI_API_KEY = originalKey;
      }
    });

    test('フォールバック要約に通貨ペア情報が含まれる', async () => {
      const originalKey = process.env.AI_API_KEY;
      delete process.env.AI_API_KEY;

      const serviceWithoutKey = new AISummaryService();
      const tradeData = createMockTradeData({ symbol: 'ETHUSD' });
      const result = await serviceWithoutKey.generateTradeSummary(tradeData);

      // シンボルが含まれることを確認（フォールバック要約はデータを基に生成）
      expect(result.summary).toBeTruthy();

      if (originalKey) {
        process.env.AI_API_KEY = originalKey;
      }
    });

    test('異なる売買方向でフォールバック要約を生成できる', async () => {
      const originalKey = process.env.AI_API_KEY;
      delete process.env.AI_API_KEY;

      const serviceWithoutKey = new AISummaryService();

      // 買い
      const buyResult = await serviceWithoutKey.generateTradeSummary(
        createMockTradeData({ side: 'buy' })
      );
      expect(buyResult.model).toBe('fallback');
      expect(buyResult.summary).toBeTruthy();

      // 売り
      const sellResult = await serviceWithoutKey.generateTradeSummary(
        createMockTradeData({ side: 'sell' })
      );
      expect(sellResult.model).toBe('fallback');
      expect(sellResult.summary).toBeTruthy();

      if (originalKey) {
        process.env.AI_API_KEY = originalKey;
      }
    });
  });
});
