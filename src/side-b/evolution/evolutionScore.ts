/**
 * Phase 5 進化ループ用スコア（検証期間の成績を主に使用）
 *
 * @see docs/design/phase_5_specification.md §5.3
 */

import type { BacktestResultSummary } from '../../backend/services/backtestCalculations';

/**
 * 検証期間サマリーから合成スコアを計算
 * score = PF * 0.4 + winRate * 0.2 + min(tradeCount, 100) * 0.002 + avgRR * 0.2
 */
export function scoreFromValidationSummary(s: BacktestResultSummary): number {
  const pf = Number.isFinite(s.profitFactor) && s.profitFactor !== Number.POSITIVE_INFINITY
    ? Math.min(s.profitFactor, 10)
    : 0;
  const winRate = s.winRate;
  const tradePart = Math.min(s.totalTrades, 100) * 0.002;
  const rr = Number.isFinite(s.riskRewardRatio) ? Math.min(s.riskRewardRatio, 5) : 0;
  return pf * 0.4 + winRate * 0.2 + tradePart + rr * 0.2;
}
