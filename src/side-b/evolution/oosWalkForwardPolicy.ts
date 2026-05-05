/**
 * OOS / Walk-forward v1 (Critical-4 PR #103)
 *
 * 目的: PR #101 の `validation_candidate` (= formal BT 通過済) に対して、未知期間 (OOS)
 *   または時系列分割 (Walk-forward) の評価結果を deterministic に観測可能にする。
 *
 * 方針 (設計書 §基本方針):
 *   - OOS は昇格ではない。`oos_passed` でも `productionEligible=true` にしない
 *   - PR #101 PromotionGate と分離。stage 判定ロジックは触らない
 *   - 時系列順を厳守。ランダム分割 / future leakage は禁止
 *   - baseline missing は 0 補完しない。`deltas` は全 null のまま、warning を出して
 *     絶対閾値だけで `oos_passed / oos_failed` を判定する (= 比較不能 ≠ 評価不能)
 *   - v1 は観測優先。完璧な Walk-forward 最適化は作らない
 *
 * スコープ外:
 *   - DB migration / EdgeStatus 拡張 / production_ready 自動昇格
 *   - mutation budget / parent pool 比率の自動調整
 *   - LLM による OOS 判定 / fold 単位のパラメータ最適化
 *
 * @see docs/design/pr_103_oos_walkforward_v_1_agent_prompt.md
 */

// =================================================================
// 型定義 (設計書 §型定義)
// =================================================================

/** OOS / Walk-forward の観測結果。 */
export type OosValidationStatus =
  | 'oos_passed'
  | 'oos_failed'
  | 'walk_forward_passed'
  | 'walk_forward_failed'
  | 'insufficient_oos_data'
  | 'not_evaluated'
  | 'unknown';

/** OOS 評価で落ちた理由 (複数積み上がる)。 */
export type OosFailureReason =
  | 'low_oos_pf'
  | 'insufficient_oos_trades'
  | 'high_oos_drawdown'
  | 'oos_expectancy_degraded'
  | 'fold_instability'
  | 'insample_oos_divergence'
  | 'oos_engine_error'
  | 'oos_timeout'
  | 'insufficient_oos_data'
  | 'unknown';

/** OOS または fold 単位の評価 metrics。 */
export interface OosMetrics {
  pf: number | null;
  tradeCount: number | null;
  maxDrawdown: number | null;
  expectancy: number | null;
  winRate?: number | null;
}

/** in-sample / formal BT と OOS の差分 (oos - baseline)。 */
export interface OosMetricDelta {
  pfDelta: number | null;
  tradeCountDelta: number | null;
  maxDrawdownDelta: number | null;
  expectancyDelta: number | null;
}

/** 時系列評価の期間 (ISO 日付)。 */
export interface OosSplitWindow {
  trainStart: string;
  trainEnd: string;
  validationStart?: string;
  validationEnd?: string;
  oosStart: string;
  oosEnd: string;
}

/** Walk-forward の 1 fold。 */
export interface WalkForwardFold {
  foldIndex: number;
  trainStart: string;
  trainEnd: string;
  oosStart: string;
  oosEnd: string;
  metrics: OosMetrics;
  status: OosValidationStatus;
  failureReasons: OosFailureReason[];
}

/** 候補ごとの OOS / Walk-forward 結果。 */
export interface OosValidationResult {
  candidateId: string;
  dslId: string;
  sourceStage?: string;
  route?: string;
  baselineMetrics: OosMetrics | null;
  oosMetrics: OosMetrics | null;
  deltas: OosMetricDelta;
  status: OosValidationStatus;
  failureReasons: OosFailureReason[];
  folds: WalkForwardFold[];
  warnings: string[];
}

/** status / reason / route / sourceStage ごとの集計。 */
export interface OosValidationSummaryBucket {
  attempted: number;
  passed: number;
  failed: number;
  unknown: number;
}

/** GenerationReport / smoke に出す summary。 */
export interface OosValidationSummary {
  attempted: number;
  passed: number;
  failed: number;
  notEvaluated: number;
  unknown: number;
  byStatus: Record<OosValidationStatus, number>;
  byFailureReason: Record<OosFailureReason, number>;
  byRoute: Record<string, OosValidationSummaryBucket>;
  bySourceStage: Record<string, OosValidationSummaryBucket>;
  warnings: string[];
}

// =================================================================
// 閾値 (設計書 §default threshold)
// =================================================================

/**
 * OOS / Walk-forward v1 の判定閾値。
 *
 * scale 注意 (PR #102 / #103 共通):
 * - `pf`: 0-N の絶対比率
 * - `tradeCount`: 整数件数
 * - `maxOosDrawdown`: **analysis-engine `summary.maxDD` は百分率 (%)** で返る。
 *   よって 25 = 25%pt で扱う (= 0.25 ではなく 25)
 * - `maxPfDegradation`: PF 比率の劣化幅 (= baseline.pf - oos.pf)
 * - `maxExpectancyDegradation`: expectancy の劣化幅
 */
export const oosValidationThresholdsV1 = {
  minOosTrades: 20,
  minOosPf: 1.05,
  maxOosDrawdown: 25,
  maxPfDegradation: 0.25,
  maxExpectancyDegradation: 0.0001,
} as const;

// =================================================================
// chronological split (設計書 §split方針)
// =================================================================

/** ISO 日付文字列 (YYYY-MM-DD or full ISO datetime) を Date に変換。 */
function parseIso(date: string): Date {
  return new Date(date.includes('T') ? date : `${date}T00:00:00.000Z`);
}

/** Date を YYYY-MM-DD に整形 (= 期間 split 用、時刻情報は捨てる)。 */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 日数差 (整数日)。 */
function diffDays(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * 時系列順の OOS split 窓を構築する v1。
 *
 * - `[startDate, endDate]` を train / (validation) / oos に分ける
 * - `oosRatio` 既定 0.2、`validationRatio` 既定 0
 * - 期間が短すぎて oos に最低 1 日割り当てられない場合、`oosStart === oosEnd` の
 *   自明境界を返す (= caller 側で `insufficient_oos_data` として扱える)
 *
 * 入力ガード (PR #103 review #3):
 *   - 各 ratio は `[0, 1]` にクランプ (負値 / 1 超は丸める)
 *   - `oosRatio + validationRatio > 1` の場合は train 期間が消える (= valStart < trainStart に
 *     なる) ため、`validationRatio` を `1 - oosRatio` に縮める。`oosRatio` を縮めるのではなく
 *     validation 側を犠牲にする (= OOS は本 PR の主観測軸なので優先)
 *
 * 禁止: ランダム分割 / future leakage / OOS 期間でのパラメータ再最適化。
 */
export function buildOosSplitWindowV1(input: {
  startDate: string;
  endDate: string;
  oosRatio?: number;
  validationRatio?: number;
}): OosSplitWindow {
  const start = parseIso(input.startDate);
  const end = parseIso(input.endDate);
  const totalDays = Math.max(0, diffDays(start, end));

  // PR #103 review #3: ratio を [0, 1] にクランプ + 合計 ≤ 1 を保証
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  const oosRatio = clamp01(input.oosRatio ?? 0.2);
  const requestedValRatio = clamp01(input.validationRatio ?? 0);
  // OOS を主観測軸として優先、validation は残り枠に縮める
  const valRatio = Math.min(requestedValRatio, Math.max(0, 1 - oosRatio));

  const oosDays = Math.max(0, Math.floor(totalDays * oosRatio));
  const valDays = Math.max(0, Math.floor(totalDays * valRatio));
  // train は残り。oos と validation は期間末尾から後ろに積む。
  const oosEnd = end;
  const oosStart = new Date(end.getTime() - oosDays * 86_400_000);
  const valEnd = oosStart;
  const valStart = new Date(valEnd.getTime() - valDays * 86_400_000);
  const trainStart = start;
  const trainEnd = valDays > 0 ? valStart : oosStart;

  const window: OosSplitWindow = {
    trainStart: toIsoDate(trainStart),
    trainEnd: toIsoDate(trainEnd),
    oosStart: toIsoDate(oosStart),
    oosEnd: toIsoDate(oosEnd),
  };
  if (valDays > 0) {
    window.validationStart = toIsoDate(valStart);
    window.validationEnd = toIsoDate(valEnd);
  }
  return window;
}

/**
 * Walk-forward の time-anchored fold を構築する v1。
 *
 * - 各 fold は `trainEnd === oosStart` (= train 期間の直後に OOS 期間、隙間なし)
 *   train 期間中のデータは OOS には絶対に含まれないため future leakage は発生しない
 * - データ不足で 1 fold も作れない場合は空配列を返す (例外を投げない)
 *
 * PR #103 では fold ごとのパラメータ再最適化はしない (= 同一 DSL を複数 OOS 期間に当てる)。
 */
export function buildWalkForwardFoldsV1(input: {
  startDate: string;
  endDate: string;
  trainWindowDays: number;
  oosWindowDays: number;
  stepDays: number;
  maxFolds?: number;
}): Array<{
  foldIndex: number;
  trainStart: string;
  trainEnd: string;
  oosStart: string;
  oosEnd: string;
}> {
  if (input.trainWindowDays <= 0 || input.oosWindowDays <= 0 || input.stepDays <= 0) {
    return [];
  }
  const start = parseIso(input.startDate);
  const end = parseIso(input.endDate);
  if (end.getTime() <= start.getTime()) return [];

  const maxFolds = input.maxFolds ?? 3;
  const folds: Array<{
    foldIndex: number;
    trainStart: string;
    trainEnd: string;
    oosStart: string;
    oosEnd: string;
  }> = [];

  let cursor = start;
  let i = 0;
  while (folds.length < maxFolds) {
    const trainStart = cursor;
    const trainEnd = new Date(trainStart.getTime() + input.trainWindowDays * 86_400_000);
    const oosStart = trainEnd;
    const oosEnd = new Date(oosStart.getTime() + input.oosWindowDays * 86_400_000);
    if (oosEnd.getTime() > end.getTime()) break;
    folds.push({
      foldIndex: i,
      trainStart: toIsoDate(trainStart),
      trainEnd: toIsoDate(trainEnd),
      oosStart: toIsoDate(oosStart),
      oosEnd: toIsoDate(oosEnd),
    });
    i += 1;
    cursor = new Date(cursor.getTime() + input.stepDays * 86_400_000);
  }
  return folds;
}

// =================================================================
// OOS 判定 (設計書 §OOS pass / fail 判定)
// =================================================================

interface ClassifyInput {
  baselineMetrics: OosMetrics | null;
  oosMetrics: OosMetrics | null;
  minOosTrades?: number;
  minOosPf?: number;
  maxOosDrawdown?: number;
  maxPfDegradation?: number;
  maxExpectancyDegradation?: number;
}

interface ClassifyResult {
  status: OosValidationStatus;
  failureReasons: OosFailureReason[];
  deltas: OosMetricDelta;
  warnings: string[];
}

function emptyDeltas(): OosMetricDelta {
  return {
    pfDelta: null,
    tradeCountDelta: null,
    maxDrawdownDelta: null,
    expectancyDelta: null,
  };
}

function diff(a: number | null | undefined, b: number | null | undefined): number | null {
  if (typeof a !== 'number' || !Number.isFinite(a)) return null;
  if (typeof b !== 'number' || !Number.isFinite(b)) return null;
  return a - b;
}

function buildDeltas(baseline: OosMetrics | null, oos: OosMetrics | null): OosMetricDelta {
  if (!baseline || !oos) return emptyDeltas();
  return {
    pfDelta: diff(oos.pf, baseline.pf),
    tradeCountDelta: diff(oos.tradeCount, baseline.tradeCount),
    maxDrawdownDelta: diff(oos.maxDrawdown, baseline.maxDrawdown),
    expectancyDelta: diff(oos.expectancy, baseline.expectancy),
  };
}

/**
 * 単一 OOS 期間の評価結果を deterministic に分類する v1。
 *
 * 失敗理由は複数同時に積み上がる (例: tradeCount 不足 + PF 不足)。
 * baseline がない場合は warning を出すが、絶対閾値判定は引き続き行う。
 */
export function classifyOosValidationV1(input: ClassifyInput): ClassifyResult {
  const minTrades = input.minOosTrades ?? oosValidationThresholdsV1.minOosTrades;
  const minPf = input.minOosPf ?? oosValidationThresholdsV1.minOosPf;
  const maxDD = input.maxOosDrawdown ?? oosValidationThresholdsV1.maxOosDrawdown;
  const maxPfDeg = input.maxPfDegradation ?? oosValidationThresholdsV1.maxPfDegradation;
  const maxExpDeg =
    input.maxExpectancyDegradation ?? oosValidationThresholdsV1.maxExpectancyDegradation;

  const oos = input.oosMetrics;
  const baseline = input.baselineMetrics;
  const warnings: string[] = [];
  const reasons: OosFailureReason[] = [];

  if (!oos || oos.tradeCount === null) {
    return {
      status: 'insufficient_oos_data',
      failureReasons: ['insufficient_oos_data'],
      deltas: buildDeltas(baseline, oos),
      warnings: baseline ? warnings : ['baseline metrics なし、絶対閾値判定のみ実施'],
    };
  }

  if (!baseline) {
    warnings.push('baseline metrics なし、絶対閾値判定のみ実施');
  }

  if (oos.tradeCount < minTrades) reasons.push('insufficient_oos_trades');
  if (typeof oos.pf !== 'number' || !Number.isFinite(oos.pf) || oos.pf < minPf) {
    reasons.push('low_oos_pf');
  }
  if (typeof oos.maxDrawdown === 'number' && oos.maxDrawdown > maxDD) {
    reasons.push('high_oos_drawdown');
  }

  // baseline がある場合は劣化幅も判定
  if (baseline) {
    if (
      typeof baseline.pf === 'number' &&
      typeof oos.pf === 'number' &&
      Number.isFinite(baseline.pf) &&
      Number.isFinite(oos.pf) &&
      baseline.pf - oos.pf > maxPfDeg
    ) {
      reasons.push('insample_oos_divergence');
    }
    if (
      typeof baseline.expectancy === 'number' &&
      typeof oos.expectancy === 'number' &&
      Number.isFinite(baseline.expectancy) &&
      Number.isFinite(oos.expectancy) &&
      baseline.expectancy - oos.expectancy > maxExpDeg
    ) {
      reasons.push('oos_expectancy_degraded');
    }
  }

  const deltas = buildDeltas(baseline, oos);

  if (reasons.length > 0) {
    return { status: 'oos_failed', failureReasons: reasons, deltas, warnings };
  }
  return { status: 'oos_passed', failureReasons: [], deltas, warnings };
}

// =================================================================
// Walk-forward 集計 (設計書 §Walk-forward判定)
// =================================================================

/**
 * Walk-forward の fold 結果から 1 候補の status を判定する。
 *
 * - folds が空なら `not_evaluated`
 * - 半数以上 pass なら `walk_forward_passed`
 * - 半数未満 pass なら `walk_forward_failed`
 * - PF / tradeCount のばらつきが大きい場合 `fold_instability` を warning として積む
 *
 * v1 は軽量。詳細な Sortino / Sharpe ベース安定性判定は将来 PR で。
 */
export function summarizeWalkForwardFoldsV1(folds: ReadonlyArray<WalkForwardFold>): {
  status: OosValidationStatus;
  failureReasons: OosFailureReason[];
  warnings: string[];
} {
  if (folds.length === 0) {
    return {
      status: 'not_evaluated',
      failureReasons: ['insufficient_oos_data'],
      warnings: [],
    };
  }
  const passed = folds.filter((f) => f.status === 'oos_passed').length;
  const half = folds.length / 2;
  const status: OosValidationStatus =
    passed >= half ? 'walk_forward_passed' : 'walk_forward_failed';
  const failureReasons: OosFailureReason[] = [];
  const warnings: string[] = [];

  // PF のばらつき判定 (= mean からの偏差が mean の半分以上の fold が 1 つでもあれば不安定)
  const pfs = folds
    .map((f) => f.metrics.pf)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (pfs.length >= 2) {
    const mean = pfs.reduce((a, b) => a + b, 0) / pfs.length;
    const maxDev = Math.max(...pfs.map((v) => Math.abs(v - mean)));
    if (mean > 0 && maxDev / mean > 0.5) {
      failureReasons.push('fold_instability');
      warnings.push(`fold PF が不安定: mean=${mean.toFixed(2)} maxDev=${maxDev.toFixed(2)}`);
    }
  }
  return { status, failureReasons, warnings };
}

// =================================================================
// summary 集計
// =================================================================

const ALL_STATUSES: OosValidationStatus[] = [
  'oos_passed',
  'oos_failed',
  'walk_forward_passed',
  'walk_forward_failed',
  'insufficient_oos_data',
  'not_evaluated',
  'unknown',
];

const ALL_FAILURE_REASONS: OosFailureReason[] = [
  'low_oos_pf',
  'insufficient_oos_trades',
  'high_oos_drawdown',
  'oos_expectancy_degraded',
  'fold_instability',
  'insample_oos_divergence',
  'oos_engine_error',
  'oos_timeout',
  'insufficient_oos_data',
  'unknown',
];

function emptyBucket(): OosValidationSummaryBucket {
  return { attempted: 0, passed: 0, failed: 0, unknown: 0 };
}

function bumpBucket(
  map: Record<string, OosValidationSummaryBucket>,
  key: string,
  status: OosValidationStatus,
): void {
  const k = key.length > 0 ? key : 'unknown';
  if (!map[k]) map[k] = emptyBucket();
  map[k].attempted += 1;
  if (status === 'oos_passed' || status === 'walk_forward_passed') map[k].passed += 1;
  else if (status === 'oos_failed' || status === 'walk_forward_failed') map[k].failed += 1;
  else map[k].unknown += 1;
}

/**
 * OOS / Walk-forward 結果を status / failureReason / route / sourceStage 軸で集計。
 *
 * - 未出現 status / reason は 0 で初期化 (caller 側 `?? 0` 不要)
 * - route / sourceStage が空文字 / undefined なら `'unknown'` バケット
 */
export function summarizeOosValidationResults(
  results: ReadonlyArray<OosValidationResult>,
): OosValidationSummary {
  const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<
    OosValidationStatus,
    number
  >;
  const byFailureReason = Object.fromEntries(ALL_FAILURE_REASONS.map((r) => [r, 0])) as Record<
    OosFailureReason,
    number
  >;
  const byRoute: Record<string, OosValidationSummaryBucket> = {};
  const bySourceStage: Record<string, OosValidationSummaryBucket> = {};

  let passed = 0;
  let failed = 0;
  let notEvaluated = 0;
  let unknown = 0;
  const warnings: string[] = [];

  for (const r of results) {
    byStatus[r.status] += 1;
    for (const reason of r.failureReasons) byFailureReason[reason] += 1;
    if (r.status === 'oos_passed' || r.status === 'walk_forward_passed') passed += 1;
    else if (r.status === 'oos_failed' || r.status === 'walk_forward_failed') failed += 1;
    else if (r.status === 'not_evaluated') notEvaluated += 1;
    else unknown += 1;

    bumpBucket(byRoute, r.route ?? '', r.status);
    bumpBucket(bySourceStage, r.sourceStage ?? '', r.status);
    if (r.warnings.length > 0) for (const w of r.warnings) warnings.push(w);
  }

  return {
    attempted: results.length,
    passed,
    failed,
    notEvaluated,
    unknown,
    byStatus,
    byFailureReason,
    byRoute,
    bySourceStage,
    warnings,
  };
}
