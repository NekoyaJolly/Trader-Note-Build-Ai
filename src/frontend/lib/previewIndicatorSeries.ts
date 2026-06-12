/**
 * /strategies/new プレビュー用: analysis-engine 指標系列の取得・整列・オーバーレイ構築。
 *
 * 設計方針 (2026-06-07, Issue #368):
 * - 指標計算はフロントで自前実装せず analysis-engine (pandas-ta) に一元化する。
 *   本モジュールは「条件木 → 必要 spec 抽出 → /api/chart/indicator-series 取得 →
 *   ローソク足配列への timestamp 整列 → ChartPaneContainer 用 IndicatorLineConfig 構築」を担う。
 * - cacheKey 規約 (`${id.toLowerCase()}_${stableParamsKey}_${field}`) は Node/Python と共通。
 *   条件評価エンジン (EntryPreviewMiniChart の evalGroup) は cacheKey で系列を引くため、
 *   ここで同一規約のキーで Map を作れば eval は無改造で実データを評価できる。
 * - analysis-engine は OHLCV を DB 直読みするので、取得側は事前に /api/chart/candles で
 *   同一期間のローソク足を取得 (= DB キャッシュ) しておくこと。返る timestamps とローソク足の
 *   本数・粒度がズレても、本モジュールが timestamp で整列して位置 index を揃える。
 */

import { apiFetch } from "./apiClient";
import type { IndicatorLineConfig, OHLCVDataPoint } from "@/components/CandlestickChart";
import {
  ChartCandlesResponseSchema,
  type ChartCandle,
  type ChartCandlesResponse,
} from "@/schemas/api/chartCandles";
import type {
  CandlePatternId,
  ConditionChild,
  ConditionGroup,
} from "@/types/strategy";
import { isConditionGroup, isIndicatorCondition, isLensCondition, isPatternCondition } from "@/types/strategy";
import type { IndicatorParams } from "@/types/indicator";

/** analysis-engine に渡す単一指標の指定 (cacheKey 規約と 1:1) */
export interface IndicatorSpec {
  indicatorId: string;
  params: Record<string, number>;
  field: string;
}

// ============================================
// cacheKey (Node/Python 共通規約)
// ============================================

/** params をキー順固定で JSON 化 (Python の sort_keys=True と整合) */
export function stableParamsKey(params: Record<string, number>): string {
  const keys = Object.keys(params).sort();
  const normalized: Record<string, number> = {};
  for (const k of keys) normalized[k] = params[k];
  return JSON.stringify(normalized);
}

/** 指標系列の一意キー。analysis-engine の make_cache_key と完全一致させる。 */
export function makeIndicatorCacheKey(
  indicatorId: string,
  params: Record<string, number>,
  field: string,
): string {
  return `${indicatorId.toLowerCase()}_${stableParamsKey(params)}_${field}`;
}

/**
 * analysis-engine が返した cacheKey を JS 正規形に揃える。
 *
 * **なぜ必要か**: analysis-engine (Python/Pydantic) は params を float として扱うため、
 * 整数パラメータ (period=14) が `{"period":14.0}` とシリアライズされる。一方 JS の
 * `JSON.stringify({period:14})` は `{"period":14}` で、評価エンジン (evalGroup) が
 * 再構築するキーと一致せず、系列を引けず成立判定が常に false になる (実機で発覚)。
 * params JSON を JSON.parse → makeIndicatorCacheKey で再シリアライズし、14.0→14 等の
 * 差や順序差を吸収して評価側のキーと一致させる。パース不能時は元キーを返す。
 */
export function canonicalizeCacheKey(rawKey: string): string {
  // `id_paramsJson_field` の 3 分割が成立しないキー (区切り `_` が足りない) は正規化対象外。
  // parseCacheKey はフォーマット不正時に fallback ({}/value) を返すため、ここで明示的に弾かないと
  // 例: "foo" が "foo_{}_value" に化ける (JSDoc の「パース不能時は元キーを返す」契約を守る)。
  const first = rawKey.indexOf("_");
  const last = rawKey.lastIndexOf("_");
  if (first < 0 || last <= first) return rawKey;

  const { indicatorId, paramsJson, field } = parseCacheKey(rawKey);
  try {
    const params = JSON.parse(paramsJson) as Record<string, number>;
    return makeIndicatorCacheKey(indicatorId, params, field);
  } catch {
    return rawKey;
  }
}

/** IndicatorParams (全 optional number) を finite number のみの Record に絞る (NaN/undefined を除外)。 */
function toNumberParams(raw: IndicatorParams | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

// ============================================
// 条件木 → 必要 spec / パターン抽出
// ============================================

/**
 * エントリー条件木を走査し、計算が必要な指標 spec とローソク足パターン ID、
 * レンズ条件の lensId を収集する。
 * 左辺指標・右辺 indicator ターゲットの両方を spec として集め、cacheKey で重複排除する。
 * lensId はバックエンド (POST /api/chart/indicator-series の lensIds) がレンズ特徴系列
 * (数値エンコード済み) の計算に使う (レンズ計算をフロントで自前実装しない = 計算一元化)。
 */
export function extractConditionRequirements(group: ConditionGroup): {
  specs: IndicatorSpec[];
  patternIds: CandlePatternId[];
  lensIds: string[];
} {
  const specByKey = new Map<string, IndicatorSpec>();
  const patternIds = new Set<CandlePatternId>();
  const lensIds = new Set<string>();

  const addIndicator = (indicatorId: string, params: Record<string, number>, field: string) => {
    specByKey.set(makeIndicatorCacheKey(indicatorId, params, field), { indicatorId, params, field });
  };

  const visit = (node: ConditionChild) => {
    if (isConditionGroup(node)) {
      for (const c of node.conditions) visit(c);
      // IF_THEN は ifCondition / thenCondition が conditions に含まれない場合があるため明示的に辿る
      if (node.ifCondition) visit(node.ifCondition);
      if (node.thenCondition) visit(node.thenCondition);
      return;
    }
    if (isPatternCondition(node)) {
      patternIds.add(node.patternId);
      return;
    }
    if (isLensCondition(node)) {
      lensIds.add(node.lensId);
      return;
    }
    if (!isIndicatorCondition(node)) return;

    addIndicator(node.indicatorId, toNumberParams(node.params), node.field);
    if (node.compareTarget.type === "indicator") {
      addIndicator(
        node.compareTarget.indicatorId,
        toNumberParams(node.compareTarget.params),
        node.compareTarget.field,
      );
    }
    // between / not_between の上限が別指標の場合も系列を取得対象にする
    // (収集漏れがあるとプレビューで系列未取得→常に false になる)
    if (node.compareTargetUpper?.type === "indicator") {
      addIndicator(
        node.compareTargetUpper.indicatorId,
        toNumberParams(node.compareTargetUpper.params),
        node.compareTargetUpper.field,
      );
    }
  };

  visit(group);
  return {
    specs: Array.from(specByKey.values()),
    patternIds: Array.from(patternIds),
    lensIds: Array.from(lensIds),
  };
}

// ============================================
// ローソク足ペイロード (GET /api/chart/candles)
// ============================================

/**
 * /api/chart/candles レスポンスを Zod でランタイム検証する (手動 type guard を使わない)。
 * 失敗時は null を返す (呼び出し側でフォールバック判断)。
 */
export function parseCandlesResponse(value: unknown): ChartCandlesResponse | null {
  const parsed = ChartCandlesResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * 欠損足 (time / OHLC のいずれかが非有限) を除外し、OHLCVDataPoint (timestamp は ms) に変換する。
 * time が NaN/Infinity の足は timestamp 不正になるため除外する。
 */
export function toOhlcvPoints(candles: ChartCandle[]): OHLCVDataPoint[] {
  return candles
    .filter(
      (c): c is { time: number; open: number; high: number; low: number; close: number; volume: number | null } =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close),
    )
    .map((c) => ({
      timestamp: c.time * 1000, // Unix 秒 → ms
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0,
    }));
}

// ============================================
// 取得 (POST /api/chart/indicator-series)
// ============================================

/** analysis-engine indicator-series レスポンスの最小形 (フロントは Zod 非依存で型ガード) */
export interface IndicatorSeriesResponse {
  timestamps: string[];
  series: Record<string, (number | null)[]>;
  patterns: Record<string, boolean[]>;
  /**
   * レンズ特徴系列 (数値エンコード済み、キーは `lens:<lensId>:<featureKey>`)。
   * lensIds を要求した場合のみ backend が付与する (additive、旧レスポンスとも互換)。
   */
  lensSeries?: Record<string, (number | null)[]>;
}

function isIndicatorSeriesResponse(value: unknown): value is IndicatorSeriesResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as {
    timestamps?: unknown;
    series?: unknown;
    patterns?: unknown;
    lensSeries?: unknown;
  };
  return (
    Array.isArray(v.timestamps) &&
    typeof v.series === "object" &&
    v.series !== null &&
    typeof v.patterns === "object" &&
    v.patterns !== null &&
    (v.lensSeries === undefined || (typeof v.lensSeries === "object" && v.lensSeries !== null))
  );
}

/**
 * 指標系列を取得する。symbol/timeframe/期間 + spec/pattern を渡す。
 * 認証・base URL・JSON ヘッダーは apiFetch が付与する。
 */
export async function fetchChartIndicatorSeries(params: {
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  specs: IndicatorSpec[];
  patternIds: CandlePatternId[];
  /** レンズ条件の lensId 群 (レンズ特徴系列を backend で計算してもらう) */
  lensIds?: string[];
  signal?: AbortSignal;
}): Promise<IndicatorSeriesResponse> {
  const res = await apiFetch("/api/chart/indicator-series", {
    method: "POST",
    body: JSON.stringify({
      symbol: params.symbol,
      timeframe: params.timeframe,
      startDate: params.startDate,
      endDate: params.endDate,
      indicators: params.specs,
      patterns: params.patternIds,
      lensIds: params.lensIds ?? [],
    }),
    signal: params.signal,
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errBody?.error || `指標系列の取得に失敗しました: ${res.status}`);
  }
  const payload: unknown = await res.json();
  if (!isIndicatorSeriesResponse(payload)) {
    throw new Error("指標系列レスポンスの形式が不正です");
  }
  return payload;
}

// ============================================
// 整列 (response → ローソク足 index 揃え)
// ============================================

export interface AlignedSeries {
  /** cacheKey → ローソク足 index に揃えた値配列 (欠損は NaN) */
  indicatorCache: Map<string, number[]>;
  /** patternId → ローソク足 index に揃えたフラグ配列 (欠損は false) */
  patternCache: Map<CandlePatternId, boolean[]>;
}

/** UTC ms / ISO 文字列を「秒境界」キーに正規化 (ローソク足とレスポンスの照合用)。 */
function toSecondKey(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * analysis-engine レスポンスの timestamps を基準に、ローソク足配列の各 index へ系列を整列する。
 * 位置 index 前提の評価エンジンを壊さないため、本数や粒度がズレても timestamp で対応付ける。
 *
 * @param response analysis-engine の指標系列レスポンス
 * @param candleTimestampsMs ローソ足の timestamp 配列 (ms, 昇順)。出力配列はこの長さ・順序に揃う。
 */
export function alignSeriesToCandles(
  response: IndicatorSeriesResponse,
  candleTimestampsMs: number[],
): AlignedSeries {
  // レスポンス timestamp(秒) → レスポンス index
  const responseIndexBySecond = new Map<number, number>();
  for (let i = 0; i < response.timestamps.length; i++) {
    const ms = Date.parse(response.timestamps[i]);
    if (Number.isFinite(ms)) responseIndexBySecond.set(toSecondKey(ms), i);
  }

  // 各ローソク足 index に対応するレスポンス index (無ければ -1)
  const responseIndexForCandle = candleTimestampsMs.map(
    (ms) => responseIndexBySecond.get(toSecondKey(ms)) ?? -1,
  );

  const indicatorCache = new Map<string, number[]>();
  for (const [cacheKey, series] of Object.entries(response.series)) {
    const aligned = responseIndexForCandle.map((ri) => {
      if (ri < 0) return Number.NaN;
      const v = series[ri];
      return v === null || v === undefined ? Number.NaN : v;
    });
    // Python の float キー (例 {"period":14.0}) を JS 正規形 ({"period":14}) に揃えてから
    // 格納する。これで評価エンジンが makeIndicatorCacheKey で再構築するキーと一致する。
    indicatorCache.set(canonicalizeCacheKey(cacheKey), aligned);
  }

  // レンズ特徴系列 (キーは `lens:<lensId>:<featureKey>` で Node が生成済み)。
  // lensId は `_` や `#` を含むため canonicalizeCacheKey を通すとキーが壊れる。そのまま格納する
  for (const [lensKey, series] of Object.entries(response.lensSeries ?? {})) {
    const aligned = responseIndexForCandle.map((ri) => {
      if (ri < 0) return Number.NaN;
      const v = series[ri];
      return v === null || v === undefined ? Number.NaN : v;
    });
    indicatorCache.set(lensKey, aligned);
  }

  const patternCache = new Map<CandlePatternId, boolean[]>();
  for (const [patternId, flags] of Object.entries(response.patterns)) {
    const aligned = responseIndexForCandle.map((ri) => (ri < 0 ? false : flags[ri] ?? false));
    patternCache.set(patternId as CandlePatternId, aligned);
  }

  return { indicatorCache, patternCache };
}

// ============================================
// オーバーレイ構築 (ChartPaneContainer 用 IndicatorLineConfig)
// ============================================

/** 価格スケールに重ねる (メインペイン) 指標 ID。これ以外はサブペインに分離。 */
const PRICE_OVERLAY_IDS = new Set([
  "sma", "ema", "dema", "tema",
  "bb", "bbands", "bollinger", "kc",
  "vwap", "psar", "ichimoku", "supertrend", "pivot",
]);

/** 0-100 に固定スケールするオシレーター。 */
const BOUNDED_0_100_IDS = new Set(["rsi", "stochastic", "stoch", "mfi"]);

// 既存コードで使用済みの色のみを循環使用する (新規色を増やさない)。
const PREVIEW_PALETTE = ["#06b6d4", "#8b5cf6", "#f59e0b", "#60a5fa", "#a78bfa"];

/** cacheKey を [indicatorId, paramsJson, field] に分解 (id/field に `_` は含まれない前提)。 */
function parseCacheKey(cacheKey: string): { indicatorId: string; paramsJson: string; field: string } {
  const first = cacheKey.indexOf("_");
  const last = cacheKey.lastIndexOf("_");
  if (first < 0 || last <= first) {
    return { indicatorId: cacheKey, paramsJson: "{}", field: "value" };
  }
  return {
    indicatorId: cacheKey.slice(0, first),
    paramsJson: cacheKey.slice(first + 1, last),
    field: cacheKey.slice(last + 1),
  };
}

/** 表示名を作る: 例 RSI(14) / MACD(12,26,9).histogram */
function buildName(indicatorId: string, paramsJson: string, field: string): string {
  let name = indicatorId.toUpperCase();
  try {
    const params = JSON.parse(paramsJson) as Record<string, number>;
    const values = Object.values(params);
    if (values.length > 0) name = `${name}(${values.join(",")})`;
  } catch {
    // パース失敗時は ID のみ
  }
  if (field && field !== "value") name = `${name}.${field}`;
  return name;
}

/**
 * 整列済み指標キャッシュから、ChartPaneContainer 用のオーバーレイ設定を作る。
 * 価格系はメインペイン、オシレーター系は indicatorId ごとのサブペインに振り分ける。
 * 条件で指定された指標を漏れなく描画する (有限値が 1 つも無い系列のみスキップ)。
 */
export function buildPreviewIndicatorLines(
  indicatorCache: Map<string, number[]>,
  candleTimestampsMs: number[],
): IndicatorLineConfig[] {
  const lines: IndicatorLineConfig[] = [];
  let colorIdx = 0;

  for (const [cacheKey, series] of indicatorCache) {
    const data: { timestamp: number; value: number }[] = [];
    for (let i = 0; i < candleTimestampsMs.length; i++) {
      const v = series[i];
      if (v === undefined || !Number.isFinite(v)) continue;
      data.push({ timestamp: candleTimestampsMs[i], value: v });
    }
    if (data.length === 0) continue;

    const { indicatorId, paramsJson, field } = parseCacheKey(cacheKey);
    const id = indicatorId.toLowerCase();
    const isPriceOverlay = PRICE_OVERLAY_IDS.has(id);
    const color = PREVIEW_PALETTE[colorIdx % PREVIEW_PALETTE.length];
    colorIdx += 1;

    const scaleRange = BOUNDED_0_100_IDS.has(id)
      ? { min: 0, max: 100 }
      : id === "willr" || id === "williamsr"
        ? { min: -100, max: 0 }
        : undefined;

    lines.push({
      id: cacheKey,
      name: buildName(indicatorId, paramsJson, field),
      data,
      color,
      lineWidth: 2,
      seriesType: field === "histogram" ? "histogram" : "line",
      pane: isPriceOverlay ? "main" : "sub",
      // サブペインは indicatorId ごとに分離 (同種指標は同ペインに集約)
      paneGroup: isPriceOverlay ? undefined : id,
      scaleRange,
    });
  }

  return lines;
}
