/**
 * Side-B Research AI サービスのテスト
 * 
 * モック戦略:
 * - AI API呼び出しをモック
 * - 正常系/エラー系の両方をテスト
 * 
 * 注意: このテストはAI APIを実際に呼び出さず、fetch をモックします。
 * AI_API_KEY が未設定でもテストは実行されます（スキップされません）。
 * 料金は一切発生しません。
 */

import { ResearchAIService, OHLCVData } from '../services/researchAIService';

// fetch をモック
global.fetch = jest.fn();

describe('ResearchAIService', () => {
  let service: ResearchAIService;

  const mockOhlcvData: OHLCVData[] = [
    { timestamp: new Date('2026-01-01T00:00:00Z'), open: 100, high: 105, low: 99, close: 103 },
    { timestamp: new Date('2026-01-01T00:15:00Z'), open: 103, high: 108, low: 102, close: 106 },
    { timestamp: new Date('2026-01-01T00:30:00Z'), open: 106, high: 110, low: 105, close: 108 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    // APIキーを設定
    process.env.AI_API_KEY = 'test-api-key';
    service = new ResearchAIService();
  });

  afterEach(() => {
    delete process.env.AI_API_KEY;
  });

  describe('generateResearch', () => {
    it('正常なAI応答を処理できる', async () => {
      // MarketAnalysis 形式のモック（analysisToLegacyFeatureVector でfeatureVectorに変換される）
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              regime: 'weak_uptrend',
              direction: 'bullish',
              volatility: 'medium',
              confidence: 75,
              quickScores: {
                trendStrength: 70,
                momentum: 65,
                volatility: 45,
                supportProximity: 30,
                resistanceProximity: 70,
              },
              reasoning: {
                trendAnalysis: 'テストトレンド分析',
                momentumAnalysis: 'テストモメンタム分析',
                volatilityAnalysis: 'テストボラティリティ分析',
                keyObservation: 'テスト観察',
                riskFactors: ['テストリスク1'],
              },
              keyLevels: [
                { price: 100, type: 'support', strength: 'strong', basis: 'テストサポート' },
                { price: 110, type: 'resistance', strength: 'moderate', basis: 'テストレジスタンス' },
              ],
            }),
          },
        }],
        usage: { total_tokens: 500 },
        model: 'gpt-4o-mini',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.generateResearch({
        symbol: 'XAUUSD',
        ohlcvData: mockOhlcvData,
      });

      // analysisToLegacyFeatureVector は quickScores.trendStrength をそのまま使う
      expect(result.output.featureVector.trendStrength).toBe(70);
      expect(result.tokenUsage).toBe(500);
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.expiresAt).toBeDefined();
      expect(result.ohlcvSnapshot).toBeDefined();
      expect(result.ohlcvSnapshot.latestPrice).toBe(108);
    });

    it('APIキーがない場合はフォールバック', async () => {
      delete process.env.AI_API_KEY;
      service = new ResearchAIService();

      const result = await service.generateResearch({
        symbol: 'XAUUSD',
        ohlcvData: mockOhlcvData,
      });

      // フォールバック結果（すべて50）
      expect(result.output.featureVector.trendStrength).toBe(50);
      expect(result.model).toBe('fallback');
      expect(result.tokenUsage).toBe(0);
    });

    it('APIエラー時はリトライしてフォールバック', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('API Error'));

      const result = await service.generateResearch({
        symbol: 'XAUUSD',
        ohlcvData: mockOhlcvData,
      });

      // 3回試行（初回+リトライ2回）後、フォールバック
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(result.model).toBe('fallback');
    });

    it('不正なJSON応答時はリトライしてフォールバック', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: '{ invalid json }',
            },
          }],
        }),
      });

      const result = await service.generateResearch({
        symbol: 'XAUUSD',
        ohlcvData: mockOhlcvData,
      });

      expect(result.model).toBe('fallback');
    });

    it('OHLCVスナップショットが正しく作成される', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              regime: 'weak_uptrend',
              direction: 'bullish',
              volatility: 'medium',
              confidence: 75,
              quickScores: {
                trendStrength: 70,
                momentum: 65,
                volatility: 45,
                supportProximity: 30,
                resistanceProximity: 70,
              },
              reasoning: {
                trendAnalysis: 'テスト',
                momentumAnalysis: 'テスト',
                volatilityAnalysis: 'テスト',
                keyObservation: 'テスト',
                riskFactors: ['テスト'],
              },
              keyLevels: [
                { price: 100, type: 'support', strength: 'strong', basis: 'テスト' },
                { price: 110, type: 'resistance', strength: 'moderate', basis: 'テスト' },
              ],
            }),
          },
        }],
        usage: { total_tokens: 500 },
        model: 'gpt-4o-mini',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.generateResearch({
        symbol: 'XAUUSD',
        ohlcvData: mockOhlcvData,
      });

      expect(result.ohlcvSnapshot.latestPrice).toBe(108);
      expect(result.ohlcvSnapshot.recentHigh).toBe(110);
      expect(result.ohlcvSnapshot.recentLow).toBe(99);
      expect(result.ohlcvSnapshot.dataPoints).toBe(3);
      expect(result.ohlcvSnapshot.recentCloses).toEqual([103, 106, 108]);
    });
  });
});
