/**
 * Side-B Plan AI サービスのテスト
 * 
 * モック戦略:
 * - AI API呼び出しをモック
 * - FeatureVector + OHLCVSnapshot からの解釈テスト
 */

import { PlanAIService, PlanAIInput } from '../services/planAIService';
import { FeatureVector12D } from '../models/featureVector';
import { OHLCVSnapshot } from '../models/marketResearch';
import { MarketResearchWithTypes } from '../repositories';

// fetch をモック
global.fetch = jest.fn();

describe('PlanAIService', () => {
  let service: PlanAIService;

  const mockFeatureVector: FeatureVector12D = {
    trendStrength: 75,
    trendDirection: 85,  // 上昇トレンド
    maAlignment: 70,
    pricePosition: 60,
    rsiLevel: 55,
    macdMomentum: 65,
    momentumDivergence: 20,
    volatilityLevel: 40,
    bbWidth: 35,
    volatilityTrend: 50,
    supportProximity: 25,
    resistanceProximity: 75,
  };

  const mockOhlcvSnapshot: OHLCVSnapshot = {
    latestPrice: 2650.50,
    recentHigh: 2680.00,
    recentLow: 2620.00,
    recentCloses: [2640, 2645, 2650.50],
    dataPoints: 100,
  };

  // MarketResearchWithTypes のモックデータ
  const mockResearch: MarketResearchWithTypes = {
    id: 'test-research-id',
    symbol: 'XAUUSD',
    timeframe: '15m',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    featureVector: mockFeatureVector,
    ohlcvSnapshot: mockOhlcvSnapshot,
    aiModel: 'gpt-4o-mini',
    tokenUsage: 500,
  };

  /**
   * 正しいPlanAIOutput形式のモックデータを生成
   */
  function createMockPlanAIOutput(overrides: Record<string, unknown> = {}) {
    return {
      marketAnalysis: {
        regime: 'uptrend',
        regimeConfidence: 80,
        trendDirection: 'up',
        volatility: 'low',
        keyLevels: {
          strongResistance: [2700],
          resistance: [2680],
          support: [2620],
          strongSupport: [2600],
        },
        summary: '上昇トレンドが継続中。',
        additionalInsights: [],
        ...(overrides.marketAnalysis as Record<string, unknown> || {}),
      },
      scenarios: overrides.scenarios || [
        {
          name: '上昇継続シナリオ',
          direction: 'long',
          priority: 'primary',
          entry: {
            type: 'limit',
            price: 2640,
            condition: '押し目での買い',
            triggerIndicators: ['RSI', 'MACD'],
          },
          stopLoss: {
            price: 2615,
            pips: 25,
            reason: 'サポート割れ',
          },
          takeProfit: {
            price: 2680,
            pips: 40,
            reason: 'レジスタンス到達',
          },
          riskReward: 1.6,
          confidence: 70,
          rationale: 'サポートからの反発を狙う',
          invalidationConditions: ['2615割れ'],
        },
      ],
      overallConfidence: overrides.overallConfidence ?? 70,
      warnings: overrides.warnings || ['重要指標発表に注意'],
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_API_KEY = 'test-api-key';
    service = new PlanAIService();
  });

  afterEach(() => {
    delete process.env.AI_API_KEY;
  });

  describe('generatePlan', () => {
    it('正常なAI応答からプランを生成できる', async () => {
      const mockOutput = createMockPlanAIOutput();
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify(mockOutput),
          },
        }],
        usage: { total_tokens: 1800 },
        model: 'gpt-4o',
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const input: PlanAIInput = {
        research: mockResearch,
        targetDate: '2026-01-05',
        userPreferences: {
          tradingStyle: 'swing',
        },
      };

      const result = await service.generatePlan(input);

      expect(result.output.marketAnalysis.regime).toBe('uptrend');
      expect(result.output.marketAnalysis.keyLevels?.support).toContain(2620);
      expect(result.output.scenarios).toHaveLength(1);
      expect(result.output.scenarios[0].direction).toBe('long');
      expect(result.tokenUsage).toBe(1800);
    });

    it('APIキーがない場合はフォールバック', async () => {
      delete process.env.AI_API_KEY;
      service = new PlanAIService();

      const input: PlanAIInput = {
        research: mockResearch,
        targetDate: '2026-01-05',
      };

      const result = await service.generatePlan(input);

      expect(result.model).toBe('fallback');
      expect(result.tokenUsage).toBe(0);
      expect(result.output.marketAnalysis.regime).toBe('range');
      expect(result.output.scenarios).toHaveLength(0);
    });

    it('APIエラー時はリトライしてフォールバック', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('API Error'));

      const input: PlanAIInput = {
        research: mockResearch,
        targetDate: '2026-01-05',
      };

      const result = await service.generatePlan(input);

      // 初回 + 2回リトライ = 3回
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(result.model).toBe('fallback');
    });

    it('上昇トレンドの判定が正しい', async () => {
      const mockOutput = createMockPlanAIOutput({
        marketAnalysis: {
          regime: 'uptrend',
          regimeConfidence: 85,
          trendDirection: 'up',
          volatility: 'low',
          keyLevels: {
            strongResistance: [],
            resistance: [2680],
            support: [2620],
            strongSupport: [],
          },
          summary: '強い上昇トレンド',
          additionalInsights: [],
        },
        overallConfidence: 85,
      });

      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify(mockOutput),
          },
        }],
        usage: { total_tokens: 1500 },
        model: 'gpt-4o',
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const input: PlanAIInput = {
        research: mockResearch,
        targetDate: '2026-01-05',
      };

      const result = await service.generatePlan(input);

      expect(result.output.marketAnalysis.trendDirection).toBe('up');
      expect(result.output.scenarios[0].direction).toBe('long');
    });

    it('レンジ相場の判定が正しい', async () => {
      const rangingResearch: MarketResearchWithTypes = {
        ...mockResearch,
        featureVector: {
          ...mockFeatureVector,
          trendStrength: 25,
          trendDirection: 50,
        },
      };

      const mockOutput = createMockPlanAIOutput({
        marketAnalysis: {
          regime: 'range',
          regimeConfidence: 75,
          trendDirection: 'sideways',
          volatility: 'medium',
          keyLevels: {
            strongResistance: [],
            resistance: [2680],
            support: [2620],
            strongSupport: [],
          },
          summary: 'レンジ相場が継続中',
          additionalInsights: [],
        },
        warnings: ['ブレイクアウトに警戒'],
        overallConfidence: 60,
      });

      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify(mockOutput),
          },
        }],
        usage: { total_tokens: 1600 },
        model: 'gpt-4o',
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const input: PlanAIInput = {
        research: rangingResearch,
        targetDate: '2026-01-05',
      };

      const result = await service.generatePlan(input);

      expect(result.output.marketAnalysis.regime).toBe('range');
      expect(result.output.warnings).toContain('ブレイクアウトに警戒');
    });
  });
});
