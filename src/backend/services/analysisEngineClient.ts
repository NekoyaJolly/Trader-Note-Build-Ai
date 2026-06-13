/**
 * analysis-engine（Python）クライアント
 * 
 * 目的:
 * - インジケーター計算を pandas-ta に委譲し、Node 側は判定ロジックのみに集中する
 * - 大量 OHLCV は DB 共有（Python が DB 直読み）で転送しない
 */

import axios from 'axios';
import { z } from 'zod';
import type {
  AnalysisEngineIndicatorSpec,
  AnalysisEngineIndicatorSeriesResponse,
  AnalysisEngineOosValidationRequestInput,
  AnalysisEngineOosValidationResponse,
  AnalysisEngineOptimizeRequestInput,
  AnalysisEngineOptimizeResponse,
  AnalysisEngineScreeningBacktestRequest,
  AnalysisEngineScreeningBacktestResponse,
} from '../../schemas/external/analysisEngine';
import {
  AnalysisEngineIndicatorSeriesByVersionRequestSchema,
  AnalysisEngineIndicatorSeriesRequestSchema,
  AnalysisEngineIndicatorSeriesResponseSchema,
  AnalysisEngineOosValidationRequestSchema,
  AnalysisEngineOosValidationResponseSchema,
  AnalysisEngineOptimizeRequestSchema,
  AnalysisEngineOptimizeResponseSchema,
  AnalysisEngineScreeningBacktestRequestSchema,
  AnalysisEngineScreeningBacktestResponseSchema,
} from '../../schemas/external/analysisEngine';
import { buildCorrelationId } from '../../middleware/correlationId';

// ============================================
// 設定
// ============================================

const AnalysisEngineUrlSchema = z.string().url();
const AnalysisEngineSharedSecretSchema = z.string().min(32);
const ANALYSIS_ENGINE_SHARED_SECRET_HEADER = 'X-Analysis-Engine-Secret';

function getAnalysisEngineBaseUrl(): string {
  const raw = process.env.ANALYSIS_ENGINE_URL || 'http://analysis-engine:8000';
  return AnalysisEngineUrlSchema.parse(raw);
}

function getAnalysisEngineSharedSecret(): string | null {
  const raw = process.env.ANALYSIS_ENGINE_SHARED_SECRET?.trim();
  if (raw) {
    return AnalysisEngineSharedSecretSchema.parse(raw);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ANALYSIS_ENGINE_SHARED_SECRET は production で必須です');
  }
  return null;
}

/**
 * analysis-engine への内部 HTTP 呼び出しに付与する追加オプション。
 */
export interface AnalysisEngineRequestOptions {
  /** HTTP/API/Job 境界を横断して同じ実行を追跡する相関ID */
  readonly correlationId?: string;
}

/**
 * analysis-engine 向け JSON ヘッダーを作る。
 *
 * 理由: 各 endpoint の axios 設定に直書きすると、相関IDの付与漏れが起きやすいため。
 */
export function buildAnalysisEngineJsonHeaders(
  options?: AnalysisEngineRequestOptions,
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const sharedSecret = getAnalysisEngineSharedSecret();
  if (sharedSecret) {
    headers[ANALYSIS_ENGINE_SHARED_SECRET_HEADER] = sharedSecret;
  }
  if (options?.correlationId) {
    headers['X-Correlation-Id'] = buildCorrelationId(options.correlationId);
  }
  return headers;
}

// ============================================
// 安定 JSON（params の cacheKey 互換用）
// ============================================

/**
 * params（Record<string, number>）をキー順固定で JSON 化する。
 * 
 * 理由:
 * - Node の JSON.stringify() は挿入順依存
 * - Python 側は sort_keys=True で固定化しているため、ここも合わせる
 */
export function stableParamsKey(params: Record<string, number>): string {
  const keys = Object.keys(params).sort();
  const normalized: Record<string, number> = {};
  for (const k of keys) {
    normalized[k] = params[k];
  }
  return JSON.stringify(normalized);
}

export function makeIndicatorCacheKey(
  indicatorId: string,
  params: Record<string, number>,
  field: string
): string {
  return `${indicatorId.toLowerCase()}_${stableParamsKey(params)}_${field}`;
}

// ============================================
// API
// ============================================

export async function fetchIndicatorSeries(params: {
  symbol: string;
  timeframe: string;
  startDate: Date;
  endDate: Date;
  indicators: AnalysisEngineIndicatorSpec[];
  patterns?: Array<
    | 'pinbar'
    | 'hammer'
    | 'hammer_bull'
    | 'hammer_bear'
    | 'shooting_star'
    | 'engulfing_bull'
    | 'engulfing_bear'
    | 'doji'
    | 'thrust_bull'
    | 'thrust_bear'
    | 'bb_bandwidth'
    | 'pinbar_bull'
    | 'pinbar_bear'
  >;
  bbBandwidthWindow?: number;
  bbBandwidthThreshold?: number;
  /// Phase 7a/7b/7c の末尾バー snapshot 取得フラグ (default false = 既存挙動互換)。
  /// レンズ類似度基盤 (Phase α-2) の LensSnapshotBuilder が SMC / ChartPattern / Wyckoff
  /// レンズの precomputed payload を 1 呼び出しで取得するために配線した。
  includeSmc?: boolean;
  includeChartPatterns?: boolean;
  includeWyckoff?: boolean;
  /// レンズ条件タイプ #3 第2段: 状態レンズの per-bar 系列の要求 (窓 150 本、lookahead なし)
  stateLensSeries?: Array<'smc' | 'chart_pattern' | 'wyckoff'>;
}, options?: AnalysisEngineRequestOptions): Promise<AnalysisEngineIndicatorSeriesResponse> {
  const baseUrl = getAnalysisEngineBaseUrl();

  const payload = AnalysisEngineIndicatorSeriesRequestSchema.parse({
    symbol: params.symbol,
    timeframe: params.timeframe,
    startDate: params.startDate.toISOString(),
    endDate: params.endDate.toISOString(),
    indicators: params.indicators,
    patterns: params.patterns ?? [],
    bbBandwidthWindow: params.bbBandwidthWindow,
    bbBandwidthThreshold: params.bbBandwidthThreshold,
    includeSmc: params.includeSmc ?? false,
    includeChartPatterns: params.includeChartPatterns ?? false,
    includeWyckoff: params.includeWyckoff ?? false,
    stateLensSeries: params.stateLensSeries ?? [],
  });

  // 状態レンズの per-bar 系列 (#3 第2段) は窓 150 本 × 全バーの計算で、長期間の
  // バックテストでは 60s を超え得る (実測: 3 レンズ × 2,000 本 ≈ 12s)。
  // 要求時のみ screening BT と同じ 180s に引き上げる (通常リクエストは従来どおり 60s)
  const timeoutMs = payload.stateLensSeries.length > 0 ? 180_000 : 60_000;
  const res = await axios.post(`${baseUrl}/v1/indicator-series`, payload, {
    timeout: timeoutMs,
    headers: buildAnalysisEngineJsonHeaders(options),
  });

  const parsed = AnalysisEngineIndicatorSeriesResponseSchema.safeParse(res.data);
  if (!parsed.success) {
    throw new Error(`analysis-engine レスポンスが不正です: ${parsed.error.message}`);
  }

  return parsed.data;
}

/**
 * StrategyVersion を基準に、Python 側で必要指標を自動抽出して計算する（IDベース）
 * 
 * Node → Python の送信量を最小化し、設計方針（DB共有）に寄せる。
 */
export async function fetchIndicatorSeriesByStrategyVersion(params: {
  strategyId: string;
  versionId: string;
  symbol: string;
  timeframe: string;
  startDate: Date;
  endDate: Date;
  patterns?: Array<
    | 'pinbar'
    | 'hammer'
    | 'shooting_star'
    | 'engulfing_bull'
    | 'engulfing_bear'
    | 'doji'
    | 'thrust_bull'
    | 'thrust_bear'
    | 'bb_bandwidth'
  >;
  bbBandwidthWindow?: number;
  bbBandwidthThreshold?: number;
}, options?: AnalysisEngineRequestOptions): Promise<AnalysisEngineIndicatorSeriesResponse> {
  const baseUrl = getAnalysisEngineBaseUrl();

  const payload = AnalysisEngineIndicatorSeriesByVersionRequestSchema.parse({
    strategyId: params.strategyId,
    versionId: params.versionId,
    symbol: params.symbol,
    timeframe: params.timeframe,
    startDate: params.startDate.toISOString(),
    endDate: params.endDate.toISOString(),
    patterns: params.patterns ?? [],
    bbBandwidthWindow: params.bbBandwidthWindow,
    bbBandwidthThreshold: params.bbBandwidthThreshold,
  });

  const res = await axios.post(`${baseUrl}/v1/indicator-series/by-version`, payload, {
    timeout: 60_000,
    headers: buildAnalysisEngineJsonHeaders(options),
  });

  const parsed = AnalysisEngineIndicatorSeriesResponseSchema.safeParse(res.data);
  if (!parsed.success) {
    throw new Error(`analysis-engine レスポンスが不正です: ${parsed.error.message}`);
  }

  return parsed.data;
}

/**
 * Critical-4 段階 1: 仮説スクリーニング BT を analysis-engine に投げる。
 *
 * 設計方針 (§12):
 * - BT エンジンはアプリ全体で 1 つだけ (analysis-engine + backtesting.py)
 * - 変換アダプタを作らない (notePayload を素直に渡す)
 * - OHLCV は analysis-engine が DB から直読み
 *
 * Python 側のエンドポイント実装は `analysis-engine/app/backtest.py`。
 */
export async function runScreeningBacktest(
  input: AnalysisEngineScreeningBacktestRequest,
  options?: AnalysisEngineRequestOptions,
): Promise<AnalysisEngineScreeningBacktestResponse> {
  const baseUrl = getAnalysisEngineBaseUrl();
  const payload = AnalysisEngineScreeningBacktestRequestSchema.parse(input);

  const res = await axios.post(`${baseUrl}/v1/screening-backtest`, payload, {
    // 1 年分の BT は数十秒かかりうるため余裕を持たせる
    timeout: 180_000,
    headers: buildAnalysisEngineJsonHeaders(options),
  });

  const parsed = AnalysisEngineScreeningBacktestResponseSchema.safeParse(res.data);
  if (!parsed.success) {
    throw new Error(`analysis-engine BT レスポンスが不正です: ${parsed.error.message}`);
  }

  return parsed.data;
}

/**
 * 進化ループ再設計 Phase 1: `/v1/optimize` を呼ぶ薄い HTTP client。
 *
 * SL/TP 値の候補リスト (呼び出し側が現在値±N%・型刻みで生成) を渡し、
 * backtesting.py の `Backtest.optimize()` で決定論的に最良値を探索させる。
 * AGENTS.md ドメイン原則#3 (数値最適化は決定論コードで) に沿い、Mutation/Crossover の
 * 数値最適化をこの経路に寄せる。インジ期間最適化・train/OOS 過学習ガードは Phase 1b。
 *
 * timeout は ScreeningBacktest と同じ 180s (grid 探索は単発 BT の N 倍かかりうるため、
 * 呼び出し側は slValues / tpValues の組合せ数を抑えるか maxTries で打ち切ること)。
 */
export async function runOptimize(
  input: AnalysisEngineOptimizeRequestInput,
  options?: AnalysisEngineRequestOptions,
): Promise<AnalysisEngineOptimizeResponse> {
  const baseUrl = getAnalysisEngineBaseUrl();
  const payload = AnalysisEngineOptimizeRequestSchema.parse(input);

  const res = await axios.post(`${baseUrl}/v1/optimize`, payload, {
    timeout: 180_000,
    headers: buildAnalysisEngineJsonHeaders(options),
  });

  const parsed = AnalysisEngineOptimizeResponseSchema.safeParse(res.data);
  if (!parsed.success) {
    throw new Error(`analysis-engine optimize レスポンスが不正です: ${parsed.error.message}`);
  }

  return parsed.data;
}

/**
 * Critical-4 PR #109/#110: `/v1/oos-validation` を呼ぶ薄い HTTP client。
 *
 * Side-B `oosBacktestRunner` の adapter 経由で呼ばれ、結果はそのまま
 * `OosBacktestRunnerResult` (TS) に詰め替えて Evolution layer に運ばれる。
 * **verdict は analysis-engine 側が判定** したものを尊重する (= Side-B では再判定しない、
 * PR #105 設計確定事項)。
 *
 * timeout は ScreeningBacktest と同じ 180s。
 */
export async function runOosValidation(
  // PR #110 Copilot review #2: schema の `.default(...)` を使う `config` / `thresholds` を
  // adapter 側で再ハードコードしないため、input 型を `z.input<>` 系に変える。
  // Zod parse 内で defaults が埋まり、call site では省略可能になる。
  input: AnalysisEngineOosValidationRequestInput,
  options?: AnalysisEngineRequestOptions,
): Promise<AnalysisEngineOosValidationResponse> {
  const baseUrl = getAnalysisEngineBaseUrl();
  const payload = AnalysisEngineOosValidationRequestSchema.parse(input);

  const res = await axios.post(`${baseUrl}/v1/oos-validation`, payload, {
    timeout: 180_000,
    headers: buildAnalysisEngineJsonHeaders(options),
  });

  const parsed = AnalysisEngineOosValidationResponseSchema.safeParse(res.data);
  if (!parsed.success) {
    throw new Error(
      `analysis-engine OOS validation レスポンスが不正です: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}
