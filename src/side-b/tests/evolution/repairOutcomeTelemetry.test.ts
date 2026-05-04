/**
 * PR #102: RepairHint Outcome Telemetry v1 単体テスト
 *
 * 設計書 §テスト要件 16 項目:
 *   1. baseline / child / trace の欠落で `unknown`
 *   2-9. failureReason ごとの主指標で improved / worsened / unchanged 判定
 *   10. dsl_missing は warning + unknown
 *   11. other は複数 metrics の総合判定 (矛盾は unchanged)
 *   12. maxDrawdown は小さい方を改善
 *   13-15. summary が failureReason / target / route 別に集計
 *   16. targets 空は `'unknown'` bucket
 */

import { createRepairHintV1 } from '../../evolution/repairHintPolicy';
import {
  buildRepairAppliedTrace,
  evaluateRepairOutcome,
  summarizeRepairOutcomes,
  repairOutcomeThresholds,
  type RepairAppliedTrace,
  type RepairOutcome,
  type RepairOutcomeBaseline,
} from '../../evolution/repairOutcomeTelemetry';

function trace(
  failureReason: string,
  targets: string[] = ['entry', 'filters'],
  severity = 'medium',
): RepairAppliedTrace {
  return {
    sourceCandidateId: 'src-1',
    sourceDslId: 'src-1',
    failureReason,
    route: 'trade_count_rescue',
    severity,
    targets,
    actionSummaries: targets.map((t) => `dummy ${t} action`),
  };
}

function baselineFor(
  failureReason: string,
  metrics: RepairOutcomeBaseline['metrics'],
  route = 'trade_count_rescue',
): RepairOutcomeBaseline {
  return { candidateId: 'src-1', dslId: 'src-1', failureReason, route, metrics };
}

describe('repairOutcomeTelemetry.evaluateRepairOutcome', () => {
  it('1. baseline がない場合 unknown になる', () => {
    const out = evaluateRepairOutcome(null, {
      candidateId: 'c1',
      dslId: 'c1',
      repairApplied: trace('insufficient_trades'),
      metrics: { tradeCount: 30, pf: 1.2 },
    });
    expect(out.status).toBe('unknown');
    expect(out.reason).toMatch(/baseline/);
  });

  it('2. child metrics がない場合 unknown になる', () => {
    const baseline = baselineFor('insufficient_trades', { tradeCount: 0 });
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c1',
      dslId: 'c1',
      repairApplied: trace('insufficient_trades'),
    });
    expect(out.status).toBe('unknown');
    expect(out.reason).toMatch(/metrics/);
  });

  it('3. insufficient_trades で tradeCount が増えたら improved', () => {
    const baseline = baselineFor('insufficient_trades', { tradeCount: 0 });
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-better',
      dslId: 'c-better',
      repairApplied: trace('insufficient_trades'),
      metrics: { tradeCount: 30, pf: 1.0 },
    });
    expect(out.status).toBe('improved');
    expect(out.deltas.tradeCountDelta).toBe(30);
    expect(out.reason).toMatch(/0→30|tradeCountDelta/);
  });

  it('4. insufficient_trades で tradeCount が減ったら worsened', () => {
    const baseline = baselineFor('insufficient_trades', { tradeCount: 20 });
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-worse',
      dslId: 'c-worse',
      repairApplied: trace('insufficient_trades'),
      metrics: { tradeCount: 5 },
    });
    expect(out.status).toBe('worsened');
    expect(out.deltas.tradeCountDelta).toBe(-15);
  });

  it('5. low_pf で PF が改善したら improved', () => {
    const baseline = baselineFor('low_pf', { pf: 0.7, tradeCount: 30 });
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-pf-up',
      dslId: 'c-pf-up',
      repairApplied: trace('low_pf', ['exit', 'filters']),
      metrics: { pf: 1.3, tradeCount: 30 },
    });
    expect(out.status).toBe('improved');
    expect(out.deltas.pfDelta).toBeCloseTo(0.6, 2);
  });

  it('6. low_pf で PF が悪化したら worsened', () => {
    const baseline = baselineFor('low_pf', { pf: 1.0, tradeCount: 30 });
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-pf-down',
      dslId: 'c-pf-down',
      repairApplied: trace('low_pf', ['exit']),
      metrics: { pf: 0.5, tradeCount: 30 },
    });
    expect(out.status).toBe('worsened');
  });

  it('7. PF差分が閾値未満なら unchanged', () => {
    const baseline = baselineFor('low_pf', { pf: 1.10, tradeCount: 30 });
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-same',
      dslId: 'c-same',
      repairApplied: trace('low_pf', ['exit']),
      metrics: { pf: 1.11, tradeCount: 30 }, // delta = 0.01 < pfMinDelta=0.02
    });
    expect(out.status).toBe('unchanged');
    expect(repairOutcomeThresholds.pfMinDelta).toBe(0.02);
  });

  it('8. analysis_engine_timeout で child metrics が存在すれば improved', () => {
    const baseline = baselineFor('analysis_engine_timeout', {});
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-recovered',
      dslId: 'c-recovered',
      repairApplied: trace('analysis_engine_timeout', ['dsl_shape', 'evaluation_runtime']),
      metrics: { pf: 1.3, tradeCount: 25 },
    });
    expect(out.status).toBe('improved');
    expect(out.reason).toMatch(/完走/);
  });

  it('9. analysis_engine_error で child metrics が存在すれば improved', () => {
    const baseline = baselineFor('analysis_engine_error', {});
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-fixed',
      dslId: 'c-fixed',
      repairApplied: trace('analysis_engine_error', ['dsl_shape']),
      metrics: { pf: 1.0, tradeCount: 20 },
    });
    expect(out.status).toBe('improved');
  });

  it('analysis_engine_timeout で child も timeout なら worsened (metrics 欠落でも判定可能)', () => {
    const baseline = baselineFor('analysis_engine_timeout', {});
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-still-timeout',
      dslId: 'c-still-timeout',
      repairApplied: trace('analysis_engine_timeout', ['dsl_shape']),
      failureReason: 'analysis-engine BT failed: request timeout',
    });
    expect(out.status).toBe('worsened');
  });

  it('10. dsl_missing は warning 付き unknown', () => {
    const baseline = baselineFor('dsl_missing', {});
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-fatal',
      dslId: 'c-fatal',
      repairApplied: trace('dsl_missing', ['none'], 'fatal'),
      metrics: { pf: 1.0 },
    });
    expect(out.status).toBe('unknown');
    expect(out.warnings.length).toBeGreaterThan(0);
    expect(out.warnings[0]).toMatch(/dsl_missing/);
  });

  it('11. other は複数metricsから保守的に判定する (矛盾は unchanged)', () => {
    const baseline = baselineFor('other', { pf: 1.0, tradeCount: 20 });
    // PF +0.5 (improved) と tradeCount -10 (worsened) で矛盾 → unchanged
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-other-mix',
      dslId: 'c-other-mix',
      repairApplied: trace('other', ['parameters']),
      metrics: { pf: 1.5, tradeCount: 10 },
    });
    expect(out.status).toBe('unchanged');
    expect(out.reason).toMatch(/矛盾/);
  });

  it('11b. other は単一指標が改善のみなら improved', () => {
    const baseline = baselineFor('other', { pf: 1.0 });
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-other-up',
      dslId: 'c-other-up',
      repairApplied: trace('other', ['parameters']),
      metrics: { pf: 1.3 },
    });
    expect(out.status).toBe('improved');
  });

  it('12. maxDrawdown は小さい方を改善として扱う (other 経路、percent scale)', () => {
    // PR #102 review #2: analysis-engine summary.maxDD は百分率 (%)。
    // 30% → 20% (= -10%pt) は閾値 0.5%pt を超えるので improved。
    const baseline = baselineFor('other', { maxDrawdown: 30 });
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-dd',
      dslId: 'c-dd',
      repairApplied: trace('other', ['risk']),
      metrics: { maxDrawdown: 20 },
    });
    expect(out.status).toBe('improved');
    expect(out.deltas.maxDrawdownDelta).toBe(-10);
  });

  it('12b. maxDrawdown 微差 (< 0.5%pt) は unchanged (PR #102 review #2)', () => {
    const baseline = baselineFor('other', { maxDrawdown: 30 });
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-dd-noise',
      dslId: 'c-dd-noise',
      repairApplied: trace('other', ['risk']),
      metrics: { maxDrawdown: 29.99 }, // -0.01%pt はノイズ扱い
    });
    expect(out.status).toBe('unchanged');
  });

  it('PR #102 review #1: scheduler が生文字列 failureReason を渡しても canonical key で switch される', () => {
    // baseline.failureReason に formalBtFailureReason の生文字列が来ても
    // normalizeFailureReason 経由で正しく judgeLowPf に流れることを確認
    const baseline: RepairOutcomeBaseline = {
      candidateId: 'src-raw',
      dslId: 'src-raw',
      failureReason: 'pf 0.5 < 1', // canonical key ではない生文字列
      route: 'normal_pass',
      metrics: { pf: 0.5, tradeCount: 30 },
    };
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-raw',
      dslId: 'c-raw',
      repairApplied: trace('low_pf', ['exit']),
      metrics: { pf: 1.3, tradeCount: 30 },
    });
    // 'other' 経路 (= 4 指標総合判定) ではなく low_pf 経路で改善判定される
    expect(out.failureReason).toBe('low_pf');
    expect(out.status).toBe('improved');
    expect(out.reason).toMatch(/pfDelta/);
  });

  it('PR #102 review #1: tradeCount 系の生文字列も insufficient_trades に正規化される', () => {
    const baseline: RepairOutcomeBaseline = {
      candidateId: 'src-tc-raw',
      dslId: 'src-tc-raw',
      failureReason: 'tradeCount 5 < 20',
      route: 'trade_count_rescue',
      metrics: { tradeCount: 5 },
    };
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-tc-raw',
      dslId: 'c-tc-raw',
      repairApplied: trace('insufficient_trades', ['entry']),
      metrics: { tradeCount: 25 },
    });
    expect(out.failureReason).toBe('insufficient_trades');
    expect(out.status).toBe('improved');
  });

  it('repairApplied trace がない child は unknown', () => {
    const baseline = baselineFor('low_pf', { pf: 0.7 });
    const out = evaluateRepairOutcome(baseline, {
      candidateId: 'c-no-trace',
      dslId: 'c-no-trace',
      metrics: { pf: 1.5 },
    });
    expect(out.status).toBe('unknown');
    expect(out.reason).toMatch(/trace/);
  });
});

describe('repairOutcomeTelemetry.summarizeRepairOutcomes', () => {
  function makeOutcome(
    status: RepairOutcome['status'],
    failureReason: string,
    targets: string[],
    route: string,
  ): RepairOutcome {
    return {
      childCandidateId: `c-${Math.random()}`,
      childDslId: `c-${Math.random()}`,
      sourceCandidateId: 'src',
      failureReason,
      route,
      targets,
      status,
      deltas: { pfDelta: null, tradeCountDelta: null, maxDrawdownDelta: null, expectancyDelta: null },
      reason: 'test',
      warnings: [],
    };
  }

  it('13. failureReason ごとに集計する', () => {
    const out = summarizeRepairOutcomes([
      makeOutcome('improved', 'low_pf', ['exit'], 'novelty_rescue'),
      makeOutcome('worsened', 'low_pf', ['exit'], 'novelty_rescue'),
      makeOutcome('improved', 'insufficient_trades', ['entry'], 'trade_count_rescue'),
    ]);
    expect(out.attempted).toBe(3);
    expect(out.improved).toBe(2);
    expect(out.worsened).toBe(1);
    expect(out.byFailureReason.low_pf).toEqual({
      attempted: 2,
      improved: 1,
      worsened: 1,
      unchanged: 0,
      unknown: 0,
    });
    expect(out.byFailureReason.insufficient_trades).toEqual({
      attempted: 1,
      improved: 1,
      worsened: 0,
      unchanged: 0,
      unknown: 0,
    });
  });

  it('14. target ごとに集計する (複数 target は先頭のみ)', () => {
    const out = summarizeRepairOutcomes([
      makeOutcome('improved', 'low_pf', ['exit', 'filters'], 'novelty_rescue'),
      makeOutcome('worsened', 'low_pf', ['exit'], 'novelty_rescue'),
    ]);
    expect(out.byActionTarget.exit).toEqual({
      attempted: 2,
      improved: 1,
      worsened: 1,
      unchanged: 0,
      unknown: 0,
    });
    // 複数 target の 2 番目 'filters' は集計に含まない (重複回避)
    expect(out.byActionTarget.filters).toBeUndefined();
  });

  it('15. route ごとに集計する', () => {
    const out = summarizeRepairOutcomes([
      makeOutcome('improved', 'low_pf', ['exit'], 'novelty_rescue'),
      makeOutcome('improved', 'insufficient_trades', ['entry'], 'trade_count_rescue'),
      makeOutcome('unknown', 'other', [], ''),
    ]);
    expect(out.byRoute.novelty_rescue.attempted).toBe(1);
    expect(out.byRoute.trade_count_rescue.attempted).toBe(1);
    expect(out.byRoute.unknown.attempted).toBe(1);
  });

  it('16. targets が空の場合 unknown bucket に入る', () => {
    const out = summarizeRepairOutcomes([
      makeOutcome('unchanged', 'other', [], 'novelty_rescue'),
    ]);
    expect(out.byActionTarget.unknown).toEqual({
      attempted: 1,
      improved: 0,
      worsened: 0,
      unchanged: 1,
      unknown: 0,
    });
  });

  it('入力空でも例外を投げず 0 集計を返す', () => {
    const out = summarizeRepairOutcomes([]);
    expect(out.attempted).toBe(0);
    expect(out.byFailureReason).toEqual({});
    expect(out.byActionTarget).toEqual({});
    expect(out.byRoute).toEqual({});
  });
});

describe('repairOutcomeTelemetry.buildRepairAppliedTrace', () => {
  it('複数親に repairHint がある場合 severity が最も高いものを代表に採用する', () => {
    const hintLow = createRepairHintV1({
      candidateId: 'p-low',
      failureReason: 'other',
    });
    const hintHigh = createRepairHintV1({
      candidateId: 'p-high',
      failureReason: 'analysis_engine_timeout',
    });
    const t = buildRepairAppliedTrace(['p-low', 'p-high'], new Map([
      ['p-low', hintLow],
      ['p-high', hintHigh],
    ]));
    expect(t).toBeDefined();
    expect(t?.sourceCandidateId).toBe('p-high');
    expect(t?.severity).toBe('high');
    expect(t?.failureReason).toBe('analysis_engine_timeout');
  });

  it('shouldUseForRepairMutation=false の親は trace 対象外', () => {
    const fatal = createRepairHintV1({
      candidateId: 'p-fatal',
      failureReason: 'dsl_missing',
    });
    expect(fatal.shouldUseForRepairMutation).toBe(false);
    const t = buildRepairAppliedTrace(['p-fatal'], new Map([['p-fatal', fatal]]));
    expect(t).toBeUndefined();
  });

  it('repairHints が空 / parentIds が空なら undefined', () => {
    expect(buildRepairAppliedTrace([], new Map())).toBeUndefined();
    expect(buildRepairAppliedTrace(['p1'], new Map())).toBeUndefined();
  });

  it('baselines があれば sourceDslId / route を埋める', () => {
    const hint = createRepairHintV1({
      candidateId: 'p1',
      failureReason: 'low_pf',
      metrics: { pf: 0.7 },
    });
    const baselines = new Map([
      [
        'p1',
        {
          candidateId: 'p1',
          dslId: 'dsl-p1',
          failureReason: 'low_pf',
          route: 'novelty_rescue',
          metrics: { pf: 0.7 },
        },
      ],
    ]);
    const t = buildRepairAppliedTrace(['p1'], new Map([['p1', hint]]), baselines);
    expect(t?.sourceDslId).toBe('dsl-p1');
    expect(t?.route).toBe('novelty_rescue');
  });
});
