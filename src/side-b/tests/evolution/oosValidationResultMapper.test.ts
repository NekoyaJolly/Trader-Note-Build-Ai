/**
 * PR #105: oosValidationResultMapper のテスト。
 *
 * 確認:
 *   1. analysis-engine の verdict を尊重して oos_passed / oos_failed にマップする
 *   2. evaluationKind='walk_forward' なら walk_forward_passed / walk_forward_failed にマップする
 *   3. notEvaluated → 'not_evaluated'
 *   4. insufficientOosWindow / metrics 欠損 → 'insufficient_oos_data'
 *   5. engineError → 'unknown' + ['oos_engine_error']
 *   6. verdict 未指定 → 'unknown' (= Evolution 側で独自判定しない)
 *   7. 観測下限 (tradeCount) を割っても warning だけで pass/fail は verdict 任せ
 *   8. baseline と oos の差分 (deltas) は計算されるが status 判定には使わない
 */

import {
  mapAnalysisEngineRobustnessResult,
  oosObservationThresholdsV1,
  buildOosMetricDelta,
  type OosMetrics,
} from '../../evolution/oosValidationResultMapper';

const baseInput = {
  candidateId: 'c1',
  dslId: 'c1',
  sourceStage: 'validation_candidate',
  route: 'normal_pass',
};

describe('mapAnalysisEngineRobustnessResult', () => {
  it('1. verdict=passed → oos_passed', () => {
    const r = mapAnalysisEngineRobustnessResult({
      ...baseInput,
      baselineMetrics: { pf: 1.5, tradeCount: 30, maxDrawdown: 10, expectancy: 0.5 },
      oosMetrics: { pf: 1.3, tradeCount: 25, maxDrawdown: 12, expectancy: 0.4 },
      verdict: 'passed',
    });
    expect(r.status).toBe('oos_passed');
    expect(r.failureReasons).toEqual([]);
  });

  it('2. verdict=failed + walk_forward → walk_forward_failed', () => {
    const r = mapAnalysisEngineRobustnessResult({
      ...baseInput,
      baselineMetrics: null,
      oosMetrics: { pf: 0.9, tradeCount: 22, maxDrawdown: 30, expectancy: -0.1 },
      verdict: 'failed',
      failureReasons: ['low_oos_pf', 'high_oos_drawdown'],
      evaluationKind: 'walk_forward',
    });
    expect(r.status).toBe('walk_forward_failed');
    expect(r.failureReasons).toEqual(['low_oos_pf', 'high_oos_drawdown']);
  });

  it('3. notEvaluated=true → not_evaluated', () => {
    const r = mapAnalysisEngineRobustnessResult({
      ...baseInput,
      baselineMetrics: null,
      oosMetrics: null,
      notEvaluated: true,
    });
    expect(r.status).toBe('not_evaluated');
    expect(r.failureReasons).toEqual([]);
  });

  it('4a. insufficientOosWindow → insufficient_oos_data', () => {
    const r = mapAnalysisEngineRobustnessResult({
      ...baseInput,
      baselineMetrics: null,
      oosMetrics: null,
      insufficientOosWindow: true,
    });
    expect(r.status).toBe('insufficient_oos_data');
    expect(r.failureReasons).toEqual(['insufficient_oos_data']);
  });

  it('4b. tradeCount=null → insufficient_oos_data', () => {
    const r = mapAnalysisEngineRobustnessResult({
      ...baseInput,
      baselineMetrics: null,
      oosMetrics: { pf: 1.5, tradeCount: null, maxDrawdown: 10, expectancy: 0.5 },
    });
    expect(r.status).toBe('insufficient_oos_data');
  });

  it('5. engineError → unknown + oos_engine_error', () => {
    const r = mapAnalysisEngineRobustnessResult({
      ...baseInput,
      baselineMetrics: null,
      oosMetrics: null,
      engineError: 'connection refused',
    });
    expect(r.status).toBe('unknown');
    expect(r.failureReasons).toEqual(['oos_engine_error']);
    expect(r.warnings.some((w) => w.includes('connection refused'))).toBe(true);
  });

  it('6. verdict 未指定 → unknown (= Evolution 側で独自判定しない)', () => {
    const r = mapAnalysisEngineRobustnessResult({
      ...baseInput,
      baselineMetrics: null,
      oosMetrics: { pf: 1.5, tradeCount: 30, maxDrawdown: 10, expectancy: 0.5 },
      // verdict 省略
    });
    expect(r.status).toBe('unknown');
    expect(r.failureReasons).toEqual(['unknown']);
  });

  it('7. tradeCount が観測下限未満でも verdict が passed なら oos_passed のまま', () => {
    const lowTrades = oosObservationThresholdsV1.minOosTrades - 1;
    const r = mapAnalysisEngineRobustnessResult({
      ...baseInput,
      baselineMetrics: null,
      oosMetrics: { pf: 1.2, tradeCount: lowTrades, maxDrawdown: 5, expectancy: 0.3 },
      verdict: 'passed',
    });
    // 観測下限未満は warning として出るが status は verdict 由来のまま
    expect(r.status).toBe('oos_passed');
    expect(r.warnings.some((w) => w.includes('観測下限'))).toBe(true);
  });

  it('8. deltas は計算されるが status 判定には使われない', () => {
    const baseline: OosMetrics = { pf: 2.0, tradeCount: 50, maxDrawdown: 5, expectancy: 1.0 };
    const oos: OosMetrics = { pf: 1.0, tradeCount: 30, maxDrawdown: 25, expectancy: 0.2 };
    const r = mapAnalysisEngineRobustnessResult({
      ...baseInput,
      baselineMetrics: baseline,
      oosMetrics: oos,
      verdict: 'passed', // analysis-engine が passed と返したなら劣化していても passed
    });
    expect(r.status).toBe('oos_passed');
    expect(r.deltas.pfDelta).toBeCloseTo(-1.0);
    expect(r.deltas.maxDrawdownDelta).toBeCloseTo(20);
  });
});

describe('buildOosMetricDelta', () => {
  it('baseline / oos いずれか null なら全 null', () => {
    expect(buildOosMetricDelta(null, null)).toEqual({
      pfDelta: null,
      tradeCountDelta: null,
      maxDrawdownDelta: null,
      expectancyDelta: null,
    });
  });

  it('両方ある場合 oos - baseline で計算', () => {
    const d = buildOosMetricDelta(
      { pf: 2.0, tradeCount: 50, maxDrawdown: 5, expectancy: 1.0 },
      { pf: 1.5, tradeCount: 40, maxDrawdown: 10, expectancy: 0.5 },
    );
    expect(d.pfDelta).toBeCloseTo(-0.5);
    expect(d.tradeCountDelta).toBe(-10);
    expect(d.maxDrawdownDelta).toBe(5);
    expect(d.expectancyDelta).toBeCloseTo(-0.5);
  });

  it('NaN / Infinity は null 化される', () => {
    const d = buildOosMetricDelta(
      { pf: NaN, tradeCount: 50, maxDrawdown: 5, expectancy: 1.0 },
      { pf: 1.5, tradeCount: 40, maxDrawdown: 10, expectancy: 0.5 },
    );
    expect(d.pfDelta).toBeNull();
  });
});
