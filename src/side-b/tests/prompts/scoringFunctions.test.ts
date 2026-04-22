/**
 * Phase 6: スコアリング関数のユニットテスト
 */

import {
  hypothesisGeneratorScoreFn,
  trendSpecialistScoreFn,
  oscillatorSpecialistScoreFn,
  volatilityVolumeSpecialistScoreFn,
  getScoringFunction,
} from '../../prompts/abtest/scoringFunctions';

describe('hypothesisGeneratorScoreFn', () => {
  it('仮説 0 件なら 0', () => {
    expect(hypothesisGeneratorScoreFn({}, { hypotheses: [] })).toBe(0);
    expect(hypothesisGeneratorScoreFn({}, {})).toBe(0);
  });

  it('3 件 + 全 reasoning + 全 conditions + 全 lensRelevance で満点に近い', () => {
    const score = hypothesisGeneratorScoreFn(
      {},
      {
        hypotheses: [
          {
            statement: 's'.repeat(30),
            reasoning: 'r'.repeat(30),
            conditions: [{}, {}],
            lensRelevance: { foo: 0.8 },
          },
          {
            statement: 's'.repeat(30),
            reasoning: 'r'.repeat(30),
            conditions: [{}, {}, {}],
            lensRelevance: { foo: 0.5 },
          },
          {
            statement: 's'.repeat(30),
            reasoning: 'r'.repeat(30),
            conditions: [{}, {}],
            lensRelevance: { bar: 0.3 },
          },
        ],
      },
    );
    expect(score).toBeCloseTo(1, 5);
  });

  it('部分欠損ではスコアが下がる', () => {
    const score = hypothesisGeneratorScoreFn(
      {},
      {
        hypotheses: [
          { statement: 's', reasoning: 'short', conditions: [{}] },
        ],
      },
    );
    // count 1/3 ≒ 0.33 -> 0.3*0.33 = 0.1、他は 0 → 約 0.1
    expect(score).toBeLessThan(0.3);
  });
});

describe('trendSpecialistScoreFn', () => {
  it('必須フィールド全揃い + 長めの interpretation + 妥当な confidence で高スコア', () => {
    const s = trendSpecialistScoreFn(
      {},
      {
        trendState: 'strong_up',
        trendStrength: 0.7,
        trendMaturity: 'middle',
        keyLevels: { support: [100], resistance: [110] },
        interpretation: 'x'.repeat(100),
        confidence: 0.6,
      },
    );
    expect(s).toBeCloseTo(1, 5);
  });

  it('confidence が範囲外だとペナルティ', () => {
    const s = trendSpecialistScoreFn(
      {},
      {
        trendState: 'up',
        trendStrength: 0.5,
        trendMaturity: 'middle',
        keyLevels: { support: [], resistance: [] },
        interpretation: 'x'.repeat(100),
        confidence: 0.99,
      },
    );
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThan(0.6);
  });

  it('空オブジェクトは低スコア', () => {
    const s = trendSpecialistScoreFn({}, {});
    expect(s).toBeLessThan(0.3);
  });
});

describe('oscillatorSpecialistScoreFn / volatilityVolumeSpecialistScoreFn', () => {
  it('それぞれ必須フィールドで満点', () => {
    const o = oscillatorSpecialistScoreFn(
      {},
      {
        momentum: 'bullish',
        divergence: 'none',
        interpretation: 'y'.repeat(100),
        confidence: 0.5,
      },
    );
    expect(o).toBeCloseTo(1, 5);

    const v = volatilityVolumeSpecialistScoreFn(
      {},
      {
        volatilityRegime: 'normal',
        breakoutRisk: 'low',
        volumeSignal: 'no_data',
        interpretation: 'z'.repeat(100),
        confidence: 0.4,
      },
    );
    expect(v).toBeCloseTo(1, 5);
  });
});

describe('getScoringFunction', () => {
  it('MVP 4 エージェント分は取得できる', () => {
    expect(getScoringFunction('hypothesis_generator')).not.toBeNull();
    expect(getScoringFunction('trend_specialist')).not.toBeNull();
    expect(getScoringFunction('oscillator_specialist')).not.toBeNull();
    expect(getScoringFunction('volatility_volume_specialist')).not.toBeNull();
  });

  it('未実装エージェントは null', () => {
    expect(getScoringFunction('strategist')).toBeNull();
    expect(getScoringFunction('devils_advocate')).toBeNull();
    expect(getScoringFunction('nonexistent')).toBeNull();
  });
});
