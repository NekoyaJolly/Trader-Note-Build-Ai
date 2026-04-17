/**
 * CurrentAnalysisLens テスト
 *
 * カバレッジ:
 * - existingAnalysis が渡された場合の features 展開
 * - existingAnalysis がない場合の confidence=0 応答
 * - 同じ入力に対する決定性
 */

import { CurrentAnalysisLens } from '../../lenses/CurrentAnalysisLens';
import type { LensInput } from '../../lenses';
import type { MarketAnalysis } from '../../models/marketAnalysis';

function makeAnalysis(overrides: Partial<MarketAnalysis> = {}): MarketAnalysis {
  return {
    regime: 'weak_uptrend',
    direction: 'bullish',
    volatility: 'medium',
    confidence: 72,
    keyLevels: [
      { price: 2000, type: 'support', strength: 'strong', basis: 'SMA200' },
      { price: 2050, type: 'resistance', strength: 'strong', basis: '直近高値' },
      { price: 2030, type: 'resistance', strength: 'moderate', basis: 'フィボ61.8' },
    ],
    reasoning: {
      trendAnalysis: 'SMA50>SMA200 で上昇トレンド',
      momentumAnalysis: 'RSI 58 で中立寄り強気',
      volatilityAnalysis: 'ATR 平常',
      keyObservation: '2000サポートでの反発観察中',
      riskFactors: ['FOMC前の様子見'],
    },
    quickScores: {
      trendStrength: 65,
      momentum: 58,
      volatility: 50,
      supportProximity: 40,
      resistanceProximity: 70,
    },
    ...overrides,
  } as MarketAnalysis;
}

const baseInput: LensInput = {
  symbol: 'XAUUSD',
  timeframe: '15m',
  timestamp: new Date('2026-04-17T05:00:00Z'),
};

describe('CurrentAnalysisLens', () => {
  it('existingAnalysis を features に展開する', async () => {
    const lens = new CurrentAnalysisLens();
    const analysis = makeAnalysis();

    const feature = await lens.compute({ ...baseInput, existingAnalysis: analysis });

    expect(feature.lensName).toBe('current_analysis');
    expect(feature.features.regime).toBe('weak_uptrend');
    expect(feature.features.direction).toBe('bullish');
    expect(feature.features.volatility).toBe('medium');
    expect(feature.features.confidence_pct).toBe(72);
    expect(feature.features.trend_strength).toBe(65);
    expect(feature.features.momentum).toBe(58);
    expect(feature.features.key_levels_count).toBe(3);
    expect(feature.features.strong_supports).toBe(1);
    expect(feature.features.strong_resistances).toBe(1);
    expect(feature.confidence).toBeCloseTo(0.72);
  });

  it('existingAnalysis がない場合 confidence=0 / features 空で返す', async () => {
    const lens = new CurrentAnalysisLens();
    const feature = await lens.compute(baseInput);

    expect(feature.confidence).toBe(0);
    expect(feature.features).toEqual({});
    expect(feature.lensName).toBe('current_analysis');
  });

  it('同じ入力で同じ features を返す（決定性）', async () => {
    const lens = new CurrentAnalysisLens();
    const analysis = makeAnalysis();

    const f1 = await lens.compute({ ...baseInput, existingAnalysis: analysis });
    const f2 = await lens.compute({ ...baseInput, existingAnalysis: analysis });

    expect(f1.features).toEqual(f2.features);
  });

  it('strong でないキーレベルはカウントに含めない', async () => {
    const lens = new CurrentAnalysisLens();
    const analysis = makeAnalysis({
      keyLevels: [
        { price: 2000, type: 'support', strength: 'weak', basis: 'x' },
        { price: 2050, type: 'resistance', strength: 'moderate', basis: 'y' },
      ],
    });

    const feature = await lens.compute({ ...baseInput, existingAnalysis: analysis });
    expect(feature.features.strong_supports).toBe(0);
    expect(feature.features.strong_resistances).toBe(0);
  });
});
