/**
 * Phase 6: スコアリング関数のユニットテスト
 */

import {
  hypothesisGeneratorScoreFn,
  indicatorSpecialistScoreFn,
  discoveryScoreFn,
  mutationScoreFn,
  crossoverScoreFn,
  bullBearDebateScoreFn,
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

describe('indicatorSpecialistScoreFn (Phase 6.8 統合 = 旧 trend/oscillator/volatility_volume)', () => {
  it('必須フィールド (interpretation/confidence/current/higher/mtfAlignment/primaryIndicators) 全揃いで高スコア', () => {
    const s = indicatorSpecialistScoreFn(
      {},
      {
        interpretation: 'x'.repeat(100),
        confidence: 0.6,
        current: { trendState: 'strong_up' },
        higher: { trendState: 'weak_up' },
        mtfAlignment: { trendAlignment: 'aligned_bullish' },
        primaryIndicators: { current: ['rsi'], higher: ['ichimoku'] },
      },
    );
    expect(s).toBeCloseTo(1, 5);
  });

  it('confidence が範囲外だとペナルティ', () => {
    const s = indicatorSpecialistScoreFn(
      {},
      {
        interpretation: 'x'.repeat(100),
        confidence: 0.99,
        current: {},
        higher: {},
        mtfAlignment: {},
        primaryIndicators: {},
      },
    );
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThan(0.6);
  });

  it('空オブジェクトは低スコア', () => {
    const s = indicatorSpecialistScoreFn({}, {});
    expect(s).toBeLessThan(0.3);
  });
});

describe('getScoringFunction', () => {
  it('Step D-1 で strategist 廃止後の 6 エージェント分は取得できる', () => {
    expect(getScoringFunction('hypothesis_generator')).not.toBeNull();
    expect(getScoringFunction('indicator_specialist')).not.toBeNull();
    expect(getScoringFunction('discovery')).not.toBeNull();
    expect(getScoringFunction('mutation')).not.toBeNull();
    expect(getScoringFunction('crossover')).not.toBeNull();
    expect(getScoringFunction('bull_bear_debate')).not.toBeNull();
  });

  it('廃止した strategist は null を返す', () => {
    expect(getScoringFunction('strategist')).toBeNull();
  });

  it('未実装エージェントは null', () => {
    expect(getScoringFunction('nonexistent')).toBeNull();
    expect(getScoringFunction('')).toBeNull();
  });
});

// ============================================================
// Critical-3 残スコープ: 死蔵エージェントのスコア関数テスト
// (strategist は Step D-1 で廃止)
// ============================================================

describe('discoveryScoreFn', () => {
  it('全フィールド充実で満点', () => {
    const s = discoveryScoreFn(
      {},
      {
        interpretations: [
          { interpretation: 'i'.repeat(40) },
          { interpretation: 'i'.repeat(40) },
          { interpretation: 'i'.repeat(40) },
        ],
        newHypotheses: [
          { statement: 's', reasoning: 'r'.repeat(30), conditions: [{}] },
          { statement: 's', reasoning: 'r'.repeat(30), conditions: [{}] },
        ],
        hintsForHG: [
          { promisingDirection: 'up', lensFocusAreas: ['trend'], rationale: 'r' },
        ],
        weeklyNote: 'n'.repeat(80),
      },
    );
    expect(s).toBeCloseTo(1, 5);
  });

  it('空出力はゼロ', () => {
    expect(discoveryScoreFn({}, {})).toBe(0);
  });
});

describe('mutationScoreFn', () => {
  it('要求件数 5 で 5 件全て必須フィールド埋まっていれば満点', () => {
    const dsls = Array.from({ length: 5 }, (_, i) => ({
      id: `m-${i}`,
      generation: 1,
      parentIds: ['p1'],
    }));
    expect(mutationScoreFn({ count: 5 }, dsls)).toBeCloseTo(1, 5);
  });

  it('要求件数の半分なら 0.75(count=0.5 × 0.5 + fields=1 × 0.5)', () => {
    const dsls = Array.from({ length: 2 }, (_, i) => ({
      id: `m-${i}`,
      generation: 1,
      parentIds: ['p1'],
    }));
    expect(mutationScoreFn({ count: 4 }, dsls)).toBeCloseTo(0.75, 5);
  });

  it('空配列はゼロ', () => {
    expect(mutationScoreFn({ count: 3 }, [])).toBe(0);
  });
});

describe('crossoverScoreFn', () => {
  it('parentIds が 2 件揃った要素のみ満点', () => {
    const out = [
      { id: 'x1', generation: 2, parentIds: ['a', 'b'] },
      { id: 'x2', generation: 2, parentIds: ['c', 'd'] },
    ];
    expect(crossoverScoreFn({ pairCount: 2 }, out)).toBeCloseTo(1, 5);
  });

  it('parentIds が 1 件しかない場合は parentScore 低下', () => {
    const out = [
      { id: 'x1', generation: 2, parentIds: ['a'] },
      { id: 'x2', generation: 2, parentIds: ['c', 'd'] },
    ];
    // count=1、parentScore=0.5 → 0.5 + 0.25 = 0.75
    expect(crossoverScoreFn({ pairCount: 2 }, out)).toBeCloseTo(0.75, 5);
  });

  it('空配列はゼロ', () => {
    expect(crossoverScoreFn({ pairCount: 2 }, [])).toBe(0);
  });
});

describe('bullBearDebateScoreFn', () => {
  it('bull/bear/synthesis/market 全揃いで満点', () => {
    const s = bullBearDebateScoreFn(
      {},
      {
        marketContext: { summary: 's'.repeat(30), dominantBias: 'bullish', biasStrength: 60 },
        bull: { scenario: 'sc'.repeat(20), rationale: ['r1', 'r2'] },
        bear: { scenario: 'sc'.repeat(20), rationale: ['r1', 'r2'] },
        synthesis: {
          preferredDirection: 'long',
          preferredConfidence: 70,
          reasoning: 'r'.repeat(40),
          actionableInsight: 'a'.repeat(30),
          phaseAnalysis: [{ phase: 'p', direction: 'long', condition: 'c', confidence: 60 }],
        },
      },
    );
    expect(s).toBeCloseTo(1, 5);
  });

  it('synthesis 空はゼロ寄り', () => {
    const s = bullBearDebateScoreFn(
      {},
      {
        bull: { scenario: 'sc'.repeat(20), rationale: ['r1', 'r2'] },
        bear: { scenario: 'sc'.repeat(20), rationale: ['r1', 'r2'] },
      },
    );
    // sideAvgScore=1、synthesisScore=0、marketScore=0
    // = 0.4 * 1 + 0 + 0 = 0.4
    expect(s).toBeCloseTo(0.4, 5);
  });
});
