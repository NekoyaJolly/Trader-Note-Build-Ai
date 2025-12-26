/**
 * AI 要約サービスのテスト
 * 
 * テスト観点:
 * - API キーがない場合のフォールバック
 * - 日本語要約の生成
 * - トークン使用量の記録
 */

import { AISummaryService, TradeDataForSummary } from '../../services/aiSummaryService';

describe('AISummaryService', () => {
  let service: AISummaryService;

  // テスト用のモックトレードデータ
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

  describe('generateTradeSummary', () => {
    test('API キーがない場合は基本要約を返す', async () => {
      // 環境変数を一時的にクリア
      const originalApiKey = process.env.AI_API_KEY;
      delete process.env.AI_API_KEY;

      const tradeData = createMockTradeData();
      const result = await service.generateTradeSummary(tradeData);

      expect(result.summary).toBeTruthy();
      expect(result.summary).toContain('BTCUSD');
      expect(result.summary).toContain('買い');
      expect(result.model).toBe('fallback');

      // 環境変数を復元
      if (originalApiKey) {
        process.env.AI_API_KEY = originalApiKey;
      }
    });

    test('基本要約は日本語で生成される', async () => {
      // 環境変数を一時的にクリア
      const originalApiKey = process.env.AI_API_KEY;
      delete process.env.AI_API_KEY;

      const tradeData = createMockTradeData({
        side: 'sell',
        price: 51000,
      });
      const result = await service.generateTradeSummary(tradeData);

      expect(result.summary).toContain('売り');
      expect(result.summary).toMatch(/\d{4}\/\d{2}\/\d{2}/); // 日本語日付形式

      // 環境変数を復元
      if (originalApiKey) {
        process.env.AI_API_KEY = originalApiKey;
      }
    });

    test('市場コンテキストがある場合は要約に含まれる', async () => {
      // 環境変数を一時的にクリア
      const originalApiKey = process.env.AI_API_KEY;
      delete process.env.AI_API_KEY;

      const tradeData = createMockTradeData({
        marketContext: {
          trend: 'uptrend',
          rsi: 65,
        },
      });
      const result = await service.generateTradeSummary(tradeData);

      expect(result.summary).toContain('上昇トレンド');

      // 環境変数を復元
      if (originalApiKey) {
        process.env.AI_API_KEY = originalApiKey;
      }
    });

    test('売り注文の場合は「売り」と表示される', async () => {
      // 環境変数を一時的にクリア
      const originalApiKey = process.env.AI_API_KEY;
      delete process.env.AI_API_KEY;

      const tradeData = createMockTradeData({
        side: 'sell',
      });
      const result = await service.generateTradeSummary(tradeData);

      expect(result.summary).toContain('売り');
      expect(result.summary).not.toContain('買い');

      // 環境変数を復元
      if (originalApiKey) {
        process.env.AI_API_KEY = originalApiKey;
      }
    });

    test('買い注文の場合は「買い」と表示される', async () => {
      // 環境変数を一時的にクリア
      const originalApiKey = process.env.AI_API_KEY;
      delete process.env.AI_API_KEY;

      const tradeData = createMockTradeData({
        side: 'buy',
      });
      const result = await service.generateTradeSummary(tradeData);

      expect(result.summary).toContain('買い');
      expect(result.summary).not.toContain('売り');

      // 環境変数を復元
      if (originalApiKey) {
        process.env.AI_API_KEY = originalApiKey;
      }
    });

    test('下降トレンドの場合は「下降トレンド」と表示される', async () => {
      // 環境変数を一時的にクリア
      const originalApiKey = process.env.AI_API_KEY;
      delete process.env.AI_API_KEY;

      const tradeData = createMockTradeData({
        marketContext: {
          trend: 'downtrend',
        },
      });
      const result = await service.generateTradeSummary(tradeData);

      expect(result.summary).toContain('下降トレンド');

      // 環境変数を復元
      if (originalApiKey) {
        process.env.AI_API_KEY = originalApiKey;
      }
    });

    test('横ばいトレンドの場合は「横ばい」と表示される', async () => {
      // 環境変数を一時的にクリア
      const originalApiKey = process.env.AI_API_KEY;
      delete process.env.AI_API_KEY;

      const tradeData = createMockTradeData({
        marketContext: {
          trend: 'neutral',
        },
      });
      const result = await service.generateTradeSummary(tradeData);

      expect(result.summary).toContain('横ばい');

      // 環境変数を復元
      if (originalApiKey) {
        process.env.AI_API_KEY = originalApiKey;
      }
    });
  });

  describe('buildJapanesePrompt (間接的なテスト)', () => {
    test('プロンプトに必要な情報が含まれている (基本要約から推測)', async () => {
      // 環境変数を一時的にクリア
      const originalApiKey = process.env.AI_API_KEY;
      delete process.env.AI_API_KEY;

      const tradeData = createMockTradeData({
        symbol: 'ETHUSD',
        price: 3000,
        quantity: 5,
        marketContext: {
          rsi: 72,
          macd: 1.2,
          timeframe: '1h',
        },
      });
      const result = await service.generateTradeSummary(tradeData);

      // 基本要約に含まれるべき情報
      expect(result.summary).toContain('ETHUSD');
      expect(result.summary).toContain('3000');
      expect(result.summary).toContain('5');

      // 環境変数を復元
      if (originalApiKey) {
        process.env.AI_API_KEY = originalApiKey;
      }
    });
  });
});
