/**
 * 進化ループ再設計 Phase 4: 確証ゲート（confirmation gate）しきい値の単一集約。
 *
 * 設計（docs/diagnostics/evolution_loop_redesign_plan_2026-06-02.html §2-5 / §5）:
 * - 「探索ゲート（緩め・多様性温存）」と「確証ゲート（コスト込み厳格）」の 2 段に集約。
 * - 確証ゲートは **必ずコスト込み**で 6 指標を評価し、各々に閾値を持つ。
 * - 既存の散在しきい値（validationThresholds / evolutionPromotionThresholds）に対し、
 *   本ファイルを「確証ゲートの単一の正」とする。
 *
 * ベストプラクティス推奨値（2026-06-02 Web 調査、全てコスト込み）:
 *   PF ≥ 1.5（>5.0 は過学習警告）/ Sharpe ≥ 1.0 / RecoveryFactor ≥ 2.0 /
 *   MaxDD ≤ 20% / TradeCount ≥ 100（最低 50）/ WinRate は単独閾値なし（表示のみ）。
 *   過学習 = DSR をゲート化（dsr > 0 で N 試行補正後も有意）。
 *
 * 運用調整しやすいよう env で外部化。本 PR では「観測のみ」（enforce は別 PR でフラグ接続）。
 */

function parseNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number env ${name}=${raw}`);
  }
  return parsed;
}

function parseInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer env ${name}=${raw}`);
  }
  return parsed;
}

export const CONFIRMATION_GATE_THRESHOLDS = Object.freeze({
  /** プロフィットファクター下限（コスト込み）。プロ級は 2.0〜5.0。 */
  minProfitFactor: parseNumber('CG_MIN_PF', 1.5),
  /** これを超える PF は過学習警告（合否は別途、警告フラグのみ）。 */
  overfitProfitFactorWarning: parseNumber('CG_OVERFIT_PF_WARN', 5.0),
  /** シャープレシオ下限（リスク調整後リターン）。>2 で優秀。 */
  minSharpe: parseNumber('CG_MIN_SHARPE', 1.0),
  /** リカバリーファクター下限（純益/最大DD）。プロ級ライン。 */
  minRecoveryFactor: parseNumber('CG_MIN_RECOVERY_FACTOR', 2.0),
  /** 最大ドローダウン上限（%、絶対値）。最重要のリスク指標。 */
  maxDrawdownPct: parseNumber('CG_MAX_DD_PCT', 20),
  /** トレード数下限（統計的有意性）。推奨 100、最低 50。 */
  minTradeCount: parseInteger('CG_MIN_TRADES', 100),
  /** Deflated Sharpe Ratio 下限（N 試行補正後の有意性）。dsr > これ で合格。 */
  minDsr: parseNumber('CG_MIN_DSR', 0),
});

export type ConfirmationGateThresholds = typeof CONFIRMATION_GATE_THRESHOLDS;
