/**
 * Phase 6: PlanAIService (StrategyThinker) の specialistAnalyses 拡張テスト
 *
 * fetch をモックし、生成されたユーザープロンプトに
 * 下位専門家セクションが正しく注入されるか検証する。
 */

import { PlanAIService, PlanAIInput } from '../services/planAIService';
import type { FeatureVector12D } from '../models/featureVector';
import type { MarketResearchWithTypes } from '../repositories';

global.fetch = jest.fn();

const baseFv: FeatureVector12D = {
  trendStrength: 60,
  trendDirection: 80,
  maAlignment: 60,
  pricePosition: 50,
  rsiLevel: 55,
  macdMomentum: 55,
  momentumDivergence: 20,
  volatilityLevel: 40,
  bbWidth: 35,
  volatilityTrend: 50,
  supportProximity: 25,
  resistanceProximity: 65,
};

function makeResearch(): MarketResearchWithTypes {
  return {
    id: 'test-r',
    symbol: 'XAUUSD',
    timeframe: '15m',
    researchDate: '2026-04-22',
    featureVector: baseFv,
    marketAnalysis: undefined as any, // 旧形式フォールバック経路を使う
    ohlcvSnapshot: {
      latestPrice: 2650,
      recentHigh: 2680,
      recentLow: 2620,
      recentCloses: [2640, 2645, 2650],
      dataPoints: 100,
    },
    summary: 'test summary',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as MarketResearchWithTypes;
}

function captureFetchBody() {
  const captured: { lastBody: any } = { lastBody: null };
  (global.fetch as jest.Mock).mockImplementation((_url: string, init?: any) => {
    captured.lastBody = JSON.parse(init.body);
    // 最小限の応答スキーマ(validatePlanAIOutput を通るには大量の項目が必要だが、
    // 本テストはプロンプト注入だけを確認するため失敗応答で OK)
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '{}' } }],
          usage: { total_tokens: 100 },
          model: 'mock',
        }),
    });
  });
  return captured;
}

function getUserPrompt(captured: { lastBody: any }): string {
  return captured.lastBody.messages.find((m: any) => m.role === 'user').content;
}

describe('PlanAIService buildSpecialistContext', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
    process.env.AI_API_KEY = 'test-key';
  });

  it('specialistAnalyses 未指定なら 下位専門家セクションは出ない(後方互換)', async () => {
    const captured = captureFetchBody();
    const service = new PlanAIService();
    const input: PlanAIInput = {
      research: makeResearch(),
      targetDate: '2026-04-22',
    };
    await service.generatePlan(input);
    const userMsg = getUserPrompt(captured);
    expect(userMsg).not.toContain('下位専門家の分析');
  });

  it('specialistAnalyses 指定時は プロンプトに 下位専門家セクションが含まれる', async () => {
    const captured = captureFetchBody();
    const service = new PlanAIService();
    const input: PlanAIInput = {
      research: makeResearch(),
      targetDate: '2026-04-22',
      specialistAnalyses: {
        trend: { trendState: 'strong_up', confidence: 0.8, interpretation: 't' },
        oscillator: { momentum: 'bullish', confidence: 0.6, interpretation: 'o' },
        volatilityVolume: { volatilityRegime: 'contraction', confidence: 0.5 },
      },
    };
    await service.generatePlan(input);
    const userMsg = getUserPrompt(captured);
    expect(userMsg).toContain('下位専門家の分析(統合して戦略化)');
    expect(userMsg).toContain('Trend Specialist');
    expect(userMsg).toContain('strong_up');
    expect(userMsg).toContain('Oscillator Specialist');
    expect(userMsg).toContain('Volatility/Volume Specialist');
  });

  it('一部 null のとき、null 専門家だけ省略される', async () => {
    const captured = captureFetchBody();
    const service = new PlanAIService();
    const input: PlanAIInput = {
      research: makeResearch(),
      targetDate: '2026-04-22',
      specialistAnalyses: {
        trend: { trendState: 'weak_up' },
        oscillator: undefined,
        volatilityVolume: { volatilityRegime: 'normal' },
      },
    };
    await service.generatePlan(input);
    const userMsg = getUserPrompt(captured);
    expect(userMsg).toContain('Trend Specialist');
    expect(userMsg).not.toContain('Oscillator Specialist');
    expect(userMsg).toContain('Volatility/Volume Specialist');
  });
});
