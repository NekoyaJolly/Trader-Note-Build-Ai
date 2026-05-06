/**
 * Analysis Engine Robustness Adapter (Critical-4 PR #105)
 *
 * 設計方針 (docs/design/pr_105_analysis_engine_authority_addendum.md):
 *   - 評価の正本は analysis-engine / Python 側
 *   - Evolution layer 側で Walk Forward / Monte Carlo / Backtest を再実装しない
 *   - 本ファイルは analysis-engine の robustness 評価を呼ぶための **薄い adapter**
 *
 * やる:
 *   - analysis-engine に渡す評価期間 (OOS 期間 / Walk-forward 全体) を計算する
 *     (= `buildOosSplitWindowV1` は「Walk Forward の本格実装」ではなく、analysis-engine
 *      に渡す期間決定のための純粋関数)
 *   - `OosBacktestRunnerFn` の型契約を提供する (= analysis-engine 結果を運ぶ vehicle)
 *   - timeout / engine_error の分類 (= adapter 境界での error handling)
 *
 * やらない:
 *   - Walk Forward fold の本格生成 (= analysis-engine `/v1/walk-forward` の責務)
 *   - Monte Carlo の実行 (= analysis-engine / Python 側責務)
 *   - metrics の再計算
 *   - 独自閾値での pass / fail 判定
 *
 * @see docs/design/pr_105_analysis_engine_authority_addendum.md
 */

import type { StrategyDSL } from '../strategy_dsl/schema';
import type {
  OosFailureReason,
  OosMetrics,
  WalkForwardFold,
} from './oosValidationResultMapper';
import { runOosValidation } from '../../backend/services/analysisEngineClient';
import { dslToBacktestNotePayload } from '../strategy_dsl/dslToBacktestNotePayload';
import { defaultParameterValues } from '../strategy_dsl/dslParameterUtils';
import { normalizeCTraderSymbol } from '../../utils/symbolNormalization';
import { normalizeTimeframe } from '../constants/timeframes';

// =================================================================
// 型定義: analysis-engine 結果を運ぶ vehicle
// =================================================================

/** 時系列評価の期間 (ISO 日付)。analysis-engine に渡す。 */
export interface OosSplitWindow {
  trainStart: string;
  trainEnd: string;
  validationStart?: string;
  validationEnd?: string;
  oosStart: string;
  oosEnd: string;
}

/**
 * `OosBacktestRunnerFn` の戻り値。analysis-engine の robustness 結果を運ぶ vehicle。
 *
 * - `metrics`: analysis-engine から返ってきた metrics (PF / tradeCount / maxDD 等)。
 *   Evolution 側で再計算しない。
 * - `verdict`: analysis-engine 由来の判定 (= 正本)。
 *   - `'passed'` / `'failed'`: analysis-engine が pass/fail を判定済み
 *   - `'unknown'`: analysis-engine が判定不能 (insufficient data 等)
 *   - 省略時は mapper 側で `unknown` 扱い
 * - `failureReasons`: analysis-engine が返した失敗理由 (任意)
 * - `walkForwardFolds`: analysis-engine `/v1/walk-forward` の fold 結果 (任意)
 * - `evaluationKind`: `'oos'` (単一 OOS) / `'walk_forward'` (WF folds 集計)
 */
export interface OosBacktestRunnerResult {
  metrics: OosMetrics;
  verdict?: 'passed' | 'failed' | 'unknown' | null;
  failureReasons?: OosFailureReason[];
  walkForwardFolds?: WalkForwardFold[];
  evaluationKind?: 'oos' | 'walk_forward';
  warnings?: string[];
}

/**
 * analysis-engine の robustness 評価を呼ぶ薄い runner。
 *
 * - 引数は最小限 (DSL + start/end の ISO 日付 + 任意の split 情報) に揃える
 * - 戻り値は `OosBacktestRunnerResult` (= analysis-engine 結果を運ぶ vehicle)
 * - 例外は throw、呼び出し側で `oos_engine_error` などに分類する
 *
 * 既定では未指定 (= OOS 評価をスキップ、`not_evaluated` として観測)。本番では
 * analysis-engine `/v1/walk-forward` 等を呼ぶ adapter を wrap して渡す想定。
 *
 * @example
 * ```ts
 * const runner: OosBacktestRunnerFn = async ({ dsl, startDate, endDate }) => {
 *   const res = await analysisEngineClient.runRobustness({ dsl, startDate, endDate });
 *   return {
 *     metrics: { pf: res.summary.pf, tradeCount: res.summary.totalTrades, ... },
 *     verdict: res.passed ? 'passed' : 'failed',
 *     evaluationKind: 'walk_forward',
 *   };
 * };
 * ```
 */
export type OosBacktestRunnerFn = (args: {
  dsl: StrategyDSL;
  startDate: string;
  endDate: string;
  splitWindow?: OosSplitWindow;
}) => Promise<OosBacktestRunnerResult>;

// =================================================================
// 期間計算 (analysis-engine に渡す split 窓を作るだけ)
// =================================================================

function parseIso(date: string): Date {
  return new Date(date.includes('T') ? date : `${date}T00:00:00.000Z`);
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function diffDays(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * 時系列順の OOS split 窓を構築する。
 *
 * **これは Walk Forward の本格実装ではない。**
 * analysis-engine に渡す評価期間 (train / validation / oos) を date range として
 * 切り分けるだけの純粋関数。fold 単位の trade 計算 / metrics 集計 / 安定性判定は
 * 一切行わず、analysis-engine 側の責務とする。
 *
 * - `[startDate, endDate]` を train / (validation) / oos に分ける
 * - `oosRatio` 既定 0.2、`validationRatio` 既定 0
 * - 期間が短すぎて oos に最低 1 日割り当てられない場合、`oosStart === oosEnd` の
 *   自明境界を返す (= caller 側で `insufficient_oos_data` として扱える)
 *
 * 入力ガード:
 *   - 各 ratio は `[0, 1]` にクランプ (負値 / 1 超は丸める)
 *   - `oosRatio + validationRatio > 1` の場合は OOS を主観測軸として優先し、
 *     validation 側を `1 - oosRatio` に縮める
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

  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  const oosRatio = clamp01(input.oosRatio ?? 0.2);
  const requestedValRatio = clamp01(input.validationRatio ?? 0);
  const valRatio = Math.min(requestedValRatio, Math.max(0, 1 - oosRatio));

  const oosDays = Math.max(0, Math.floor(totalDays * oosRatio));
  const valDays = Math.max(0, Math.floor(totalDays * valRatio));
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

/** OOS 期間が自明境界 (= 1 日も割り当てられない) かどうか。 */
export function isOosWindowEmpty(window: OosSplitWindow): boolean {
  return window.oosStart === window.oosEnd;
}

// =================================================================
// 本番 default runner (PR #110)
// =================================================================

/** ISO 日付文字列を analysis-engine が受け取る datetime (= UTC 00:00 末尾 Z) に整形。 */
function toIsoDateTimeForEngine(value: string): string {
  if (value.includes('T')) return value;
  return `${value}T00:00:00.000Z`;
}

/**
 * 本番経路で `oosBacktestRunner` の default として注入する adapter。
 *
 * - analysis-engine `/v1/oos-validation` を呼び、結果をそのまま `OosBacktestRunnerResult`
 *   に詰め替えて Evolution layer に運ぶ。**verdict は analysis-engine 側が判定** したものを
 *   尊重し、Side-B では再判定しない (PR #105 設計確定事項)。
 * - 例外は throw (= EvolutionLoop 側で `oos_engine_error` として観測される)
 * - 既存 `runFormalBacktest` adapter (= ScreeningBacktest 経路) と同じ symbol/timeframe
 *   正規化を行う。OHLCV の表記ゆれで OOS 評価が空回りしないようにするため。
 *
 * EvolutionLoop の constructor では本関数を **default としてはセットしない** (= 既存テストの
 * 期待値 = `null` で `not_evaluated` 観測 を保護するため)。本番 scheduler / smoke 側で
 * 明示的に `oosBacktestRunner: defaultOosBacktestRunner` を渡す運用にする。
 */
export const defaultOosBacktestRunner: OosBacktestRunnerFn = async ({
  dsl,
  startDate,
  endDate,
}) => {
  // DSL → analysis-engine notePayload (= ScreeningBacktest と同じ converter を流用)
  const params = defaultParameterValues(dsl);
  const notePayload = dslToBacktestNotePayload(dsl, params);
  const symbol = normalizeCTraderSymbol(dsl.symbol);
  const timeframe = normalizeTimeframe(dsl.timeframe);

  const response = await runOosValidation({
    hypothesisId: dsl.id,
    symbol,
    timeframe,
    startDate: toIsoDateTimeForEngine(startDate),
    endDate: toIsoDateTimeForEngine(endDate),
    notePayload,
    config: { initialCapital: 10_000, leverage: 1, tradingCost: 0 },
    thresholds: { minOosPf: 1.0, minOosTrades: 20, maxOosDrawdown: 30.0 },
  });

  return {
    metrics: {
      pf: response.metrics.pf,
      tradeCount: response.metrics.tradeCount,
      maxDrawdown: response.metrics.maxDrawdown,
      expectancy: response.metrics.expectancy,
      winRate: response.metrics.winRate,
    },
    verdict: response.verdict,
    failureReasons: response.failureReasons,
    evaluationKind: response.evaluationKind,
    warnings:
      response.warnings.length > 0 || response.unsupportedConditions.length > 0
        ? [
            ...response.warnings,
            ...(response.unsupportedConditions.length > 0
              ? [`unsupportedConditions=${response.unsupportedConditions.join(',')}`]
              : []),
          ]
        : undefined,
  };
};
