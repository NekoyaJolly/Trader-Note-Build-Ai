/**
 * 進化ループ再設計 Phase 4: evaluateConfirmationGate のユニットテスト。
 */

import { evaluateConfirmationGate } from '../../evolution/confirmationGate';
import { CONFIRMATION_GATE_THRESHOLDS } from '../../config/confirmationGateThresholds';

const T = CONFIRMATION_GATE_THRESHOLDS;

/** 全 5 コア指標をクリアするメトリクス。 */
function passingMetrics() {
  return {
    pf: 1.8,
    winRate: 0.45,
    tradeCount: 120,
    maxDrawdown: -15, // |15| <= 20
    sharpe: 1.2,
    recoveryFactor: 2.5,
  };
}

describe('evaluateConfirmationGate', () => {
  it('全コア指標クリア + DSR>0 で passed=true', () => {
    const r = evaluateConfirmationGate(passingMetrics(), { dsr: 0.5 });
    expect(r.corePassed).toBe(true);
    expect(r.passed).toBe(true);
    expect(r.checks.profitFactor.pass).toBe(true);
    expect(r.checks.maxDrawdown.pass).toBe(true);
    expect(r.overfitWarning).toBe(false);
  });

  it('DSR<=0 なら corePassed=true でも passed=false（DSR ゲート）', () => {
    const r = evaluateConfirmationGate(passingMetrics(), { dsr: -3.0 });
    expect(r.corePassed).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.checks.dsr.pass).toBe(false);
  });

  it('DSR は厳密不等号（dsr=minDsr=0 は境界で不合格）', () => {
    const r = evaluateConfirmationGate(passingMetrics(), { dsr: 0 });
    expect(r.checks.dsr.comparator).toBe('>');
    expect(r.checks.dsr.pass).toBe(false);
    expect(r.passed).toBe(false);
  });

  it('PF 不足は profitFactor.pass=false + corePassed=false', () => {
    const r = evaluateConfirmationGate({ ...passingMetrics(), pf: 1.2 }, { dsr: 1 });
    expect(r.checks.profitFactor.pass).toBe(false);
    expect(r.corePassed).toBe(false);
    expect(r.passed).toBe(false);
  });

  it('maxDD は符号に依らず絶対値で判定（-25% は超過、-18% は OK）', () => {
    expect(
      evaluateConfirmationGate({ ...passingMetrics(), maxDrawdown: -25 }, { dsr: 1 }).checks
        .maxDrawdown.pass,
    ).toBe(false);
    expect(
      evaluateConfirmationGate({ ...passingMetrics(), maxDrawdown: -18 }, { dsr: 1 }).checks
        .maxDrawdown.pass,
    ).toBe(true);
  });

  it('tradeCount < 下限 は不合格（少数サンプル過信防止）', () => {
    const r = evaluateConfirmationGate({ ...passingMetrics(), tradeCount: 40 }, { dsr: 1 });
    expect(r.checks.tradeCount.pass).toBe(false);
    expect(r.checks.tradeCount.threshold).toBe(T.minTradeCount);
  });

  it('PF > 過学習警告ライン(>5) で overfitWarning=true + note', () => {
    const r = evaluateConfirmationGate({ ...passingMetrics(), pf: 6.5 }, { dsr: 1 });
    expect(r.overfitWarning).toBe(true);
    expect(r.notes.some((n) => n.includes('過学習警告'))).toBe(true);
  });

  it('sharpe / recoveryFactor 未取得は available=false + pass=false', () => {
    const r = evaluateConfirmationGate(
      { pf: 1.8, winRate: 0.5, tradeCount: 120, maxDrawdown: -10, sharpe: null, recoveryFactor: undefined },
      { dsr: 1 },
    );
    expect(r.checks.sharpe.available).toBe(false);
    expect(r.checks.sharpe.pass).toBe(false);
    expect(r.checks.recoveryFactor.available).toBe(false);
    expect(r.corePassed).toBe(false);
    expect(r.notes.some((n) => n.includes('sharpe 未取得'))).toBe(true);
  });

  it('DSR 計算不能（notComputable）は dsr.pass=false + note、corePassed は独立', () => {
    const r = evaluateConfirmationGate(passingMetrics(), { dsr: 0, notComputable: 'sample size < 2' });
    expect(r.checks.dsr.available).toBe(false);
    expect(r.checks.dsr.pass).toBe(false);
    expect(r.corePassed).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.notes.some((n) => n.includes('DSR 計算不能'))).toBe(true);
  });

  it('dsr=null（未計算）は passed=false だが corePassed は評価され、note が付く', () => {
    const r = evaluateConfirmationGate(passingMetrics(), null);
    expect(r.checks.dsr.available).toBe(false);
    expect(r.corePassed).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.notes.some((n) => n.includes('DSR 未計算'))).toBe(true);
  });

  it('winRate は閾値なしで値をそのまま surface', () => {
    const r = evaluateConfirmationGate({ ...passingMetrics(), winRate: 0.31 }, { dsr: 1 });
    expect(r.winRate).toBe(0.31);
  });
});
