/**
 * 進化ループ再設計 Phase 4: 確証ゲート（confirmation gate）の純粋評価器。
 *
 * 設計 §2-5: 確証ゲートは **コスト込み**で 6 指標を各閾値で評価する。
 *   PF / Sharpe / RecoveryFactor / MaxDD / TradeCount（+ 過学習ガードの DSR）。
 *   WinRate は単独閾値を置かず表示のみ（RR 次第で低勝率でも可）。
 *
 * 本関数は純粋・決定論。EvolutionLoop から各 promotion candidate に対して呼ばれ、
 * 結果は GenerationReport に surface される（本 PR は観測のみ。enforce は別 PR でフラグ接続）。
 */

import {
  CONFIRMATION_GATE_THRESHOLDS,
  type ConfirmationGateThresholds,
} from '../config/confirmationGateThresholds';

/** コスト込み正式 BT 由来のメトリクス（FormalBtMetrics 互換のサブセット）。 */
export interface ConfirmationGateMetricsInput {
  pf: number;
  winRate: number;
  tradeCount: number;
  maxDrawdown?: number | null;
  sharpe?: number | null;
  recoveryFactor?: number | null;
}

/** Deflated Sharpe Ratio の観測値（computeDeflatedSharpeRatio の結果サブセット）。 */
export interface ConfirmationGateDsrInput {
  dsr: number;
  notComputable?: string | null;
}

export interface MetricCheck {
  /** 実測値（未取得は null）。 */
  value: number | null;
  threshold: number;
  comparator: '>=' | '<=' | '>';
  /** メトリクスが取得できたか。 */
  available: boolean;
  /** 閾値クリアしたか（available=false なら false）。 */
  pass: boolean;
}

export interface ConfirmationGateResult {
  /** 6 指標（DSR 含む）全て pass か。 */
  passed: boolean;
  /** DSR を除く 5 指標（PF/Sharpe/RecoveryF/MaxDD/TradeCount）が pass か。 */
  corePassed: boolean;
  checks: {
    profitFactor: MetricCheck;
    sharpe: MetricCheck;
    recoveryFactor: MetricCheck;
    maxDrawdown: MetricCheck;
    tradeCount: MetricCheck;
    dsr: MetricCheck;
  };
  /** 表示のみ（閾値なし）。 */
  winRate: number;
  /** PF が過学習警告ライン（既定 >5.0）を超えたか。 */
  overfitWarning: boolean;
  notes: string[];
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function geCheck(value: number | null | undefined, threshold: number): MetricCheck {
  const num = finiteOrNull(value);
  return {
    value: num,
    threshold,
    comparator: '>=',
    available: num !== null,
    pass: num !== null && num >= threshold,
  };
}

/** maxDD は符号ゆれ（負値で返る engine もある）を吸収して |maxDD| <= 上限 で判定。 */
function maxDrawdownCheck(value: number | null | undefined, threshold: number): MetricCheck {
  const num = finiteOrNull(value);
  return {
    value: num,
    threshold,
    comparator: '<=',
    available: num !== null,
    pass: num !== null && Math.abs(num) <= threshold,
  };
}

/**
 * 確証ゲートを評価する。`passed` は DSR 含む全 6 指標、`corePassed` は DSR 除く 5 指標。
 * 未取得メトリクスは pass=false（確証できないため保守的に不合格扱い）。
 */
export function evaluateConfirmationGate(
  metrics: ConfirmationGateMetricsInput,
  dsr: ConfirmationGateDsrInput | null,
  thresholds: ConfirmationGateThresholds = CONFIRMATION_GATE_THRESHOLDS,
): ConfirmationGateResult {
  const profitFactor = geCheck(metrics.pf, thresholds.minProfitFactor);
  const sharpe = geCheck(metrics.sharpe, thresholds.minSharpe);
  const recoveryFactor = geCheck(metrics.recoveryFactor, thresholds.minRecoveryFactor);
  const maxDrawdown = maxDrawdownCheck(metrics.maxDrawdown, thresholds.maxDrawdownPct);
  const tradeCount = geCheck(metrics.tradeCount, thresholds.minTradeCount);

  // DSR: 計算不能（小サンプル / flat returns 等）は pass=false + note。
  // 「N 試行補正後も有意」= dsr > minDsr の **厳密不等号**（dsr=minDsr は境界で不合格）。
  const dsrComputable = dsr !== null && dsr.notComputable == null;
  const dsrCheck: MetricCheck = {
    value: dsr ? dsr.dsr : null,
    threshold: thresholds.minDsr,
    comparator: '>',
    available: dsrComputable,
    pass: dsr !== null && dsr.notComputable == null && dsr.dsr > thresholds.minDsr,
  };

  const notes: string[] = [];
  const overfitWarning =
    profitFactor.available && (profitFactor.value as number) > thresholds.overfitProfitFactorWarning;
  if (overfitWarning) {
    notes.push(
      `PF=${(profitFactor.value as number).toFixed(2)} > ${thresholds.overfitProfitFactorWarning} は過学習警告`,
    );
  }
  if (dsr === null) {
    notes.push('DSR 未計算（trade pnl 不在）');
  } else if (!dsrComputable) {
    notes.push(`DSR 計算不能: ${dsr.notComputable}`);
  }
  for (const [name, c] of Object.entries({
    profitFactor,
    sharpe,
    recoveryFactor,
    maxDrawdown,
    tradeCount,
  })) {
    if (!c.available) notes.push(`${name} 未取得（確証不可）`);
  }

  const coreChecks = [profitFactor, sharpe, recoveryFactor, maxDrawdown, tradeCount];
  const corePassed = coreChecks.every((c) => c.pass);

  return {
    passed: corePassed && dsrCheck.pass,
    corePassed,
    checks: { profitFactor, sharpe, recoveryFactor, maxDrawdown, tradeCount, dsr: dsrCheck },
    winRate: metrics.winRate,
    overfitWarning,
    notes,
  };
}

/** GenerationReport 用の 1 候補ぶん確証ゲート結果（観測 surface 用、軽量）。 */
export interface ConfirmationGateReportEntry {
  dslId: string;
  passed: boolean;
  corePassed: boolean;
  overfitWarning: boolean;
  /** 不合格だったチェック名（'profitFactor' / 'sharpe' / ... / 'dsr'）。 */
  failedMetrics: string[];
}

export interface ConfirmationGateSummary {
  evaluated: number;
  corePassed: number;
  passed: number;
  overfitWarnings: number;
}

/** 確証ゲート結果 → report エントリ（不合格メトリクス名を抽出）。 */
export function toConfirmationGateReportEntry(
  dslId: string,
  result: ConfirmationGateResult,
): ConfirmationGateReportEntry {
  const failedMetrics = Object.entries(result.checks)
    .filter(([, c]) => !c.pass)
    .map(([name]) => name);
  return {
    dslId,
    passed: result.passed,
    corePassed: result.corePassed,
    overfitWarning: result.overfitWarning,
    failedMetrics,
  };
}

export function summarizeConfirmationGate(
  entries: readonly ConfirmationGateReportEntry[],
): ConfirmationGateSummary {
  return {
    evaluated: entries.length,
    corePassed: entries.filter((e) => e.corePassed).length,
    passed: entries.filter((e) => e.passed).length,
    overfitWarnings: entries.filter((e) => e.overfitWarning).length,
  };
}
