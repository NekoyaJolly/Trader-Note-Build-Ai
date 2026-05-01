/**
 * Phase 6: スコアリング関数のユニットテスト
 */

import {
  hypothesisGeneratorScoreFn,
  trendSpecialistScoreFn,
  oscillatorSpecialistScoreFn,
  volatilityVolumeSpecialistScoreFn,
  strategistScoreFn,
  devilsAdvocateScoreFn,
  discoveryScoreFn,
  mutationScoreFn,
  crossoverScoreFn,
  promptMutationScoreFn,
  metaEvolutionScoreFn,
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
  it('Phase 6 MVP + Critical-3 残スコープの 12 エージェント分は取得できる', () => {
    expect(getScoringFunction('hypothesis_generator')).not.toBeNull();
    expect(getScoringFunction('trend_specialist')).not.toBeNull();
    expect(getScoringFunction('oscillator_specialist')).not.toBeNull();
    expect(getScoringFunction('volatility_volume_specialist')).not.toBeNull();
    expect(getScoringFunction('strategist')).not.toBeNull();
    expect(getScoringFunction('devils_advocate')).not.toBeNull();
    expect(getScoringFunction('discovery')).not.toBeNull();
    expect(getScoringFunction('mutation')).not.toBeNull();
    expect(getScoringFunction('crossover')).not.toBeNull();
    expect(getScoringFunction('prompt_mutation')).not.toBeNull();
    expect(getScoringFunction('meta_evolution')).not.toBeNull();
    expect(getScoringFunction('bull_bear_debate')).not.toBeNull();
  });

  it('未実装エージェントは null', () => {
    expect(getScoringFunction('nonexistent')).toBeNull();
    expect(getScoringFunction('')).toBeNull();
  });
});

// ============================================================
// Critical-3 残スコープ: 死蔵 8 体のスコア関数テスト
// ============================================================

describe('strategistScoreFn', () => {
  it('verdict + reasons + interpretation + insights が揃って満点', () => {
    const s = strategistScoreFn(
      {},
      {
        verdict: 'rejected',
        baseCriteriaReasons: ['PF 不足'],
        interpretation: 'i'.repeat(80),
        actionableInsights: ['SL を厳しく', '対象期間を広げる'],
      },
    );
    expect(s).toBeCloseTo(1, 5);
  });

  it('verdict 不明はゼロ寄り', () => {
    const s = strategistScoreFn({}, { verdict: 'wrong', interpretation: 'x'.repeat(80) });
    // verdictScore=0、reasonsScore=0(verdict不明扱い)、interpScore=1、insightsScore=0
    // = 0 + 0 + 0.3 + 0 = 0.3 ジャスト
    expect(s).toBeCloseTo(0.3, 5);
  });

  it('confirmed は reasons 空でも reasonsScore=1', () => {
    const s = strategistScoreFn(
      {},
      {
        verdict: 'confirmed',
        baseCriteriaReasons: [],
        interpretation: 'i'.repeat(80),
        actionableInsights: ['x', 'y'],
      },
    );
    expect(s).toBeCloseTo(1, 5);
  });
});

describe('devilsAdvocateScoreFn', () => {
  it('シナリオ 2 件 + 弱点 + 推奨アクション充実で満点', () => {
    const s = devilsAdvocateScoreFn(
      {},
      {
        failureScenarios: [
          {
            description: 'd'.repeat(40),
            triggerConditions: 't'.repeat(30),
            estimatedLikelihood: 'medium',
          },
          {
            description: 'd'.repeat(40),
            triggerConditions: 't'.repeat(30),
            estimatedLikelihood: 'high',
          },
        ],
        weakestAssumption: {
          description: 'wd'.repeat(20),
          whyVulnerable: 'wv'.repeat(20),
        },
        recommendation: {
          action: 'modify',
          rationale: 'r'.repeat(40),
          suggestedModifications: ['fix1'],
        },
      },
    );
    expect(s).toBeCloseTo(1, 5);
  });

  it('空出力はゼロ', () => {
    expect(devilsAdvocateScoreFn({}, {})).toBe(0);
  });

  it('シナリオ 1 件のみは低スコア', () => {
    const s = devilsAdvocateScoreFn(
      {},
      {
        failureScenarios: [
          {
            description: 'd'.repeat(40),
            triggerConditions: 't'.repeat(30),
            estimatedLikelihood: 'high',
          },
        ],
      },
    );
    // scenariosScore = 0.5 * 0.5 + 0.5 * 1 = 0.75、他 0 → 0.4 * 0.75 = 0.3
    expect(s).toBeCloseTo(0.3, 5);
  });
});

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

describe('promptMutationScoreFn', () => {
  it('3 件 × 100 文字 + metadata 埋まりで満点', () => {
    const proposals = Array.from({ length: 3 }, (_, i) => ({
      version: `v${i}`,
      content: 'c'.repeat(100),
      notes: 'n',
      expectedImprovement: 'e',
    }));
    expect(promptMutationScoreFn({ count: 3 }, proposals)).toBeCloseTo(1, 5);
  });

  it('content 短すぎは contentScore=0', () => {
    const proposals = [
      { version: 'v1', content: 'short', notes: 'n', expectedImprovement: 'e' },
    ];
    // count=1/3、content=0、metadata=1
    // = 0.4 * (1/3) + 0 + 0.2 * 1 ≒ 0.333
    const s = promptMutationScoreFn({ count: 3 }, proposals);
    expect(s).toBeGreaterThan(0.2);
    expect(s).toBeLessThan(0.4);
  });

  it('空配列はゼロ', () => {
    expect(promptMutationScoreFn({ count: 3 }, [])).toBe(0);
  });
});

describe('metaEvolutionScoreFn', () => {
  it('proposals + analysis + confidence 全揃いで満点', () => {
    const s = metaEvolutionScoreFn(
      {},
      {
        proposals: [
          {
            type: 'add',
            agentName: 'newAgent',
            reasoning: 'r'.repeat(40),
            expectedImprovement: 'e'.repeat(30),
          },
        ],
        analysis: {
          currentAgents: ['hg'],
          coverageGaps: [],
          underperformers: [],
        },
        confidence: 0.7,
      },
    );
    expect(s).toBeCloseTo(1, 5);
  });

  it('空提案 + confidence 範囲外でも 0 にはならない(analysis 評価が独立)', () => {
    const s = metaEvolutionScoreFn(
      {},
      {
        proposals: [],
        analysis: { currentAgents: ['hg'], coverageGaps: [], underperformers: [] },
        confidence: 0.99,
      },
    );
    // proposalsScore=0、analysisScore=1、confInRange=0.3
    // = 0 + 0.3 + 0.06 = 0.36
    expect(s).toBeGreaterThan(0.3);
    expect(s).toBeLessThan(0.5);
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
