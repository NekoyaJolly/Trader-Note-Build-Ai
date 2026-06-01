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

// ============================================
// 設定
// ============================================

const AnalysisEngineUrlSchema = z.string().url();

function getAnalysisEngineBaseUrl(): string {
  const raw = process.env.ANALYSIS_ENGINE_URL || 'http://analysis-engine:8000';
  return AnalysisEngineUrlSchema.parse(raw);
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
}): Promise<AnalysisEngineIndicatorSeriesResponse> {
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
  });

  const res = await axios.post(`${baseUrl}/v1/indicator-series`, payload, {
    timeout: 60_000,
    headers: { 'Content-Type': 'application/json' },
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
}): Promise<AnalysisEngineIndicatorSeriesResponse> {
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
    headers: { 'Content-Type': 'application/json' },
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
): Promise<AnalysisEngineScreeningBacktestResponse> {
  const baseUrl = getAnalysisEngineBaseUrl();
  const payload = AnalysisEngineScreeningBacktestRequestSchema.parse(input);

  const res = await axios.post(`${baseUrl}/v1/screening-backtest`, payload, {
    // 1 年分の BT は数十秒かかりうるため余裕を持たせる
    timeout: 180_000,
    headers: { 'Content-Type': 'application/json' },
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
): Promise<AnalysisEngineOptimizeResponse> {
  const baseUrl = getAnalysisEngineBaseUrl();
  const payload = AnalysisEngineOptimizeRequestSchema.parse(input);

  const res = await axios.post(`${baseUrl}/v1/optimize`, payload, {
    timeout: 180_000,
    headers: { 'Content-Type': 'application/json' },
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
): Promise<AnalysisEngineOosValidationResponse> {
  const baseUrl = getAnalysisEngineBaseUrl();
  const payload = AnalysisEngineOosValidationRequestSchema.parse(input);

  const res = await axios.post(`${baseUrl}/v1/oos-validation`, payload, {
    timeout: 180_000,
    headers: { 'Content-Type': 'application/json' },
  });

  const parsed = AnalysisEngineOosValidationResponseSchema.safeParse(res.data);
  if (!parsed.success) {
    throw new Error(
      `analysis-engine OOS validation レスポンスが不正です: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}
