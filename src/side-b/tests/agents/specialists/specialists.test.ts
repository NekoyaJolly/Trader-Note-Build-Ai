/**
 * Phase 6: 専門家エージェント 3 体 + runAllSpecialists のユニットテスト
 *
 * AIProvider はモック化。LLM 応答 JSON のバリデーション / 列挙外値のフォールバック /
 * 並列実行の耐障害性を検証する。
 */

import {
  TrendSpecialist,
  OscillatorSpecialist,
  VolatilityVolumeSpecialist,
  runAllSpecialists,
} from '../../../agents/specialists';
import type { SpecialistInput } from '../../../agents/specialists';
import type { AIProvider } from '../../../agent/aiProvider';
import type { LensFeatureSnapshot, LensFeature } from '../../../lenses';

function makeLensFeature(
  name: string,
  features: Record<string, number | string | boolean>,
): LensFeature {
  return {
    lensName: name,
    lensVersion: '1.0.0',
    features,
    computedAt: new Date(),
  };
}

function makeSnapshot(lenses: LensFeature[]): LensFeatureSnapshot {
  const features = new Map<string, LensFeature>();
  for (const l of lenses) features.set(l.lensName, l);
  return {
    timestamp: new Date('2026-04-22T00:00:00Z'),
    symbol: 'XAUUSD',
    features,
    totalComputeDurationMs: 10,
  };
}

function makeInput(overrides?: Partial<LensFeatureSnapshot>): SpecialistInput {
  const base = makeSnapshot([
    makeLensFeature('dow_theory', {
      trend_state: 'uptrend',
      higher_high: true,
      higher_low: true,
      phase: 'advance',
    }),
    makeLensFeature('current_analysis', {
      rsi: 62,
      macd_histogram: 0.3,
      atr: 1.2,
      bb_upper: 2455,
      bb_lower: 2410,
    }),
    makeLensFeature('volatility_regime', {
      bb_width_percentile: 0.15,
      atr_change_rate: -0.4,
      regime_label: 'contraction',
    }),
  ]);
  return {
    symbol: 'XAUUSD',
    timeframe: '15m',
    lensSnapshot: { ...base, ...overrides },
  };
}

function mockAi(response: string): AIProvider {
  return {
    chat: jest.fn(async () => ({
      content: response,
      toolCalls: [],
      tokenUsage: 10,
      model: 'mock',
      finishReason: 'stop',
    })),
  } as unknown as AIProvider;
}

describe('TrendSpecialist', () => {
  it('正規 JSON を解釈してバリデート済みの TrendAnalysis を返す', async () => {
    const ai = mockAi(
      JSON.stringify({
        trendState: 'strong_up',
        trendStrength: 0.8,
        trendMaturity: 'middle',
        keyLevels: { support: [2410.5, 2398.0], resistance: [2455.0] },
        interpretation: 'dow_theory higher_high/higher_low と current_analysis MA の並びからの判定',
        confidence: 0.75,
      }),
    );
    const s = new TrendSpecialist(ai);
    const r = await s.analyze(makeInput());
    expect(r).not.toBeNull();
    expect(r!.trendState).toBe('strong_up');
    expect(r!.trendStrength).toBeCloseTo(0.8);
    expect(r!.keyLevels.support).toEqual([2410.5, 2398.0]);
    expect(r!.keyLevels.resistance).toEqual([2455.0]);
  });

  it('列挙外の trendState は ranging にフォールバック', async () => {
    const ai = mockAi(
      JSON.stringify({
        trendState: 'magical_up', // invalid
        trendStrength: 5.0, // out of range
        trendMaturity: 'unknown', // invalid
        keyLevels: { support: 'oops', resistance: [2455, 'bad'] },
        interpretation: '...',
        confidence: 'nope',
      }),
    );
    const s = new TrendSpecialist(ai);
    const r = await s.analyze(makeInput());
    expect(r!.trendState).toBe('ranging');
    expect(r!.trendStrength).toBe(1); // clamped
    expect(r!.trendMaturity).toBe('middle');
    expect(r!.keyLevels.support).toEqual([]);
    expect(r!.keyLevels.resistance).toEqual([2455]);
    expect(r!.confidence).toBeCloseTo(0.3);
  });

  it('JSON パース不能応答は null を返す', async () => {
    const ai = mockAi('this is not json at all');
    const s = new TrendSpecialist(ai);
    const r = await s.analyze(makeInput());
    expect(r).toBeNull();
  });

  it('Markdown コードフェンス付きでも解釈できる', async () => {
    const ai = mockAi(
      '```json\n' +
        JSON.stringify({
          trendState: 'weak_down',
          trendStrength: 0.3,
          trendMaturity: 'early',
          keyLevels: { support: [], resistance: [] },
          interpretation: 'ok',
          confidence: 0.4,
        }) +
        '\n```',
    );
    const s = new TrendSpecialist(ai);
    const r = await s.analyze(makeInput());
    expect(r!.trendState).toBe('weak_down');
  });
});

describe('OscillatorSpecialist', () => {
  it('正規 JSON を解釈する', async () => {
    const ai = mockAi(
      JSON.stringify({
        momentum: 'bullish',
        divergence: 'none',
        interpretation: 'RSI 62',
        confidence: 0.7,
      }),
    );
    const s = new OscillatorSpecialist(ai);
    const r = await s.analyze(makeInput());
    expect(r!.momentum).toBe('bullish');
    expect(r!.divergence).toBe('none');
  });

  it('列挙外は neutral/none にフォールバック', async () => {
    const ai = mockAi(
      JSON.stringify({
        momentum: 'cosmic',
        divergence: 'quantum',
        interpretation: '',
        confidence: -1,
      }),
    );
    const s = new OscillatorSpecialist(ai);
    const r = await s.analyze(makeInput());
    expect(r!.momentum).toBe('neutral');
    expect(r!.divergence).toBe('none');
    expect(r!.confidence).toBe(0);
  });
});

describe('VolatilityVolumeSpecialist', () => {
  it('FX ボリューム欠損なら no_data が返る', async () => {
    const ai = mockAi(
      JSON.stringify({
        volatilityRegime: 'contraction',
        breakoutRisk: 'high',
        volumeSignal: 'no_data',
        interpretation: 'BB 幅が狭い',
        confidence: 0.65,
      }),
    );
    const s = new VolatilityVolumeSpecialist(ai);
    const r = await s.analyze(makeInput());
    expect(r!.volatilityRegime).toBe('contraction');
    expect(r!.volumeSignal).toBe('no_data');
  });

  it('列挙外は normal/medium/no_data にフォールバック', async () => {
    const ai = mockAi(
      JSON.stringify({
        volatilityRegime: 'singularity',
        breakoutRisk: 'cosmic',
        volumeSignal: 'alien',
        interpretation: 'x',
        confidence: 0.5,
      }),
    );
    const s = new VolatilityVolumeSpecialist(ai);
    const r = await s.analyze(makeInput());
    expect(r!.volatilityRegime).toBe('normal');
    expect(r!.breakoutRisk).toBe('medium');
    expect(r!.volumeSignal).toBe('no_data');
  });
});

describe('runAllSpecialists', () => {
  it('3 専門家を並列実行し全てが結果を返す', async () => {
    const trend = new TrendSpecialist(
      mockAi(
        JSON.stringify({
          trendState: 'strong_up',
          trendStrength: 0.8,
          trendMaturity: 'middle',
          keyLevels: { support: [100], resistance: [110] },
          interpretation: 't',
          confidence: 0.7,
        }),
      ),
    );
    const osc = new OscillatorSpecialist(
      mockAi(
        JSON.stringify({
          momentum: 'bullish',
          divergence: 'none',
          interpretation: 'o',
          confidence: 0.6,
        }),
      ),
    );
    const vol = new VolatilityVolumeSpecialist(
      mockAi(
        JSON.stringify({
          volatilityRegime: 'normal',
          breakoutRisk: 'low',
          volumeSignal: 'no_data',
          interpretation: 'v',
          confidence: 0.5,
        }),
      ),
    );
    const bundle = await runAllSpecialists(makeInput(), {
      trend,
      oscillator: osc,
      volatilityVolume: vol,
    });
    expect(bundle.trend?.trendState).toBe('strong_up');
    expect(bundle.oscillator?.momentum).toBe('bullish');
    expect(bundle.volatilityVolume?.volatilityRegime).toBe('normal');
  });

  it('1 専門家が LLM パース不能でも他は完走する', async () => {
    const trend = new TrendSpecialist(mockAi('broken response'));
    const osc = new OscillatorSpecialist(
      mockAi(
        JSON.stringify({
          momentum: 'bearish',
          divergence: 'bearish_divergence',
          interpretation: 'x',
          confidence: 0.5,
        }),
      ),
    );
    const vol = new VolatilityVolumeSpecialist(
      mockAi(
        JSON.stringify({
          volatilityRegime: 'expansion',
          breakoutRisk: 'low',
          volumeSignal: 'no_data',
          interpretation: 'y',
          confidence: 0.55,
        }),
      ),
    );
    const bundle = await runAllSpecialists(makeInput(), {
      trend,
      oscillator: osc,
      volatilityVolume: vol,
    });
    expect(bundle.trend).toBeNull();
    expect(bundle.oscillator?.momentum).toBe('bearish');
    expect(bundle.volatilityVolume?.volatilityRegime).toBe('expansion');
  });
});
