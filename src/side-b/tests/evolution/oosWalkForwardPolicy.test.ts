/**
 * PR #103: OOS / Walk-forward v1 単体テスト
 *
 * 設計書 §テスト要件 15 項目:
 *   1-2. buildOosSplitWindowV1 が時系列順 / insufficient
 *   3-5. buildWalkForwardFoldsV1 が時系列順 / 順序保証 / データ不足で空配列
 *   6-10. classifyOosValidationV1 の各失敗・成功判定
 *   11. baseline missing でも 0 補完せず warning
 *   12-14. summarizeWalkForwardFoldsV1 の status 判定
 *   15. summarizeOosValidationResults が status / reason / route / sourceStage 集計
 */

import {
  buildOosSplitWindowV1,
  buildWalkForwardFoldsV1,
  classifyOosValidationV1,
  oosValidationThresholdsV1,
  summarizeOosValidationResults,
  summarizeWalkForwardFoldsV1,
  type OosMetrics,
  type OosValidationResult,
  type WalkForwardFold,
} from '../../evolution/oosWalkForwardPolicy';

describe('oosWalkForwardPolicy.buildOosSplitWindowV1', () => {
  it('1. 時系列順の split を作る (trainEnd <= oosStart < oosEnd)', () => {
    const w = buildOosSplitWindowV1({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      oosRatio: 0.2,
    });
    expect(w.trainStart).toBe('2024-01-01');
    expect(new Date(w.trainEnd).getTime()).toBeLessThanOrEqual(new Date(w.oosStart).getTime());
    expect(new Date(w.oosStart).getTime()).toBeLessThan(new Date(w.oosEnd).getTime());
    expect(w.oosEnd).toBe('2024-12-31');
  });

  it('2. 短すぎる期間で oosStart=oosEnd の自明境界を返す (caller 側で insufficient 扱い可能)', () => {
    const w = buildOosSplitWindowV1({
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      oosRatio: 0.2,
    });
    expect(w.oosStart).toBe(w.oosEnd);
  });

  it('validationRatio を渡すと validation 期間も入る', () => {
    const w = buildOosSplitWindowV1({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      oosRatio: 0.2,
      validationRatio: 0.1,
    });
    expect(w.validationStart).toBeDefined();
    expect(w.validationEnd).toBeDefined();
    expect(new Date(w.trainEnd).getTime()).toBeLessThanOrEqual(
      new Date(w.validationStart!).getTime(),
    );
    expect(new Date(w.validationEnd!).getTime()).toBeLessThanOrEqual(
      new Date(w.oosStart).getTime(),
    );
  });

  it('PR #103 review #3: ratio が [0, 1] にクランプされる (負値 / 1 超え)', () => {
    // 負値はゼロにクランプ → oosDays=0、oosStart === oosEnd === endDate
    const negative = buildOosSplitWindowV1({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      oosRatio: -0.5,
    });
    expect(negative.oosStart).toBe(negative.oosEnd);
    expect(negative.oosEnd).toBe('2024-12-31');

    // 1 超は 1 にクランプ → oosDays = totalDays、trainEnd === trainStart
    const overOne = buildOosSplitWindowV1({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      oosRatio: 5,
    });
    expect(overOne.trainStart).toBe(overOne.trainEnd);
    expect(overOne.oosStart).toBe('2024-01-01');
  });

  it('PR #103 review #3: oosRatio + validationRatio > 1 でも valStart は trainStart 以前にならない', () => {
    const w = buildOosSplitWindowV1({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      oosRatio: 0.6,
      validationRatio: 0.7, // 合計 1.3 → validation 側が縮められる
    });
    // 時系列順は維持
    expect(new Date(w.trainStart).getTime()).toBeLessThanOrEqual(new Date(w.trainEnd).getTime());
    if (w.validationStart && w.validationEnd) {
      expect(new Date(w.trainStart).getTime()).toBeLessThanOrEqual(
        new Date(w.validationStart).getTime(),
      );
      expect(new Date(w.validationEnd).getTime()).toBeLessThanOrEqual(
        new Date(w.oosStart).getTime(),
      );
    }
    expect(new Date(w.oosStart).getTime()).toBeLessThanOrEqual(new Date(w.oosEnd).getTime());
  });
});

describe('oosWalkForwardPolicy.buildWalkForwardFoldsV1', () => {
  it('3. 時系列順の folds を作る (foldIndex が連番、各 fold で trainEnd < oosStart)', () => {
    const folds = buildWalkForwardFoldsV1({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      trainWindowDays: 60,
      oosWindowDays: 30,
      stepDays: 30,
      maxFolds: 3,
    });
    expect(folds.length).toBe(3);
    folds.forEach((f, idx) => {
      expect(f.foldIndex).toBe(idx);
      expect(new Date(f.trainEnd).getTime()).toBeLessThanOrEqual(new Date(f.oosStart).getTime());
      expect(new Date(f.oosStart).getTime()).toBeLessThan(new Date(f.oosEnd).getTime());
    });
    // fold 同士の trainStart は前進する
    for (let i = 1; i < folds.length; i++) {
      expect(new Date(folds[i].trainStart).getTime()).toBeGreaterThan(
        new Date(folds[i - 1].trainStart).getTime(),
      );
    }
  });

  it('4. 各 fold で trainEnd === oosStart (anchored、隙間なし)', () => {
    const folds = buildWalkForwardFoldsV1({
      startDate: '2024-01-01',
      endDate: '2024-06-30',
      trainWindowDays: 30,
      oosWindowDays: 15,
      stepDays: 15,
      maxFolds: 5,
    });
    expect(folds.length).toBeGreaterThan(0);
    for (const f of folds) {
      expect(f.trainEnd).toBe(f.oosStart);
    }
  });

  it('5. データ不足時 (期間 < trainWindow + oosWindow) は空配列、例外を投げない', () => {
    const folds = buildWalkForwardFoldsV1({
      startDate: '2024-01-01',
      endDate: '2024-01-10',
      trainWindowDays: 60,
      oosWindowDays: 30,
      stepDays: 30,
    });
    expect(folds).toEqual([]);
  });

  it('不正な windowDays (≤0) は空配列', () => {
    expect(
      buildWalkForwardFoldsV1({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        trainWindowDays: 0,
        oosWindowDays: 30,
        stepDays: 30,
      }),
    ).toEqual([]);
  });
});

describe('oosWalkForwardPolicy.classifyOosValidationV1', () => {
  const baseOos: OosMetrics = {
    pf: 1.5,
    tradeCount: 50,
    maxDrawdown: 10,
    expectancy: 0.001,
  };

  it('6. tradeCount 不足で insufficient_oos_trades + oos_failed', () => {
    const r = classifyOosValidationV1({
      baselineMetrics: { pf: 1.6, tradeCount: 60, maxDrawdown: 8, expectancy: 0.002 },
      oosMetrics: { ...baseOos, tradeCount: 5 },
    });
    expect(r.status).toBe('oos_failed');
    expect(r.failureReasons).toContain('insufficient_oos_trades');
  });

  it('7. PF 不足で low_oos_pf', () => {
    const r = classifyOosValidationV1({
      baselineMetrics: { pf: 1.6, tradeCount: 60, maxDrawdown: 8, expectancy: 0.002 },
      oosMetrics: { ...baseOos, pf: 0.9 },
    });
    expect(r.status).toBe('oos_failed');
    expect(r.failureReasons).toContain('low_oos_pf');
  });

  it('8. drawdown 過大で high_oos_drawdown (percent scale)', () => {
    const r = classifyOosValidationV1({
      baselineMetrics: { pf: 1.6, tradeCount: 60, maxDrawdown: 8, expectancy: 0.002 },
      oosMetrics: { ...baseOos, maxDrawdown: 35 }, // 35% > maxOosDrawdown=25%
    });
    expect(r.status).toBe('oos_failed');
    expect(r.failureReasons).toContain('high_oos_drawdown');
  });

  it('9. baseline から大きく劣化した場合 insample_oos_divergence', () => {
    const r = classifyOosValidationV1({
      baselineMetrics: { pf: 2.5, tradeCount: 60, maxDrawdown: 8, expectancy: 0.002 },
      oosMetrics: { ...baseOos, pf: 1.2 }, // baseline 2.5 - oos 1.2 = 1.3 > maxPfDegradation=0.25
    });
    expect(r.status).toBe('oos_failed');
    expect(r.failureReasons).toContain('insample_oos_divergence');
  });

  it('10. 条件を全て満たせば oos_passed (= reasons 空)', () => {
    // baseline と oos の expectancy 差は maxExpectancyDegradation 以下
    const r = classifyOosValidationV1({
      baselineMetrics: { pf: 1.6, tradeCount: 60, maxDrawdown: 8, expectancy: 0.001 },
      oosMetrics: baseOos,
    });
    expect(r.status).toBe('oos_passed');
    expect(r.failureReasons).toEqual([]);
    expect(r.deltas.pfDelta).toBeCloseTo(-0.1, 2);
  });

  it('11. baseline missing でも 0 補完せず warning + 絶対閾値判定は実施', () => {
    const r = classifyOosValidationV1({
      baselineMetrics: null,
      oosMetrics: baseOos,
    });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toMatch(/baseline/);
    // 絶対閾値は満たすので oos_passed
    expect(r.status).toBe('oos_passed');
    // baseline 欠落時、deltas は全 null (0 補完しない)
    expect(r.deltas.pfDelta).toBeNull();
    expect(r.deltas.tradeCountDelta).toBeNull();
  });

  it('oos metrics が null なら insufficient_oos_data', () => {
    const r = classifyOosValidationV1({
      baselineMetrics: { pf: 1.6, tradeCount: 60, maxDrawdown: 8, expectancy: 0.002 },
      oosMetrics: null,
    });
    expect(r.status).toBe('insufficient_oos_data');
    expect(r.failureReasons).toContain('insufficient_oos_data');
  });

  it('oos.tradeCount が null なら insufficient_oos_data', () => {
    const r = classifyOosValidationV1({
      baselineMetrics: null,
      oosMetrics: { pf: 1.5, tradeCount: null, maxDrawdown: 10, expectancy: 0.001 },
    });
    expect(r.status).toBe('insufficient_oos_data');
  });

  it('複数失敗理由が積み重なる', () => {
    const r = classifyOosValidationV1({
      baselineMetrics: { pf: 2.5, tradeCount: 60, maxDrawdown: 8, expectancy: 0.002 },
      oosMetrics: { pf: 0.5, tradeCount: 5, maxDrawdown: 50, expectancy: 0 },
    });
    expect(r.status).toBe('oos_failed');
    expect(r.failureReasons).toEqual(
      expect.arrayContaining(['insufficient_oos_trades', 'low_oos_pf', 'high_oos_drawdown']),
    );
  });

  it('閾値定数: maxOosDrawdown=25 (= 25%pt percent scale)', () => {
    expect(oosValidationThresholdsV1.maxOosDrawdown).toBe(25);
    expect(oosValidationThresholdsV1.minOosTrades).toBe(20);
    expect(oosValidationThresholdsV1.minOosPf).toBe(1.05);
  });
});

describe('oosWalkForwardPolicy.summarizeWalkForwardFoldsV1', () => {
  function makeFold(
    foldIndex: number,
    status: WalkForwardFold['status'],
    pf: number,
  ): WalkForwardFold {
    return {
      foldIndex,
      trainStart: '2024-01-01',
      trainEnd: '2024-03-01',
      oosStart: '2024-03-01',
      oosEnd: '2024-04-01',
      metrics: { pf, tradeCount: 30, maxDrawdown: 10, expectancy: 0.001 },
      status,
      failureReasons: [],
    };
  }

  it('12. 半数以上 pass で walk_forward_passed', () => {
    const r = summarizeWalkForwardFoldsV1([
      makeFold(0, 'oos_passed', 1.5),
      makeFold(1, 'oos_passed', 1.4),
      makeFold(2, 'oos_failed', 0.8),
    ]);
    expect(r.status).toBe('walk_forward_passed');
  });

  it('13. 半数未満 pass で walk_forward_failed', () => {
    const r = summarizeWalkForwardFoldsV1([
      makeFold(0, 'oos_passed', 1.5),
      makeFold(1, 'oos_failed', 0.8),
      makeFold(2, 'oos_failed', 0.7),
    ]);
    expect(r.status).toBe('walk_forward_failed');
  });

  it('14. PF が大きくブレると fold_instability', () => {
    const r = summarizeWalkForwardFoldsV1([
      makeFold(0, 'oos_passed', 0.5),
      makeFold(1, 'oos_passed', 3.0),
    ]);
    // 半数以上 pass なので walk_forward_passed だが、不安定 reason が積まれる
    expect(r.status).toBe('walk_forward_passed');
    expect(r.failureReasons).toContain('fold_instability');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('folds 空なら not_evaluated + insufficient_oos_data', () => {
    const r = summarizeWalkForwardFoldsV1([]);
    expect(r.status).toBe('not_evaluated');
    expect(r.failureReasons).toContain('insufficient_oos_data');
  });
});

describe('oosWalkForwardPolicy.summarizeOosValidationResults', () => {
  function makeResult(
    status: OosValidationResult['status'],
    failureReasons: OosValidationResult['failureReasons'],
    route: string,
    sourceStage: string,
  ): OosValidationResult {
    return {
      candidateId: `c-${Math.random()}`,
      dslId: `c-${Math.random()}`,
      sourceStage,
      route,
      baselineMetrics: null,
      oosMetrics: null,
      deltas: { pfDelta: null, tradeCountDelta: null, maxDrawdownDelta: null, expectancyDelta: null },
      status,
      failureReasons,
      folds: [],
      warnings: [],
    };
  }

  it('15. status / failureReason / route / sourceStage で集計、未出現 status は 0', () => {
    const summary = summarizeOosValidationResults([
      makeResult('oos_passed', [], 'normal_pass', 'validation_candidate'),
      makeResult(
        'oos_failed',
        ['low_oos_pf', 'insufficient_oos_trades'],
        'novelty_rescue',
        'validation_candidate',
      ),
      makeResult('not_evaluated', [], '', ''),
    ]);
    expect(summary.attempted).toBe(3);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.notEvaluated).toBe(1);

    expect(summary.byStatus.oos_passed).toBe(1);
    expect(summary.byStatus.oos_failed).toBe(1);
    expect(summary.byStatus.not_evaluated).toBe(1);
    expect(summary.byStatus.unknown).toBe(0);
    expect(summary.byStatus.walk_forward_passed).toBe(0);

    expect(summary.byFailureReason.low_oos_pf).toBe(1);
    expect(summary.byFailureReason.insufficient_oos_trades).toBe(1);
    expect(summary.byFailureReason.fold_instability).toBe(0);

    expect(summary.byRoute.normal_pass.passed).toBe(1);
    expect(summary.byRoute.novelty_rescue.failed).toBe(1);
    // route 空 → unknown bucket
    expect(summary.byRoute.unknown.attempted).toBe(1);

    expect(summary.bySourceStage.validation_candidate.attempted).toBe(2);
    expect(summary.bySourceStage.unknown.attempted).toBe(1);
  });

  it('入力空でも全 status / failureReason が 0 で初期化される', () => {
    const summary = summarizeOosValidationResults([]);
    expect(summary.attempted).toBe(0);
    expect(summary.byStatus.oos_passed).toBe(0);
    expect(summary.byStatus.oos_failed).toBe(0);
    expect(summary.byFailureReason.unknown).toBe(0);
    expect(summary.byRoute).toEqual({});
    expect(summary.bySourceStage).toEqual({});
  });
});
