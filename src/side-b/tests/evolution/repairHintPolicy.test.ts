/**
 * PR #100: FailureReason → RepairHint v1 の単体テスト。
 *
 * - createRepairHintV1 は deterministic でなければならない
 * - 既存 formalBtFailureReason 自由文字列 (例: "tradeCount 0 < 30") も canonical key へ正規化
 * - dsl_missing 等 fatal 系は repair mutation 対象外 + 親プール除外
 * - 未知 failureReason でも例外を投げず `other` 相当を返す
 * - summarizeRepairHints が failureReason / severity / route ごとに集計される
 */

import {
  createRepairHintV1,
  normalizeFailureReason,
  summarizeRepairHints,
  type RepairHint,
} from '../../evolution/repairHintPolicy';

describe('repairHintPolicy.createRepairHintV1', () => {
  it('insufficient_trades から entry / filters 修復ヒントが生成される', () => {
    const hint = createRepairHintV1({
      candidateId: 'c1',
      failureReason: 'insufficient_trades',
      metrics: { tradeCount: 5 },
    });
    expect(hint.failureReason).toBe('insufficient_trades');
    expect(hint.severity).toBe('medium');
    expect(hint.shouldUseForRepairMutation).toBe(true);
    expect(hint.shouldExcludeFromParentPool).toBe(false);
    const targets = hint.actions.map((a) => a.target);
    expect(targets).toContain('entry');
    expect(targets).toContain('filters');
  });

  it('low_pf から exit / filters 修復ヒントが生成される', () => {
    const hint = createRepairHintV1({
      candidateId: 'c2',
      failureReason: 'low_pf',
      metrics: { pf: 1.0 },
    });
    expect(hint.failureReason).toBe('low_pf');
    expect(hint.severity).toBe('medium');
    const targets = hint.actions.map((a) => a.target);
    expect(targets).toContain('exit');
    expect(targets).toContain('filters');
  });

  it('analysis_engine_timeout から dsl_shape / evaluation_runtime 修復ヒントが生成される', () => {
    const hint = createRepairHintV1({
      candidateId: 'c3',
      failureReason: 'analysis_engine_timeout',
    });
    expect(hint.failureReason).toBe('analysis_engine_timeout');
    expect(hint.severity).toBe('high');
    const targets = hint.actions.map((a) => a.target);
    expect(targets).toContain('dsl_shape');
    expect(targets).toContain('evaluation_runtime');
  });

  it('analysis_engine_error から dsl_shape 修復ヒントが生成される', () => {
    const hint = createRepairHintV1({
      candidateId: 'c4',
      failureReason: 'analysis_engine_error',
    });
    expect(hint.failureReason).toBe('analysis_engine_error');
    expect(hint.severity).toBe('high');
    expect(hint.actions.some((a) => a.target === 'dsl_shape')).toBe(true);
  });

  it('dsl_missing は shouldUseForRepairMutation=false かつ shouldExcludeFromParentPool=true', () => {
    const hint = createRepairHintV1({
      candidateId: 'c5',
      failureReason: 'dsl_missing',
    });
    expect(hint.failureReason).toBe('dsl_missing');
    expect(hint.severity).toBe('fatal');
    expect(hint.shouldUseForRepairMutation).toBe(false);
    expect(hint.shouldExcludeFromParentPool).toBe(true);
    expect(hint.actions[0]?.target).toBe('none');
    expect(hint.actions[0]?.allowedChangeScope).toBe('none');
  });

  it('other は小変更のみ許可される', () => {
    const hint = createRepairHintV1({
      candidateId: 'c6',
      failureReason: 'other',
    });
    expect(hint.failureReason).toBe('other');
    expect(hint.severity).toBe('low');
    expect(hint.actions).toHaveLength(1);
    expect(hint.actions[0]?.target).toBe('parameters');
    expect(hint.actions[0]?.allowedChangeScope).toBe('small');
  });

  it('tradeCount=0 の場合、insufficient_trades の severity が high になり warning が付く', () => {
    const hint = createRepairHintV1({
      candidateId: 'c7',
      failureReason: 'insufficient_trades',
      metrics: { tradeCount: 0 },
    });
    expect(hint.severity).toBe('high');
    expect(hint.warnings.length).toBeGreaterThan(0);
    expect(hint.warnings.some((w) => w.includes('tradeCount=0'))).toBe(true);
  });

  it('pf < 0.8 の場合、low_pf に warning が追加される', () => {
    const hint = createRepairHintV1({
      candidateId: 'c8',
      failureReason: 'low_pf',
      metrics: { pf: 0.5 },
    });
    expect(hint.warnings.length).toBeGreaterThan(0);
    expect(hint.warnings.some((w) => w.includes('PF'))).toBe(true);
  });

  it('未知の failureReason でも例外を投げず other 相当で扱う', () => {
    const hint = createRepairHintV1({
      candidateId: 'c9',
      failureReason: 'some_completely_unknown_failure_xyz',
    });
    expect(hint.failureReason).toBe('other');
    expect(hint.severity).toBe('low');
  });

  it('既存 formalBtFailureReason 自由文字列も canonical key へ正規化される', () => {
    expect(normalizeFailureReason('tradeCount 0 < 30')).toBe('insufficient_trades');
    expect(normalizeFailureReason('pf 0.5 < 1')).toBe('low_pf');
    expect(normalizeFailureReason('analysis-engine BT failed: socket hang up')).toBe(
      'analysis_engine_error',
    );
    expect(normalizeFailureReason('analysis-engine BT failed: request timeout')).toBe(
      'analysis_engine_timeout',
    );
    expect(normalizeFailureReason('schema_validation_failed')).toBe('dsl_missing');
    expect(normalizeFailureReason(undefined)).toBe('other');
    expect(normalizeFailureReason('')).toBe('other');

    // createRepairHintV1 経由でも自由文字列を受け付ける
    const hint = createRepairHintV1({
      candidateId: 'c10',
      failureReason: 'tradeCount 0 < 30',
      metrics: { tradeCount: 0 },
    });
    expect(hint.failureReason).toBe('insufficient_trades');
    expect(hint.severity).toBe('high');
  });

  it('maxDrawdown が大きい場合 risk action が追加される', () => {
    const hint = createRepairHintV1({
      candidateId: 'c11',
      failureReason: 'low_pf',
      metrics: { maxDrawdown: 0.5 },
    });
    expect(hint.actions.some((a) => a.target === 'risk')).toBe(true);
  });

  it('同じ入力に対して deterministic に同じ出力を返す', () => {
    const ctx = {
      candidateId: 'c12',
      failureReason: 'insufficient_trades',
      metrics: { tradeCount: 0, pf: null, maxDrawdown: 0.4 },
    };
    const a = createRepairHintV1(ctx);
    const b = createRepairHintV1(ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('repairHintPolicy.summarizeRepairHints', () => {
  it('failureReason / severity / route ごとに集計される', () => {
    const hints: Array<{ hint: RepairHint; route?: string }> = [
      {
        hint: createRepairHintV1({
          candidateId: 'a',
          failureReason: 'insufficient_trades',
          metrics: { tradeCount: 0 },
        }),
        route: 'trade_count_rescue',
      },
      {
        hint: createRepairHintV1({
          candidateId: 'b',
          failureReason: 'low_pf',
          metrics: { pf: 0.7 },
        }),
        route: 'novelty_rescue',
      },
      {
        hint: createRepairHintV1({
          candidateId: 'c',
          failureReason: 'dsl_missing',
        }),
        route: undefined,
      },
    ];

    const summary = summarizeRepairHints(hints);
    expect(summary.totalFailures).toBe(3);
    expect(summary.repairable).toBe(2);
    expect(summary.excluded).toBe(1);
    expect(summary.byFailureReason.insufficient_trades).toBe(1);
    expect(summary.byFailureReason.low_pf).toBe(1);
    expect(summary.byFailureReason.dsl_missing).toBe(1);
    expect(summary.bySeverity.fatal).toBe(1);
    expect(summary.bySeverity.high).toBe(1); // tradeCount=0 で昇格
    expect(summary.bySeverity.medium).toBe(1);
    expect(summary.bySeverity.low).toBe(0);
    expect(summary.byRoute.trade_count_rescue).toBe(1);
    expect(summary.byRoute.novelty_rescue).toBe(1);
    expect(summary.byRoute.unknown).toBe(1);
    // tradeCount=0 と PF<0.8 から warning が積まれる
    expect(summary.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('入力が空でも例外を投げず 0 集計を返す', () => {
    const summary = summarizeRepairHints([]);
    expect(summary.totalFailures).toBe(0);
    expect(summary.repairable).toBe(0);
    expect(summary.excluded).toBe(0);
    expect(summary.bySeverity).toEqual({ low: 0, medium: 0, high: 0, fatal: 0 });
    expect(summary.byFailureReason).toEqual({});
    expect(summary.byRoute).toEqual({});
    expect(summary.warnings).toEqual([]);
  });
});
