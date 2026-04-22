/**
 * Phase 6: HypothesisGeneratorAgent の specialistAnalyses 拡張テスト
 *
 * - specialistAnalyses 未指定でも動く(後方互換)
 * - specialistAnalyses 指定時は プロンプトに 下位専門家の分析セクションが注入される
 * - null フィールドは省略される
 */

import { HypothesisGeneratorAgent } from '../../agents/HypothesisGeneratorAgent';
import type { LensFeatureSnapshot, LensFeature } from '../../lenses';

global.fetch = jest.fn();

function makeSnapshot(): LensFeatureSnapshot {
  const features = new Map<string, LensFeature>();
  features.set('dow_theory', {
    lensName: 'dow_theory',
    lensVersion: '1.0.0',
    features: { trend_state: 'uptrend' },
    computedAt: new Date(),
  });
  features.set('volatility_regime', {
    lensName: 'volatility_regime',
    lensVersion: '1.0.0',
    features: { bb_width_percentile: 25 },
    computedAt: new Date(),
  });
  return {
    timestamp: new Date(),
    symbol: 'XAUUSD',
    features,
    totalComputeDurationMs: 2,
  };
}

function validOutput() {
  return {
    hypotheses: [
      {
        statement: '上昇初期でボラ圧縮時、押し目買いが有効である',
        category: 'structure',
        expectedDirection: 'long',
        reasoning: '低ボラ蓄積後のトレンド初期は継続しやすい',
        conditions: [
          { lensName: 'dow_theory', featureKey: 'trend_state', op: '==', value: 'uptrend' },
          { lensName: 'volatility_regime', featureKey: 'bb_width_percentile', op: '<', value: 30 },
        ],
      },
    ],
    noveltyClaim: 'test',
  };
}

function captureFetchBody(): { lastBody: any } {
  const captured: { lastBody: any } = { lastBody: null };
  (global.fetch as jest.Mock).mockImplementation((_url: string, init?: any) => {
    captured.lastBody = JSON.parse(init.body);
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: JSON.stringify(validOutput()) } }],
          usage: { total_tokens: 300 },
          model: 'mock',
        }),
    });
  });
  return captured;
}

describe('HypothesisGeneratorAgent specialistAnalyses', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  it('specialistAnalyses 未指定のとき、ユーザープロンプトに "下位専門家" セクションが含まれない(後方互換)', async () => {
    const captured = captureFetchBody();
    const agent = new HypothesisGeneratorAgent({ apiKey: 'test-key' });
    await agent.generate({
      symbol: 'XAUUSD',
      timeframe: '15m',
      lensSnapshot: makeSnapshot(),
      existingHypotheses: [],
    });
    const userMsg = captured.lastBody.messages.find((m: any) => m.role === 'user').content;
    expect(userMsg).not.toContain('下位専門家の分析');
    expect(userMsg).toContain('現在のレンズスナップショット');
  });

  it('specialistAnalyses 指定時は ユーザープロンプトに 下位専門家セクションが含まれる', async () => {
    const captured = captureFetchBody();
    const agent = new HypothesisGeneratorAgent({ apiKey: 'test-key' });
    await agent.generate({
      symbol: 'XAUUSD',
      timeframe: '15m',
      lensSnapshot: makeSnapshot(),
      existingHypotheses: [],
      specialistAnalyses: {
        trend: { trendState: 'strong_up', confidence: 0.7 },
        oscillator: { momentum: 'bullish', confidence: 0.6 },
        volatilityVolume: { volatilityRegime: 'contraction', confidence: 0.5 },
      },
    });
    const userMsg = captured.lastBody.messages.find((m: any) => m.role === 'user').content;
    expect(userMsg).toContain('下位専門家の分析');
    expect(userMsg).toContain('Trend Specialist');
    expect(userMsg).toContain('strong_up');
    expect(userMsg).toContain('Oscillator Specialist');
    expect(userMsg).toContain('bullish');
    expect(userMsg).toContain('Volatility/Volume Specialist');
    expect(userMsg).toContain('contraction');
  });

  it('null フィールドはセクションから省略される', async () => {
    const captured = captureFetchBody();
    const agent = new HypothesisGeneratorAgent({ apiKey: 'test-key' });
    await agent.generate({
      symbol: 'XAUUSD',
      timeframe: '15m',
      lensSnapshot: makeSnapshot(),
      existingHypotheses: [],
      specialistAnalyses: {
        trend: { trendState: 'ranging' },
        oscillator: undefined,
        volatilityVolume: undefined,
      },
    });
    const userMsg = captured.lastBody.messages.find((m: any) => m.role === 'user').content;
    expect(userMsg).toContain('Trend Specialist');
    expect(userMsg).not.toContain('Oscillator Specialist');
    expect(userMsg).not.toContain('Volatility/Volume Specialist');
  });

  it('specialistAnalyses が空オブジェクトでもセクションは出ない', async () => {
    const captured = captureFetchBody();
    const agent = new HypothesisGeneratorAgent({ apiKey: 'test-key' });
    await agent.generate({
      symbol: 'XAUUSD',
      timeframe: '15m',
      lensSnapshot: makeSnapshot(),
      existingHypotheses: [],
      specialistAnalyses: {},
    });
    const userMsg = captured.lastBody.messages.find((m: any) => m.role === 'user').content;
    expect(userMsg).not.toContain('下位専門家の分析');
  });
});
