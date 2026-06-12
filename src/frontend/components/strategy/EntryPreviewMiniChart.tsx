"use client";

/**
 * エントリー条件プレビュー（実データ）
 *
 * 目的:
 * - ユーザーが組んだエントリー条件が「選択シンボル・時間足の実相場でどこで・どれくらい成立するか」を
 *   チャート上にマーカー表示して直感的に確認できるようにする (Issue #368)。
 *
 * 方針:
 * - ローソク足は /api/chart/candles の実データ (EODHD 主体 + DB キャッシュ)。
 * - 指標計算は analysis-engine に一元化 (/api/chart/indicator-series 経由)。フロント自前計算は
 *   実データが取れない場合の固定サンプル fallback でのみ使う。
 * - 描画はメインチャートと同じ ChartPaneContainer を再利用 (RSI 等のサブペイン・本数無制限・
 *   見た目統一を一括で解決)。条件評価エンジン (evalGroup) は cacheKey で系列を引くため、
 *   analysis-engine の系列を timestamp 整列するだけで無改造で実データを評価できる。
 */

import React, { useEffect, useMemo, useState } from "react";
import ChartPaneContainer from "@/components/chart/ChartPaneContainer";
import type {
  ChartMarker,
  IndicatorLineConfig,
  OHLCVDataPoint,
} from "@/components/CandlestickChart";
import type {
  CandlePatternId,
  ComparisonOperator,
  ConditionChild,
  ConditionGroup,
  IndicatorCondition,
  PatternCondition,
  TimeCondition,
} from "@/types/strategy";
import { evaluateTimeConditionAt, isIndicatorCondition, isLensCondition, isPatternCondition, isTimeCondition } from "@/types/strategy";
import type { IndicatorParams } from "@/types/indicator";
import { apiFetch } from "@/lib/apiClient";
import { DEFAULT_DATA_COUNT, DEFAULT_TIMEFRAME_API } from "@/lib/marketConstants";
import {
  alignSeriesToCandles,
  buildPreviewIndicatorLines,
  extractConditionRequirements,
  fetchChartIndicatorSeries,
  makeIndicatorCacheKey,
  parseCandlesResponse,
  toOhlcvPoints,
  type AlignedSeries,
} from "@/lib/previewIndicatorSeries";

type PriceType = "open" | "high" | "low" | "close";

type OHLCV = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type CompareTarget =
  | { type: "fixed"; value: number }
  | { type: "price"; priceType: PriceType }
  | { type: "indicator"; indicatorId: string; params: IndicatorParams; field: string };

type EvalIndicatorCondition = {
  indicatorId: string;
  params: Record<string, number>;
  field: string;
  operator: ComparisonOperator;
  compareTarget: CompareTarget;
  /** between / not_between 専用: 上限 */
  compareTargetUpper?: CompareTarget;
};

type EvalPatternCondition = {
  patternId: CandlePatternId;
  operator: "is_true" | "is_false";
};

type EvalContext = {
  data: OHLCV[];
  currentIndex: number;
  indicatorCache: Map<string, number[]>;
  patternCache: Map<CandlePatternId, boolean[]>;
  // SEQUENCE / IF_THEN 状態
  sequenceState?: { currentStep: number; lastStepIndex: number };
  ifThenState?: { triggered: boolean; triggeredIndex: number };
};

function getPrice(bar: OHLCV, priceType: PriceType): number {
  switch (priceType) {
    case "open":
      return bar.open;
    case "high":
      return bar.high;
    case "low":
      return bar.low;
    case "close":
    default:
      return bar.close;
  }
}

function ema(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(Number.NaN);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev: number | undefined;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (prev === undefined) {
      prev = v;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

function sma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(Number.NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function rsi(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(Number.NaN);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const up = Math.max(diff, 0);
    const dn = Math.max(-diff, 0);
    if (i <= period) {
      gain += up;
      loss += dn;
      if (i === period) {
        const rs = loss === 0 ? 100 : gain / loss;
        out[i] = 100 - 100 / (1 + rs);
      }
      continue;
    }
    gain = (gain * (period - 1) + up) / period;
    loss = (loss * (period - 1) + dn) / period;
    const rs = loss === 0 ? 100 : gain / loss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

function atr(data: OHLCV[], period: number): number[] {
  const out: number[] = new Array(data.length).fill(Number.NaN);
  const tr: number[] = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const curr = data[i];
    const prevClose = i > 0 ? data[i - 1].close : curr.close;
    const range1 = curr.high - curr.low;
    const range2 = Math.abs(curr.high - prevClose);
    const range3 = Math.abs(curr.low - prevClose);
    tr[i] = Math.max(range1, range2, range3);
  }
  // Wilder's smoothing
  let prev: number | undefined;
  for (let i = 0; i < tr.length; i++) {
    if (i < period) continue;
    if (prev === undefined) {
      const slice = tr.slice(i - period + 1, i + 1);
      const avg = slice.reduce((s, v) => s + v, 0) / period;
      prev = avg;
    } else {
      prev = (prev * (period - 1) + tr[i]) / period;
    }
    out[i] = prev;
  }
  return out;
}

function computeIndicatorSeries(data: OHLCV[], indicatorId: string, params: Record<string, number>): number[] {
  const close = data.map((d) => d.close);
  const low = data.map((d) => d.low);
  const high = data.map((d) => d.high);
  const volume = data.map((d) => d.volume);

  const id = indicatorId.toLowerCase();
  const period = Math.max(1, Math.floor(params.period ?? 14));

  if (id === "sma") return sma(close, period);
  if (id === "ema") return ema(close, period);
  if (id === "rsi") return rsi(close, period);
  if (id === "atr") return atr(data, period);
  if (id === "obv") {
    // 簡易OBV
    const out: number[] = new Array(close.length).fill(0);
    for (let i = 1; i < close.length; i++) {
      const dir = close[i] > close[i - 1] ? 1 : close[i] < close[i - 1] ? -1 : 0;
      out[i] = out[i - 1] + dir * volume[i];
    }
    return out;
  }
  if (id === "vwap") {
    // 典型価格ベース
    const out: number[] = new Array(close.length).fill(Number.NaN);
    let cumPV = 0;
    let cumV = 0;
    for (let i = 0; i < close.length; i++) {
      const typical = (high[i] + low[i] + close[i]) / 3;
      cumPV += typical * volume[i];
      cumV += volume[i];
      out[i] = cumV === 0 ? Number.NaN : cumPV / cumV;
    }
    return out;
  }

  // 対応外は NaN
  return new Array(close.length).fill(Number.NaN);
}

function compareValues(left: number, right: number, operator: ComparisonOperator, prevLeft?: number, prevRight?: number): boolean {
  const normalized: ComparisonOperator = operator === "GC" ? "cross_above" : operator === "DC" ? "cross_below" : operator;
  switch (normalized) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "=":
      return Math.abs(left - right) < 1e-4;
    case "touch_close":
      return Math.abs(left - right) <= 1e-6;
    case "Touch":
      // 旧互換: 近接 or 反転
      if (Math.abs(left - right) <= 1e-6) return true;
      if (prevLeft === undefined || prevRight === undefined) return false;
      return (prevLeft - prevRight) * (left - right) <= 0;
    case "cross_above":
      if (prevLeft === undefined || prevRight === undefined) return false;
      return prevLeft < prevRight && left > right;
    case "cross_below":
      if (prevLeft === undefined || prevRight === undefined) return false;
      return prevLeft > prevRight && left < right;
    default:
      return false;
  }
}

// 比較対象（固定値 / 価格 / 別指標）を index 位置の数値に解決する
function resolvePreviewTarget(ctx: EvalContext, target: CompareTarget, index: number): number | undefined {
  if (target.type === "fixed") return target.value;
  if (target.type === "price") return getPrice(ctx.data[index], target.priceType);
  const key = makeIndicatorCacheKey(target.indicatorId, target.params as Record<string, number>, target.field);
  const v = ctx.indicatorCache.get(key)?.[index];
  return v !== undefined && Number.isFinite(v) ? v : undefined;
}

function evalIndicatorCondition(ctx: EvalContext, condition: EvalIndicatorCondition): boolean {
  const leftKey = makeIndicatorCacheKey(condition.indicatorId, condition.params, condition.field);
  const leftSeries = ctx.indicatorCache.get(leftKey);
  const leftValue = leftSeries?.[ctx.currentIndex];
  if (leftValue === undefined || !Number.isFinite(leftValue)) return false;

  // 範囲（between / not_between）: 下限 compareTarget・上限 compareTargetUpper を解決して判定
  if (condition.operator === "between" || condition.operator === "not_between") {
    const lo = resolvePreviewTarget(ctx, condition.compareTarget, ctx.currentIndex);
    const hi = condition.compareTargetUpper
      ? resolvePreviewTarget(ctx, condition.compareTargetUpper, ctx.currentIndex)
      : undefined;
    if (lo === undefined || hi === undefined) return false;
    const inRange = leftValue >= Math.min(lo, hi) && leftValue <= Math.max(lo, hi);
    return condition.operator === "between" ? inRange : !inRange;
  }

  // ヒゲタッチ（価格が線に触れるイメージ）
  if (condition.operator === "touch_wick") {
    const bar = ctx.data[ctx.currentIndex];
    return bar.low <= leftValue && leftValue <= bar.high;
  }

  let rightValue: number;
  if (condition.compareTarget.type === "fixed") {
    rightValue = condition.compareTarget.value;
  } else if (condition.compareTarget.type === "price") {
    rightValue = getPrice(ctx.data[ctx.currentIndex], condition.compareTarget.priceType);
  } else {
    const rightKey = makeIndicatorCacheKey(
      condition.compareTarget.indicatorId,
      condition.compareTarget.params as Record<string, number>,
      condition.compareTarget.field
    );
    const rightSeries = ctx.indicatorCache.get(rightKey);
    const v = rightSeries?.[ctx.currentIndex];
    if (v === undefined || !Number.isFinite(v)) return false;
    rightValue = v;
  }

  const needsPrev = ["cross_above", "cross_below", "GC", "DC", "Touch"].includes(condition.operator);
  let prevLeft: number | undefined;
  let prevRight: number | undefined;
  if (needsPrev && ctx.currentIndex > 0) {
    const pi = ctx.currentIndex - 1;
    prevLeft = leftSeries?.[pi];
    if (condition.compareTarget.type === "fixed") {
      prevRight = condition.compareTarget.value;
    } else if (condition.compareTarget.type === "price") {
      prevRight = getPrice(ctx.data[pi], condition.compareTarget.priceType);
    } else {
      const rightKey = makeIndicatorCacheKey(
        condition.compareTarget.indicatorId,
        condition.compareTarget.params as Record<string, number>,
        condition.compareTarget.field
      );
      prevRight = ctx.indicatorCache.get(rightKey)?.[pi];
    }
  }

  return compareValues(leftValue, rightValue, condition.operator, prevLeft, prevRight);
}

function evalPatternCondition(ctx: EvalContext, condition: EvalPatternCondition): boolean {
  const series = ctx.patternCache.get(condition.patternId);
  const flag = series?.[ctx.currentIndex] ?? false;
  return condition.operator === "is_false" ? !flag : !!flag;
}

// 時間条件はバーの timestamp を JST に変換して判定する（共通ロジックは types/strategy 側）。
function evalTimeCondition(ctx: EvalContext, condition: TimeCondition): boolean {
  const bar = ctx.data[ctx.currentIndex];
  if (!bar) return false;
  return evaluateTimeConditionAt(condition, Date.parse(bar.timestamp));
}

// ノード（指標 / パターン / 時間 / グループ）の基本評価（ルックバックは考慮しない）。
// SEQUENCE / IF_THEN / AND-OR-NOT の各所で同じ分類をするため集約する（時間条件の入れ忘れ防止）。
function evalBaseNode(ctx: EvalContext, node: ConditionChild): boolean {
  if (isIndicatorCondition(node)) return evalIndicatorCondition(ctx, normalizeIndicatorCondition(node));
  if (isPatternCondition(node)) return evalPatternCondition(ctx, normalizePatternCondition(node));
  if (isTimeCondition(node)) return evalTimeCondition(ctx, node);
  // レンズ条件 (#3) はレンズ系列の per-bar 計算が backend 側(analysis-engine + レンズ基盤)に
  // あるためプレビューでは計算できない。誤って楽観表示しないよう「不成立」に倒す
  // (バックテスト・ライブ評価では正しく評価される。SingleLensCondition にも明記)
  if (isLensCondition(node)) return false;
  return evalGroup(ctx, node);
}

// ノード評価。indicator / pattern に lookbackBars>1 があれば
// 「直近 N 本以内（現在足含む）のどこかで成立」で true。
function evalNode(ctx: EvalContext, node: ConditionChild): boolean {
  const lookbackBars =
    isIndicatorCondition(node) || isPatternCondition(node) ? node.lookbackBars : undefined;
  if (lookbackBars && lookbackBars > 1) {
    const start = Math.max(0, ctx.currentIndex - (lookbackBars - 1));
    for (let j = ctx.currentIndex; j >= start; j--) {
      if (evalBaseNode({ ...ctx, currentIndex: j }, node)) return true;
    }
    return false;
  }
  return evalBaseNode(ctx, node);
}

function evalGroup(ctx: EvalContext, group: ConditionGroup): boolean {
  if (group.operator === "SEQUENCE") {
    const sequence = group.conditions;
    const maxBarsBetween = group.maxBarsBetweenSteps ?? 10;
    if (!ctx.sequenceState) ctx.sequenceState = { currentStep: 0, lastStepIndex: -1 };

    if (ctx.sequenceState.lastStepIndex >= 0 && ctx.currentIndex - ctx.sequenceState.lastStepIndex > maxBarsBetween) {
      ctx.sequenceState.currentStep = 0;
      ctx.sequenceState.lastStepIndex = -1;
    }

    const step = ctx.sequenceState.currentStep;
    if (step >= sequence.length) return false;

    const node = sequence[step];
    const ok = evalNode(ctx, node);

    if (ok) {
      ctx.sequenceState.currentStep++;
      ctx.sequenceState.lastStepIndex = ctx.currentIndex;
      if (ctx.sequenceState.currentStep >= sequence.length) {
        ctx.sequenceState.currentStep = 0;
        ctx.sequenceState.lastStepIndex = -1;
        return true;
      }
    }
    return false;
  }

  if (group.operator === "IF_THEN") {
    const ifNode = group.ifCondition ?? group.conditions[0];
    const thenNode = group.thenCondition ?? group.conditions[1];
    const maxBars = group.maxBarsToWait ?? 5;
    if (!ctx.ifThenState) ctx.ifThenState = { triggered: false, triggeredIndex: -1 };

    const ifOk = evalNode(ctx, ifNode);

    if (ifOk && !ctx.ifThenState.triggered) {
      ctx.ifThenState.triggered = true;
      ctx.ifThenState.triggeredIndex = ctx.currentIndex;
    }

    if (!ctx.ifThenState.triggered) return false;
    if (ctx.currentIndex - ctx.ifThenState.triggeredIndex > maxBars) {
      ctx.ifThenState.triggered = false;
      ctx.ifThenState.triggeredIndex = -1;
      return false;
    }

    const thenOk = evalNode(ctx, thenNode);

    if (thenOk) {
      ctx.ifThenState.triggered = false;
      ctx.ifThenState.triggeredIndex = -1;
      return true;
    }
    return false;
  }

  const results: boolean[] = [];
  for (const node of group.conditions) {
    results.push(evalNode(ctx, node));
  }

  switch (group.operator) {
    case "AND":
      return results.every(Boolean);
    case "OR":
      return results.some(Boolean);
    case "NOT":
      return !results[0];
    default:
      return false;
  }
}

function normalizeIndicatorCondition(condition: IndicatorCondition): EvalIndicatorCondition {
  const params: Record<string, number> = {};
  for (const [k, v] of Object.entries(condition.params ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) params[k] = v;
  }

  let compareTarget: CompareTarget;
  if (condition.compareTarget.type === "fixed") {
    compareTarget = { type: "fixed", value: condition.compareTarget.value };
  } else if (condition.compareTarget.type === "price") {
    compareTarget = { type: "price", priceType: condition.compareTarget.priceType };
  } else {
    const rightParams: Record<string, number> = {};
    for (const [k, v] of Object.entries(condition.compareTarget.params ?? {})) {
      if (typeof v === "number" && Number.isFinite(v)) rightParams[k] = v;
    }

    compareTarget = {
      type: "indicator",
      indicatorId: condition.compareTarget.indicatorId,
      params: rightParams,
      field: condition.compareTarget.field,
    };
  }

  // between の上限。v1 UI は固定値のみだが、価格/別指標も一応変換しておく。
  let compareTargetUpper: CompareTarget | undefined;
  const upper = condition.compareTargetUpper;
  if (upper) {
    if (upper.type === "fixed") {
      compareTargetUpper = { type: "fixed", value: upper.value };
    } else if (upper.type === "price") {
      compareTargetUpper = { type: "price", priceType: upper.priceType };
    } else {
      const upParams: Record<string, number> = {};
      for (const [k, v] of Object.entries(upper.params ?? {})) {
        if (typeof v === "number" && Number.isFinite(v)) upParams[k] = v;
      }
      compareTargetUpper = { type: "indicator", indicatorId: upper.indicatorId, params: upParams, field: upper.field };
    }
  }

  return {
    indicatorId: condition.indicatorId,
    params,
    field: condition.field,
    operator: condition.operator,
    compareTarget,
    compareTargetUpper,
  };
}

function normalizePatternCondition(condition: PatternCondition): EvalPatternCondition {
  return {
    patternId: condition.patternId,
    operator: condition.operator,
  };
}

function computeCandlestickPatterns(data: OHLCV[]): Map<CandlePatternId, boolean[]> {
  const n = data.length;
  const out = new Map<CandlePatternId, boolean[]>();
  const ids: CandlePatternId[] = [
    "pinbar",
    "pinbar_bull",
    "pinbar_bear",
    "hammer",
    "hammer_bull",
    "hammer_bear",
    "shooting_star",
    "engulfing_bull",
    "engulfing_bear",
    "doji",
    "thrust_bull",
    "thrust_bear",
  ];
  for (const id of ids) out.set(id, new Array(n).fill(false));

  for (let i = 0; i < n; i++) {
    const bar = data[i];
    const body = Math.abs(bar.close - bar.open);
    const range = Math.max(bar.high - bar.low, 0);
    if (range <= 0) continue;
    const upper = bar.high - Math.max(bar.open, bar.close);
    const lower = Math.min(bar.open, bar.close) - bar.low;

    // Python 側と定義を揃える（body==0 は除外）
    const bodyOk = body > 0;
    const pinbarBull = bodyOk && (lower >= 3 * body) && (upper <= 0.5 * body);
    const pinbarBear = bodyOk && (upper >= 3 * body) && (lower <= 0.5 * body);
    const pinbar = pinbarBull || pinbarBear;
    const hammer = (lower >= 2 * body) && (upper <= 0.5 * body);
    const hammerBull = hammer && (bar.close > bar.open);
    const hammerBear = hammer && (bar.close < bar.open);
    const shooting = (upper >= 2 * body) && (lower <= 0.5 * body);
    const doji = body <= 0.1 * range;
    const thrust = body >= 0.7 * range;
    const thrustBull = thrust && bar.close > bar.open;
    const thrustBear = thrust && bar.close < bar.open;

    out.get("pinbar")![i] = !!pinbar;
    out.get("pinbar_bull")![i] = !!pinbarBull;
    out.get("pinbar_bear")![i] = !!pinbarBear;
    out.get("hammer")![i] = !!hammer;
    out.get("hammer_bull")![i] = !!hammerBull;
    out.get("hammer_bear")![i] = !!hammerBear;
    out.get("shooting_star")![i] = !!shooting;
    out.get("doji")![i] = !!doji;
    out.get("thrust_bull")![i] = !!thrustBull;
    out.get("thrust_bear")![i] = !!thrustBear;

    if (i > 0) {
      const prev = data[i - 1];
      const prevBull = prev.close > prev.open;
      const prevBear = prev.close < prev.open;
      const currBull = bar.close > bar.open;
      const currBear = bar.close < bar.open;
      const engulfBull = prevBear && currBull && bar.open <= prev.close && bar.close >= prev.open;
      const engulfBear = prevBull && currBear && bar.open >= prev.close && bar.close <= prev.open;
      out.get("engulfing_bull")![i] = !!engulfBull;
      out.get("engulfing_bear")![i] = !!engulfBear;
    }
  }

  return out;
}

function generateFixedSampleData(count: number): OHLCV[] {
  // シナリオ: 上昇→押し目→レンジ→ブレイク→押し目
  const data: OHLCV[] = [];
  const start = new Date("2024-01-01T00:00:00Z");
  let price = 100;

  const pushBar = (open: number, close: number, high: number, low: number) => {
    const ts = new Date(start.getTime() + data.length * 60 * 60 * 1000);
    data.push({
      timestamp: ts.toISOString(),
      open,
      high,
      low,
      close,
      volume: 1000 + (data.length % 20) * 15,
    });
  };

  for (let i = 0; i < count; i++) {
    // 基本は滑らかなドリフト
    let drift = 0;
    if (i < 110) drift = 0.12; // 上昇
    else if (i < 150) drift = -0.08; // 押し目
    else if (i < 200) drift = 0.01; // レンジ
    else if (i < 230) drift = 0.18; // ブレイク上昇
    else drift = -0.06; // 押し目

    const noise = (Math.sin(i / 7) + Math.sin(i / 19)) * 0.03;
    const nextClose = price + drift + noise;
    const open = price;
    const close = nextClose;

    // ヒゲの基本幅
    const wick = 0.25 + (i % 9) * 0.01;
    let high = Math.max(open, close) + wick;
    let low = Math.min(open, close) - wick;

    // 教材用にパターンを意図的に埋め込む
    if (i === 135) {
      // ハンマー（下ヒゲ長）
      const c = close;
      const o = c - 0.05;
      high = c + 0.05;
      low = c - 1.2;
      pushBar(o, c, high, low);
      price = c;
      continue;
    }
    if (i === 165) {
      // ドージ
      const c = close;
      const o = c + 0.005;
      high = c + 0.6;
      low = c - 0.6;
      pushBar(o, c, high, low);
      price = c;
      continue;
    }
    if (i === 205) {
      // 包み足（強気）にしやすいように、前足を陰線に寄せる
      const c = close;
      const o = c + 0.3;
      high = o + 0.2;
      low = c - 0.2;
      pushBar(o, c, high, low);
      price = c;
      continue;
    }
    if (i === 206) {
      // 包み足（強気）
      const prev = data[data.length - 1];
      const o = prev.close - 0.2;
      const c = prev.open + 0.35;
      high = Math.max(o, c) + 0.15;
      low = Math.min(o, c) - 0.15;
      pushBar(o, c, high, low);
      price = c;
      continue;
    }
    if (i === 222) {
      // ピンバー（上ヒゲ）
      // 目的: ショート側の教材になりやすい形（上ヒゲ長 + 下ヒゲ短）を確実に作る。
      // 定義（本ファイル/analysis-engine と同一）:
      // - 上ヒゲ >= 3*実体 かつ 下ヒゲ <= 0.5*実体
      const c = close;
      const o = c + 0.03; // 実体を小さく（body=0.03）
      high = o + 1.37; // 上ヒゲを十分長く
      low = c - 0.01; // 下ヒゲを短く
      pushBar(o, c, high, low);
      price = c;
      continue;
    }

    pushBar(open, close, high, low);
    price = close;
  }

  return data;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * 指標のウォームアップ本数 (条件評価を開始する前にスキップするバー数) を見積もる。
 * 移動平均などは初期 N 本が安定しないため、条件に含まれる指標の最大ルックバックを採る。
 */
function estimateLookback(indicatorId: string, params: Record<string, number>): number {
  const id = indicatorId.toLowerCase();

  const pick = (keys: string[], fallback: number): number => {
    for (const k of keys) {
      const v = params[k];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
    }
    return fallback;
  };

  if (id === "sma" || id === "ema" || id === "rsi" || id === "atr" || id === "cci" || id === "roc" || id === "mfi" || id === "cmf" || id === "dema" || id === "tema") {
    return pick(["period", "length"], 20);
  }
  if (id === "bb" || id === "bollinger" || id === "bbands" || id === "kc") {
    return pick(["period", "length"], 20);
  }
  if (id === "stochastic" || id === "stoch") {
    return Math.max(pick(["kPeriod", "k"], 14), pick(["dPeriod", "d"], 3));
  }
  if (id === "macd") {
    const fast = pick(["fastPeriod", "fast"], 12);
    const slow = pick(["slowPeriod", "slow"], 26);
    const signal = pick(["signalPeriod", "signal"], 9);
    return Math.max(slow, fast) + signal;
  }
  if (id === "aroon") {
    return pick(["period", "length"], 25);
  }
  if (id === "psar") {
    // PSAR は厳密には期間で決まらないが、初期安定化のため最低限の本数を要求
    return 30;
  }
  if (id === "ichimoku") {
    return Math.max(pick(["spanBPeriod", "senkou"], 52), pick(["basePeriod", "kijun"], 26));
  }
  if (id === "vwap" || id === "obv" || id === "willr") {
    return pick(["period", "length"], 20);
  }

  return 50;
}

/** プレビューに供給する統一データ (実データ or サンプルのどちらでも同じ形)。 */
interface ResolvedPreview {
  /** チャート描画用 (timestamp は ms) */
  ohlcvData: OHLCVDataPoint[];
  /** 条件評価用 (eval は o/h/l/c のみ参照、timestamp は未使用) */
  evalData: OHLCV[];
  /** cacheKey → 値配列 (ohlcvData と同じ index) */
  indicatorCache: Map<string, number[]>;
  /** patternId → フラグ配列 (ohlcvData と同じ index) */
  patternCache: Map<CandlePatternId, boolean[]>;
  /** 固定サンプルで描画しているか (= 実データ取得不可) */
  isSample: boolean;
}

export function EntryPreviewMiniChart({
  entryConditions,
  symbol,
  timeframe,
  height = 360,
}: {
  entryConditions: ConditionGroup;
  /** プレビュー対象シンボル (例: USDJPY)。実データ取得に使う。 */
  symbol: string;
  /** プレビュー対象の時間足 (API 文字列、例: 1h)。未指定時は既定 TF。 */
  timeframe?: string;
  height?: number;
}) {
  const tf = timeframe ?? DEFAULT_TIMEFRAME_API;
  const debouncedConditions = useDebouncedValue(entryConditions, 400);

  // ---- 実ローソク足 (symbol/timeframe ごとに取得) ----
  const [realCandles, setRealCandles] = useState<OHLCVDataPoint[] | null>(null);
  const [candlesLoading, setCandlesLoading] = useState(true);
  const [candlesError, setCandlesError] = useState<string | null>(null);
  const [candlesWarning, setCandlesWarning] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    const controller = new AbortController();
    setCandlesLoading(true);
    setCandlesError(null);
    setCandlesWarning(null);
    // symbol/tf 変更時は旧シンボルのローソク足を即クリアする。残すとヘッダーは新 symbol/tf
    // なのに本体は旧データ・loading も出ない不整合になる (取得完了まで読み込み中表示にする)。
    setRealCandles(null);
    void (async () => {
      try {
        const res = await apiFetch(
          `/api/chart/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(tf)}&limit=${DEFAULT_DATA_COUNT}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errBody?.error || `APIエラー: ${res.status}`);
        }
        const payload: unknown = await res.json();
        const parsed = parseCandlesResponse(payload);
        if (!parsed) throw new Error("チャートデータの形式が不正です");
        if (aborted) return;
        const ohlcv = toOhlcvPoints(parsed.candles);
        setRealCandles(ohlcv);
        if (ohlcv.length === 0 && parsed.warning) setCandlesWarning(parsed.warning);
      } catch (err) {
        if (aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setRealCandles(null);
        setCandlesError(err instanceof Error ? err.message : "チャートデータ取得に失敗しました");
      } finally {
        if (!aborted) setCandlesLoading(false);
      }
    })();
    return () => {
      aborted = true;
      controller.abort();
    };
  }, [symbol, tf]);

  // ---- 実指標系列 (条件 + 期間ごとに analysis-engine から取得 → ローソク足へ整列) ----
  const [realAligned, setRealAligned] = useState<AlignedSeries | null>(null);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  useEffect(() => {
    if (!realCandles || realCandles.length === 0) {
      setRealAligned(null);
      setSeriesError(null);
      return;
    }
    const { specs, patternIds } = extractConditionRequirements(debouncedConditions);
    // 条件が空 (指標もパターンも無い) なら取得不要。空キャッシュで「指標なし」を即確定させる。
    if (specs.length === 0 && patternIds.length === 0) {
      setRealAligned({ indicatorCache: new Map(), patternCache: new Map() });
      setSeriesError(null);
      return;
    }

    let aborted = false;
    const controller = new AbortController();
    setSeriesError(null);
    // 条件/symbol/tf 変更で再取得する間は旧系列キャッシュをクリアする。残すと「古い系列 × 新条件」で
    // 評価して成立マーカー/件数が一時的に誤る。取得完了までは空キャッシュ (= 指標なし) で評価させる。
    setRealAligned(null);
    void (async () => {
      try {
        const startDate = new Date(realCandles[0].timestamp).toISOString();
        const endDate = new Date(realCandles[realCandles.length - 1].timestamp).toISOString();
        const response = await fetchChartIndicatorSeries({
          symbol,
          timeframe: tf,
          startDate,
          endDate,
          specs,
          patternIds,
          signal: controller.signal,
        });
        if (aborted) return;
        const aligned = alignSeriesToCandles(response, realCandles.map((c) => c.timestamp));
        setRealAligned(aligned);
      } catch (err) {
        if (aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setRealAligned(null);
        setSeriesError(err instanceof Error ? err.message : "指標計算の取得に失敗しました");
      }
    })();
    return () => {
      aborted = true;
      controller.abort();
    };
  }, [realCandles, debouncedConditions, symbol, tf]);

  // ローソク足が取得できた時のみ実データ。取れない (エラー / 空) ときは固定サンプルへ。
  const isRealReady = realCandles !== null && realCandles.length > 0;

  // 実データ or サンプルを同じ形に解決する。
  const resolved = useMemo<ResolvedPreview>(() => {
    if (isRealReady && realCandles) {
      const evalData: OHLCV[] = realCandles.map((d) => ({
        timestamp: String(d.timestamp),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume ?? 0,
      }));
      return {
        ohlcvData: realCandles,
        evalData,
        indicatorCache: realAligned?.indicatorCache ?? new Map<string, number[]>(),
        patternCache: realAligned?.patternCache ?? new Map<CandlePatternId, boolean[]>(),
        isSample: false,
      };
    }

    // フォールバック: 固定サンプル + フロント自前計算 (実データが無い時のみ)
    const sample = generateFixedSampleData(300);
    const ohlcvData: OHLCVDataPoint[] = sample.map((d) => ({
      timestamp: Date.parse(d.timestamp),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));
    const { specs } = extractConditionRequirements(debouncedConditions);
    const indicatorCache = new Map<string, number[]>();
    for (const spec of specs) {
      indicatorCache.set(
        makeIndicatorCacheKey(spec.indicatorId, spec.params, spec.field),
        computeIndicatorSeries(sample, spec.indicatorId, spec.params),
      );
    }
    return {
      ohlcvData,
      evalData: sample,
      indicatorCache,
      patternCache: computeCandlestickPatterns(sample),
      isSample: true,
    };
  }, [isRealReady, realCandles, realAligned, debouncedConditions]);

  // ウォームアップ本数 (条件の最大ルックバック + 余裕)
  const warmupBars = useMemo(() => {
    const { specs } = extractConditionRequirements(debouncedConditions);
    let maxLookback = 50;
    for (const spec of specs) {
      maxLookback = Math.max(maxLookback, estimateLookback(spec.indicatorId, spec.params));
    }
    return Math.min(Math.max(resolved.evalData.length - 1, 0), Math.max(30, maxLookback + 10));
  }, [debouncedConditions, resolved.evalData.length]);

  // 成立バーを抽出する純粋計算 (effect + setState ではなく同期 useMemo)。
  const entryIndices = useMemo(() => {
    const indices: number[] = [];
    const ctx: EvalContext = {
      data: resolved.evalData,
      currentIndex: 0,
      indicatorCache: resolved.indicatorCache,
      patternCache: resolved.patternCache,
    };
    for (let i = warmupBars; i < resolved.evalData.length; i++) {
      ctx.currentIndex = i;
      if (evalGroup(ctx, debouncedConditions)) indices.push(i);
    }
    return indices;
  }, [resolved, warmupBars, debouncedConditions]);

  // 成立バーの緑マーカー
  const markers: ChartMarker[] = useMemo(() => {
    const out: ChartMarker[] = [];
    for (const i of entryIndices) {
      const bar = resolved.ohlcvData[i];
      if (!bar) continue;
      out.push({ timestamp: bar.timestamp, position: "aboveBar", color: "#22c55e", shape: "circle" });
    }
    return out;
  }, [entryIndices, resolved.ohlcvData]);

  // 条件で使う指標を漏れなくオーバーレイ (価格系=メイン / オシレーター系=サブペイン)
  const indicatorLines: IndicatorLineConfig[] = useMemo(
    () => buildPreviewIndicatorLines(resolved.indicatorCache, resolved.ohlcvData.map((d) => d.timestamp)),
    [resolved],
  );

  const showLoadingBox = candlesLoading && realCandles === null && candlesError === null;
  const seriesPending = isRealReady && realAligned === null && seriesError === null;

  return (
    <div className="bg-slate-900/40 rounded-lg border border-slate-700 p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-200">プレビュー</span>
            {resolved.isSample ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 border border-amber-700 text-amber-300">
                サンプル
              </span>
            ) : (
              <>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-gray-300">{symbol}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-gray-300">{tf}</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-gray-400">
            {resolved.isSample
              ? "実データを取得できないため固定サンプルで表示しています"
              : "選択シンボル・時間足の実データで条件の成立箇所を表示"}
          </div>
        </div>
        <div className="text-[11px] text-gray-300 whitespace-nowrap">
          エントリー候補: <span className="text-green-300 font-semibold">{entryIndices.length}</span>
        </div>
      </div>

      {showLoadingBox ? (
        <div
          className="flex items-center justify-center rounded bg-slate-950/40 border border-slate-800 text-[12px] text-gray-400"
          style={{ height: `${height}px` }}
        >
          実データを読み込み中…
        </div>
      ) : (
        <div className="rounded bg-slate-950/40 border border-slate-800 overflow-hidden">
          <ChartPaneContainer
            ohlcvData={resolved.ohlcvData}
            indicators={indicatorLines}
            markers={markers}
            height={height}
          />
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
        <div>条件を変更すると「成立バー」が緑点で表示されます（デバウンス更新）。</div>
        {seriesPending && <div className="text-cyan-300">指標を計算中…</div>}
        {seriesError && <div className="text-amber-300">指標の取得に失敗（ローソク足のみ表示）</div>}
        {candlesWarning && <div className="text-amber-300">{candlesWarning}</div>}
        {resolved.isSample && candlesError && <div className="text-amber-400">{candlesError}</div>}
      </div>
    </div>
  );
}
