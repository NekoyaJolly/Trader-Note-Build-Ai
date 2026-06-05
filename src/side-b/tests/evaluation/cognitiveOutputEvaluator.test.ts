/**
 * 認知層評価ハーネス (P1) のユニットテスト。
 *
 * judge(LLM) は DI で偽物に差し替え、**決定論集計** (aggregateVerdict) と
 * 評価フロー (evaluateCognitiveOutput) を非 LLM で検証する。
 */
import { describe, it, expect, jest } from '@jest/globals';
import {
  aggregateVerdict,
  buildJudgeUserPrompt,
  evaluateCognitiveOutput,
  MARKET_ANALYSIS_RUBRIC,
  type CognitiveJudge,
} from '../../evaluation/cognitiveOutputEvaluator';
import type { CognitiveRubric, JudgeRawOutput } from '../../models/cognitiveEval';

const TWO_DIM_RUBRIC: CognitiveRubric = {
  name: 'test_v1',
  targetDescription: 'テスト用',
  passThreshold: 0.6,
  dimensions: [
    { key: 'a', label: 'A', description: 'a の基準', weight: 1 },
    { key: 'b', label: 'B', description: 'b の基準', weight: 3 },
  ],
};

describe('aggregateVerdict (決定論集計)', () => {
  it('重み付き加重平均を正規化して overallScore を出す', () => {
    // a=1.0(w1), b=0.0(w3) → (1*1 + 0*3)/4 = 0.25
    const v = aggregateVerdict(TWO_DIM_RUBRIC, {
      dimensionScores: [
        { dimension: 'a', score: 1.0, reason: 'ok' },
        { dimension: 'b', score: 0.0, reason: 'ng' },
      ],
      summary: 's',
    });
    expect(v.overallScore).toBeCloseTo(0.25);
    expect(v.passed).toBe(false);
    expect(v.passThreshold).toBe(0.6);
    expect(v.missingDimensions).toEqual([]);
  });

  it('閾値以上で passed=true', () => {
    // a=1.0(w1), b=1.0(w3) → 1.0
    const v = aggregateVerdict(TWO_DIM_RUBRIC, {
      dimensionScores: [
        { dimension: 'a', score: 1.0, reason: 'ok' },
        { dimension: 'b', score: 1.0, reason: 'ok' },
      ],
      summary: '',
    });
    expect(v.overallScore).toBeCloseTo(1.0);
    expect(v.passed).toBe(true);
  });

  it('judge が採点しなかった次元は score=0 補完し missingDimensions に記録', () => {
    const v = aggregateVerdict(TWO_DIM_RUBRIC, {
      dimensionScores: [{ dimension: 'a', score: 1.0, reason: 'ok' }],
      summary: '',
    });
    // a=1.0(w1), b=欠落→0(w3) → 0.25
    expect(v.overallScore).toBeCloseTo(0.25);
    expect(v.missingDimensions).toEqual(['b']);
    const bScore = v.dimensionScores.find((d) => d.dimension === 'b');
    expect(bScore?.score).toBe(0);
  });

  it('範囲外スコア (>1 / <0 / NaN) は 0..1 に clamp する', () => {
    const v = aggregateVerdict(TWO_DIM_RUBRIC, {
      dimensionScores: [
        { dimension: 'a', score: 5, reason: 'over' },
        { dimension: 'b', score: -3, reason: 'under' },
      ],
      summary: '',
    });
    // a=clamp(5)=1.0(w1), b=clamp(-3)=0(w3) → 0.25
    expect(v.overallScore).toBeCloseTo(0.25);
    expect(v.dimensionScores.find((d) => d.dimension === 'a')?.score).toBe(1);
    expect(v.dimensionScores.find((d) => d.dimension === 'b')?.score).toBe(0);
  });

  it('MARKET_ANALYSIS_RUBRIC: 接地0でも他満点だと 0.7 で合格、接地0+他0.4 だと不合格', () => {
    const allHigh = aggregateVerdict(MARKET_ANALYSIS_RUBRIC, {
      dimensionScores: [
        { dimension: 'grounding', score: 0, reason: '' },
        { dimension: 'causal_validity', score: 1, reason: '' },
        { dimension: 'internal_consistency', score: 1, reason: '' },
        { dimension: 'completeness', score: 1, reason: '' },
        { dimension: 'level_basis', score: 1, reason: '' },
      ],
      summary: '',
    });
    expect(allHigh.overallScore).toBeCloseTo(0.7);
    expect(allHigh.passed).toBe(true);

    const grounded0 = aggregateVerdict(MARKET_ANALYSIS_RUBRIC, {
      dimensionScores: [
        { dimension: 'grounding', score: 0, reason: '' },
        { dimension: 'causal_validity', score: 0.4, reason: '' },
        { dimension: 'internal_consistency', score: 0.4, reason: '' },
        { dimension: 'completeness', score: 0.4, reason: '' },
        { dimension: 'level_basis', score: 0.4, reason: '' },
      ],
      summary: '',
    });
    // 0*.3 + .4*(.25+.2+.15+.1)=.4*.7=0.28
    expect(grounded0.overallScore).toBeCloseTo(0.28);
    expect(grounded0.passed).toBe(false);
  });
});

describe('buildJudgeUserPrompt', () => {
  it('rubric の次元 key / context / 評価対象を user プロンプトに含める', () => {
    const prompt = buildJudgeUserPrompt({
      rubric: TWO_DIM_RUBRIC,
      output: { foo: 'bar' },
      context: { close: 100 },
    });
    expect(prompt).toContain('key="a"');
    expect(prompt).toContain('key="b"');
    expect(prompt).toContain('"foo":"bar"');
    expect(prompt).toContain('"close":100');
  });
});

describe('evaluateCognitiveOutput', () => {
  it('注入 judge の採点を集計し、judge には system/user プロンプトを渡す', async () => {
    const scoreDimensions = jest
      .fn<(i: { systemPrompt: string; userPrompt: string }) => Promise<JudgeRawOutput>>()
      .mockResolvedValue({
        dimensionScores: [
          { dimension: 'a', score: 1, reason: 'ok' },
          { dimension: 'b', score: 1, reason: 'ok' },
        ],
        summary: 'good',
      });
    const judge: CognitiveJudge = { scoreDimensions };

    const verdict = await evaluateCognitiveOutput(
      { rubric: TWO_DIM_RUBRIC, output: { x: 1 }, context: { y: 2 } },
      { judge, loadJudgePrompt: () => 'SYS_PROMPT' },
    );

    expect(verdict.passed).toBe(true);
    expect(verdict.summary).toBe('good');
    // judge には system プロンプト + rubric を含む user プロンプトが渡る
    const callArg = scoreDimensions.mock.calls[0][0];
    expect(callArg.systemPrompt).toBe('SYS_PROMPT');
    expect(callArg.userPrompt).toContain('key="a"');
  });
});
