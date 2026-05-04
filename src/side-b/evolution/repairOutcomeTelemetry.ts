/**
 * RepairHint Outcome Telemetry v1 (Critical-4 PR #102)
 *
 * 目的: PR #100 で導入した RepairHint が mutation 経由で実際に改善へつながったかを
 *   deterministic に判定し、`improved / worsened / unchanged / unknown` の集計を
 *   `GenerationReport / smoke` で観測可能にする。
 *
 * 方針 (設計書 §基本方針):
 *   - LLM に「効いたか」を推測させない。metrics 差分から決定論的に判定する
 *   - baseline がない / child metrics がない / RepairHint trace がない場合は `unknown`
 *   - 微差 (= 閾値未満) は `unchanged` 扱いにし、ノイズで improved/worsened を出さない
 *   - outcome は **観測のみ**。candidate の評価・昇格・採用には絶対に影響させない
 *   - mutation budget / 親選抜重みの自動調整は将来 PR (= telemetry に基づく制御)
 *
 * スコープ外:
 *   - DB migration / EdgeStatus 拡張 / Promotion Gate (= PR #101 で別実装済)
 *   - LLM による outcome 判定 / QualityDiversityArchive / OOS / walk-forward
 *
 * @see docs/design/pr_102_repair_hint_outcome_telemetry_agent_prompt.md
 */

import { normalizeFailureReason, type RepairHint } from './repairHintPolicy';

// =================================================================
// 型定義 (設計書 §型定義)
// =================================================================

/** RepairHint 適用後の結果判定。 */
export type RepairOutcomeStatus = 'improved' | 'worsened' | 'unchanged' | 'unknown';

/** 親または失敗元と子候補の metrics 差分 (child - baseline)。 */
export interface RepairOutcomeMetricDelta {
  pfDelta: number | null;
  tradeCountDelta: number | null;
  maxDrawdownDelta: number | null;
  expectancyDelta: number | null;
}

/** 比較元の metrics (= 前世代の failed candidate)。 */
export interface RepairOutcomeBaseline {
  candidateId: string;
  dslId?: string;
  failureReason: string;
  route?: string;
  metrics: {
    pf?: number | null;
    tradeCount?: number | null;
    maxDrawdown?: number | null;
    expectancy?: number | null;
  };
}

/**
 * mutation child に紐づく RepairHint 適用トレース。
 *
 * StrategyDSL.metadata schema を変更せずに観測したいため、EvolutionLoop 内で
 * generation-local Map<dslId, RepairAppliedTrace> として保持する。DB 永続化はしない。
 */
export interface RepairAppliedTrace {
  sourceCandidateId: string;
  sourceDslId?: string;
  failureReason: string;
  route?: string;
  severity: string;
  targets: string[];
  actionSummaries: string[];
}

/** RepairHint 適用後の観測結果。 */
export interface RepairOutcome {
  childCandidateId: string;
  childDslId: string;
  sourceCandidateId: string;
  sourceDslId?: string;
  failureReason: string;
  route: string;
  targets: string[];
  status: RepairOutcomeStatus;
  deltas: RepairOutcomeMetricDelta;
  reason: string;
  warnings: string[];
}

/** failureReason / target / route ごとの集計 bucket。 */
export interface RepairOutcomeSummaryBucket {
  attempted: number;
  improved: number;
  worsened: number;
  unchanged: number;
  unknown: number;
}

/** GenerationReport / smoke に出す summary。 */
export interface RepairOutcomeSummary {
  attempted: number;
  improved: number;
  worsened: number;
  unchanged: number;
  unknown: number;
  byFailureReason: Record<string, RepairOutcomeSummaryBucket>;
  byActionTarget: Record<string, RepairOutcomeSummaryBucket>;
  byRoute: Record<string, RepairOutcomeSummaryBucket>;
  warnings: string[];
}

// =================================================================
// 閾値 (設計書 §unchanged 判定)
// =================================================================

/**
 * 微差を improved / worsened にしないための最小差分閾値。
 *
 * scale 注意 (PR #102 review #2):
 * - `pf`: 0-N の絶対比率。0.02 ≈ 「PF 1.10 → 1.12 は unchanged」
 * - `tradeCount`: 整数件数
 * - `expectancy`: 1 トレードあたり期待値 (絶対値)、0.0001 程度を最小単位とする
 * - `maxDrawdown`: **analysis-engine `summary.maxDD` は百分率 (%)** で返る
 *   (= engine_protocol.BTSummary.max_dd: Optional[float]  # %)。
 *   よって 0.5 = 0.5%pt が最小単位。0.01 にすると 30%→29.99% を改善扱いしてしまい
 *   drawdown 由来の outcome がノイズだらけになる。
 *
 * 異なる scale (= rate 0-1 等) で metrics を渡す場合は呼び出し側で正規化する。
 */
export const repairOutcomeThresholds = {
  pfMinDelta: 0.02,
  expectancyMinDelta: 0.0001,
  maxDrawdownMinDelta: 0.5,
  tradeCountMinDelta: 1,
} as const;

// =================================================================
// trace ビルダー (mutation child の parentIds から RepairAppliedTrace を生成)
// =================================================================

const SEVERITY_ORDER: Record<string, number> = {
  fatal: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * mutation child の `parentIds` と前世代の RepairHint Map を突き合わせ、
 * 代表となる `RepairAppliedTrace` を生成する。
 *
 * 複数親が repairHint を持つ場合は severity が最も高いものを代表に採用する。
 * 該当親が `shouldUseForRepairMutation=false` (= fatal 系) の場合はトレース対象外
 * (= MutationAgent 側で elites から既に除外されているはずだが防御的に弾く)。
 *
 * 該当が無ければ undefined を返す (= 通常の random mutation child)。
 */
export function buildRepairAppliedTrace(
  parentIds: readonly string[],
  repairHints: ReadonlyMap<string, RepairHint>,
  baselines?: ReadonlyMap<string, RepairOutcomeBaseline>,
): RepairAppliedTrace | undefined {
  if (repairHints.size === 0 || parentIds.length === 0) return undefined;

  let best: { id: string; hint: RepairHint } | undefined;
  for (const id of parentIds) {
    const hint = repairHints.get(id);
    if (!hint || !hint.shouldUseForRepairMutation) continue;
    if (
      !best ||
      (SEVERITY_ORDER[hint.severity] ?? 0) > (SEVERITY_ORDER[best.hint.severity] ?? 0)
    ) {
      best = { id, hint };
    }
  }
  if (!best) return undefined;

  const baseline = baselines?.get(best.id);
  return {
    sourceCandidateId: best.id,
    sourceDslId: baseline?.dslId,
    failureReason: best.hint.failureReason,
    route: baseline?.route,
    severity: best.hint.severity,
    targets: best.hint.actions.map((a) => a.target),
    actionSummaries: best.hint.actions.map((a) => a.instruction),
  };
}

// =================================================================
// outcome 判定
// =================================================================

interface ChildEvalInput {
  candidateId: string;
  dslId: string;
  route?: string;
  repairApplied?: RepairAppliedTrace;
  metrics?: {
    pf?: number | null;
    tradeCount?: number | null;
    maxDrawdown?: number | null;
    expectancy?: number | null;
  };
  /**
   * child が formal BT で error / timeout に終わった場合の理由文字列。
   * 設計書 §analysis_engine_timeout / §analysis_engine_error の判定で使う。
   */
  failureReason?: string;
}

function diff(a: number | null | undefined, b: number | null | undefined): number | null {
  if (typeof a !== 'number' || !Number.isFinite(a)) return null;
  if (typeof b !== 'number' || !Number.isFinite(b)) return null;
  return a - b;
}

function emptyDeltas(): RepairOutcomeMetricDelta {
  return {
    pfDelta: null,
    tradeCountDelta: null,
    maxDrawdownDelta: null,
    expectancyDelta: null,
  };
}

function buildDeltas(
  baseline: RepairOutcomeBaseline,
  child: ChildEvalInput,
): RepairOutcomeMetricDelta {
  const m = child.metrics;
  if (!m) return emptyDeltas();
  return {
    pfDelta: diff(m.pf, baseline.metrics.pf),
    tradeCountDelta: diff(m.tradeCount, baseline.metrics.tradeCount),
    maxDrawdownDelta: diff(m.maxDrawdown, baseline.metrics.maxDrawdown),
    expectancyDelta: diff(m.expectancy, baseline.metrics.expectancy),
  };
}

/** unknown を作るヘルパー (理由文字列 + 任意の warnings 付き)。 */
function unknownOutcome(
  child: ChildEvalInput,
  baseline: RepairOutcomeBaseline | null,
  reason: string,
  warnings: string[] = [],
): RepairOutcome {
  return {
    childCandidateId: child.candidateId,
    childDslId: child.dslId,
    sourceCandidateId: baseline?.candidateId ?? child.repairApplied?.sourceCandidateId ?? 'unknown',
    sourceDslId: baseline?.dslId ?? child.repairApplied?.sourceDslId,
    failureReason:
      baseline?.failureReason ?? child.repairApplied?.failureReason ?? 'other',
    route: baseline?.route ?? child.repairApplied?.route ?? child.route ?? 'unknown',
    targets: child.repairApplied?.targets ?? [],
    status: 'unknown',
    deltas: baseline && child.metrics ? buildDeltas(baseline, child) : emptyDeltas(),
    reason,
    warnings,
  };
}

/** insufficient_trades の主指標は tradeCount 増加。 */
function judgeInsufficientTrades(
  baseline: RepairOutcomeBaseline,
  child: ChildEvalInput,
  deltas: RepairOutcomeMetricDelta,
): { status: RepairOutcomeStatus; reason: string; warnings: string[] } {
  const warnings: string[] = [];
  const dt = deltas.tradeCountDelta;
  if (dt === null) {
    return {
      status: 'unknown',
      reason: 'tradeCount delta が比較不能',
      warnings,
    };
  }
  // PF が極端に悪化していれば warning
  if (
    typeof child.metrics?.pf === 'number' &&
    typeof baseline.metrics.pf === 'number' &&
    child.metrics.pf < baseline.metrics.pf - repairOutcomeThresholds.pfMinDelta * 4
  ) {
    warnings.push('tradeCount は変化したが PF が大きく悪化');
  }
  if (dt >= repairOutcomeThresholds.tradeCountMinDelta) {
    const strong =
      baseline.metrics.tradeCount === 0 && (child.metrics?.tradeCount ?? 0) > 0;
    return {
      status: 'improved',
      reason: strong
        ? `tradeCount 0→${child.metrics?.tradeCount ?? 0} (強い改善)`
        : `tradeCountDelta=${dt}`,
      warnings,
    };
  }
  if (dt <= -repairOutcomeThresholds.tradeCountMinDelta) {
    return {
      status: 'worsened',
      reason: `tradeCountDelta=${dt}`,
      warnings,
    };
  }
  return {
    status: 'unchanged',
    reason: `tradeCountDelta=${dt} (閾値未満)`,
    warnings,
  };
}

/** low_pf の主指標は pf 改善。 */
function judgeLowPf(
  baseline: RepairOutcomeBaseline,
  child: ChildEvalInput,
  deltas: RepairOutcomeMetricDelta,
): { status: RepairOutcomeStatus; reason: string; warnings: string[] } {
  const warnings: string[] = [];
  const dp = deltas.pfDelta;
  if (dp === null) {
    return { status: 'unknown', reason: 'pf delta が比較不能', warnings };
  }
  // tradeCount が大幅減少なら warning
  if (
    typeof child.metrics?.tradeCount === 'number' &&
    typeof baseline.metrics.tradeCount === 'number' &&
    baseline.metrics.tradeCount - child.metrics.tradeCount >= 5
  ) {
    warnings.push('PF は変化したが tradeCount が大幅減少');
  }
  if (dp >= repairOutcomeThresholds.pfMinDelta) {
    return { status: 'improved', reason: `pfDelta=${dp.toFixed(3)}`, warnings };
  }
  if (dp <= -repairOutcomeThresholds.pfMinDelta) {
    return { status: 'worsened', reason: `pfDelta=${dp.toFixed(3)}`, warnings };
  }
  return { status: 'unchanged', reason: `pfDelta=${dp.toFixed(3)} (閾値未満)`, warnings };
}

/** analysis_engine_timeout / _error: child が完走できれば improved、また失敗なら worsened。 */
function judgeAnalysisEngine(
  child: ChildEvalInput,
  isTimeout: boolean,
): { status: RepairOutcomeStatus; reason: string; warnings: string[] } {
  const childFailedSame = (() => {
    const r = (child.failureReason ?? '').toLowerCase();
    if (isTimeout && (r.includes('timeout') || r.includes('timed out'))) return true;
    if (!isTimeout && r.includes('analysis-engine')) return true;
    return false;
  })();
  if (child.metrics && Number.isFinite(child.metrics.pf ?? NaN)) {
    return {
      status: 'improved',
      reason: 'analysis-engine が完走 (metrics 取得済)',
      warnings: [],
    };
  }
  if (childFailedSame) {
    return {
      status: 'worsened',
      reason: 'child も同種の analysis-engine 失敗',
      warnings: [],
    };
  }
  return {
    status: 'unknown',
    reason: 'child の analysis-engine 結果が比較不能',
    warnings: [],
  };
}

/** other: 比較可能な指標の総合判定。矛盾は unchanged / unknown。 */
function judgeOther(
  deltas: RepairOutcomeMetricDelta,
): { status: RepairOutcomeStatus; reason: string; warnings: string[] } {
  const signals: Array<{ name: string; sign: 1 | -1 | 0 }> = [];
  if (deltas.pfDelta !== null) {
    const v = deltas.pfDelta;
    signals.push({
      name: 'pf',
      sign:
        v >= repairOutcomeThresholds.pfMinDelta ? 1
        : v <= -repairOutcomeThresholds.pfMinDelta ? -1
        : 0,
    });
  }
  if (deltas.tradeCountDelta !== null) {
    const v = deltas.tradeCountDelta;
    signals.push({
      name: 'tradeCount',
      sign:
        v >= repairOutcomeThresholds.tradeCountMinDelta ? 1
        : v <= -repairOutcomeThresholds.tradeCountMinDelta ? -1
        : 0,
    });
  }
  if (deltas.expectancyDelta !== null) {
    const v = deltas.expectancyDelta;
    signals.push({
      name: 'expectancy',
      sign:
        v >= repairOutcomeThresholds.expectancyMinDelta ? 1
        : v <= -repairOutcomeThresholds.expectancyMinDelta ? -1
        : 0,
    });
  }
  if (deltas.maxDrawdownDelta !== null) {
    // maxDrawdown は小さい方が良い → 符号反転
    const v = deltas.maxDrawdownDelta;
    signals.push({
      name: 'maxDD',
      sign:
        v <= -repairOutcomeThresholds.maxDrawdownMinDelta ? 1
        : v >= repairOutcomeThresholds.maxDrawdownMinDelta ? -1
        : 0,
    });
  }
  if (signals.length === 0) {
    return { status: 'unknown', reason: '比較可能な指標なし', warnings: [] };
  }
  const positives = signals.filter((s) => s.sign === 1);
  const negatives = signals.filter((s) => s.sign === -1);
  if (positives.length > 0 && negatives.length === 0) {
    return {
      status: 'improved',
      reason: `${positives.map((s) => s.name).join(',')} 改善`,
      warnings: [],
    };
  }
  if (negatives.length > 0 && positives.length === 0) {
    return {
      status: 'worsened',
      reason: `${negatives.map((s) => s.name).join(',')} 悪化`,
      warnings: [],
    };
  }
  if (positives.length > 0 && negatives.length > 0) {
    return {
      status: 'unchanged',
      reason: '指標が矛盾 (保守的に unchanged)',
      warnings: [],
    };
  }
  return { status: 'unchanged', reason: '全指標が閾値未満', warnings: [] };
}

/**
 * RepairHint 適用後の outcome を deterministic に判定する。
 *
 * 設計書 §基本ルール / §failureReason 別の改善判定 に従う。
 * baseline / child / trace のいずれかが欠ける場合は無理に判定せず `unknown` を返す。
 *
 * 例外: `analysis_engine_timeout` / `analysis_engine_error` は metrics 欠落でも
 *   child の `failureReason` から判定可能 (= child も同種失敗 → worsened)。
 */
export function evaluateRepairOutcome(
  baseline: RepairOutcomeBaseline | null,
  child: ChildEvalInput,
): RepairOutcome {
  if (!child.repairApplied) {
    return unknownOutcome(child, baseline, 'repairApplied trace なし');
  }
  if (!baseline) {
    return unknownOutcome(child, null, 'baseline なし');
  }
  // PR #102 review #1: scheduler が外部から baseline を注入するとき、
  // `baseline.failureReason` には `formalBtFailureReason` の生文字列
  // (例: "pf 0.5 < 1", "tradeCount 5 < 20") が入る可能性がある。canonical key
  // (insufficient_trades / low_pf / 等) へ正規化しないと switch が default (= other)
  // に流れて outcome が誤分類される。
  const rawReason = baseline.failureReason || child.repairApplied.failureReason;
  const reason = normalizeFailureReason(rawReason);

  // dsl_missing は PR #100 で fatal、本来 mutation 対象外。来た場合は warning + unknown。
  if (reason === 'dsl_missing') {
    return unknownOutcome(child, baseline, 'dsl_missing は repair 対象外', [
      'dsl_missing 由来の child が trace 化されている — MutationAgent の除外が機能しているか確認',
    ]);
  }

  // analysis_engine_* は metrics 欠落でも child の failureReason から判定可能。
  // それ以外の reason は metrics 欠落 = 比較不能なので unknown で返す。
  const isAnalysisEngineReason =
    reason === 'analysis_engine_timeout' || reason === 'analysis_engine_error';
  if (!child.metrics && !isAnalysisEngineReason) {
    return unknownOutcome(child, baseline, 'child metrics なし');
  }

  const deltas = child.metrics ? buildDeltas(baseline, child) : emptyDeltas();

  let judgement: { status: RepairOutcomeStatus; reason: string; warnings: string[] };
  switch (reason) {
    case 'insufficient_trades':
      judgement = judgeInsufficientTrades(baseline, child, deltas);
      break;
    case 'low_pf':
      judgement = judgeLowPf(baseline, child, deltas);
      break;
    case 'analysis_engine_timeout':
      judgement = judgeAnalysisEngine(child, true);
      break;
    case 'analysis_engine_error':
      judgement = judgeAnalysisEngine(child, false);
      break;
    case 'other':
    default:
      judgement = judgeOther(deltas);
      break;
  }

  return {
    childCandidateId: child.candidateId,
    childDslId: child.dslId,
    sourceCandidateId: baseline.candidateId,
    sourceDslId: baseline.dslId,
    failureReason: reason,
    route: baseline.route ?? child.route ?? child.repairApplied.route ?? 'unknown',
    targets: child.repairApplied.targets,
    status: judgement.status,
    deltas,
    reason: judgement.reason,
    warnings: judgement.warnings,
  };
}

// =================================================================
// summary 集計
// =================================================================

function emptyBucket(): RepairOutcomeSummaryBucket {
  return { attempted: 0, improved: 0, worsened: 0, unchanged: 0, unknown: 0 };
}

function bumpBucket(
  map: Record<string, RepairOutcomeSummaryBucket>,
  key: string,
  status: RepairOutcomeStatus,
): void {
  const k = key.length > 0 ? key : 'unknown';
  if (!map[k]) map[k] = emptyBucket();
  map[k].attempted += 1;
  map[k][status] += 1;
}

/**
 * outcomes を failureReason / target / route 軸で集計する。
 *
 * - target が空配列の child は `'unknown'` バケットに 1 件として入る
 *   (target 別の bucket は重複カウントしない、最初の target のみ)
 */
export function summarizeRepairOutcomes(
  outcomes: ReadonlyArray<RepairOutcome>,
): RepairOutcomeSummary {
  const summary: RepairOutcomeSummary = {
    attempted: outcomes.length,
    improved: 0,
    worsened: 0,
    unchanged: 0,
    unknown: 0,
    byFailureReason: {},
    byActionTarget: {},
    byRoute: {},
    warnings: [],
  };

  for (const o of outcomes) {
    summary[o.status] += 1;
    bumpBucket(summary.byFailureReason, o.failureReason || 'unknown', o.status);
    bumpBucket(summary.byRoute, o.route || 'unknown', o.status);
    if (o.targets.length === 0) {
      bumpBucket(summary.byActionTarget, 'unknown', o.status);
    } else {
      // 複数 target は最初の 1 つだけ集計対象 (重複カウント回避、観測精度十分)
      bumpBucket(summary.byActionTarget, o.targets[0], o.status);
    }
    if (o.warnings.length > 0) {
      for (const w of o.warnings) summary.warnings.push(w);
    }
  }

  return summary;
}
