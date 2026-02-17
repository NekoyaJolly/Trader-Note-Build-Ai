"use client";

/**
 * エントリー条件プレビュー（固定サンプル）
 *
 * 目的:
 * - 初学者が「条件を作ると、どの状態でエントリーになるのか」を直感的に理解できるようにする
 * - 実相場データの有無に依存せず、常にヒット例が出る固定サンプルで学習できるようにする
 *
 * 方針:
 * - 指標計算はプレビュー用途としてフロント側で簡易計算（本番バックテストは analysis-engine が正）
 * - UIは最小限（ラインチャート + エントリーマーカー + 件数表示）
 */

import React, { useEffect, useMemo, useState } from "react";
import CandlestickChart, {
  ChartMarker,
  IndicatorLineConfig,
  OHLCVDataPoint,
} from "@/components/CandlestickChart";
import type {
  CandlePatternId,
  ComparisonOperator,
  ConditionGroup,
  IndicatorCondition,
  PatternCondition,
} from "@/types/strategy";
import { isIndicatorCondition, isPatternCondition } from "@/types/strategy";
import type { IndicatorParams } from "@/types/indicator";

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

function stableParamsKey(params: Record<string, number>): string {
  const keys = Object.keys(params).sort();
  const normalized: Record<string, number> = {};
  for (const k of keys) normalized[k] = params[k];
  return JSON.stringify(normalized);
}

function makeIndicatorCacheKey(indicatorId: string, params: Record<string, number>, field: string): string {
  return `${indicatorId.toLowerCase()}_${stableParamsKey(params)}_${field}`;
}

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

function computeIndicatorSeries(data: OHLCV[], indicatorId: string, params: Record<string, number>, field: string): number[] {
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

function evalIndicatorCondition(ctx: EvalContext, condition: EvalIndicatorCondition): boolean {
  const leftKey = makeIndicatorCacheKey(condition.indicatorId, condition.params, condition.field);
  const leftSeries = ctx.indicatorCache.get(leftKey);
  const leftValue = leftSeries?.[ctx.currentIndex];
  if (leftValue === undefined || !Number.isFinite(leftValue)) return false;

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
    const ok = isIndicatorCondition(node)
      ? evalIndicatorCondition(ctx, normalizeIndicatorCondition(node))
      : isPatternCondition(node)
        ? evalPatternCondition(ctx, normalizePatternCondition(node))
        : evalGroup(ctx, node as ConditionGroup);

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
    const ifNode = (group as any).ifCondition ?? group.conditions[0];
    const thenNode = (group as any).thenCondition ?? group.conditions[1];
    const maxBars = (group as any).maxBarsToWait ?? 5;
    if (!ctx.ifThenState) ctx.ifThenState = { triggered: false, triggeredIndex: -1 };

    const ifOk = isIndicatorCondition(ifNode)
      ? evalIndicatorCondition(ctx, normalizeIndicatorCondition(ifNode))
      : isPatternCondition(ifNode)
        ? evalPatternCondition(ctx, normalizePatternCondition(ifNode))
        : evalGroup(ctx, ifNode as ConditionGroup);

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

    const thenOk = isIndicatorCondition(thenNode)
      ? evalIndicatorCondition(ctx, normalizeIndicatorCondition(thenNode))
      : isPatternCondition(thenNode)
        ? evalPatternCondition(ctx, normalizePatternCondition(thenNode))
        : evalGroup(ctx, thenNode as ConditionGroup);

    if (thenOk) {
      ctx.ifThenState.triggered = false;
      ctx.ifThenState.triggeredIndex = -1;
      return true;
    }
    return false;
  }

  const results: boolean[] = [];
  for (const node of group.conditions) {
    const ok = isIndicatorCondition(node)
      ? evalIndicatorCondition(ctx, normalizeIndicatorCondition(node))
      : isPatternCondition(node)
        ? evalPatternCondition(ctx, normalizePatternCondition(node))
        : evalGroup(ctx, node as ConditionGroup);
    results.push(ok);
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

  return {
    indicatorId: condition.indicatorId,
    params,
    field: condition.field,
    operator: condition.operator,
    compareTarget,
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
    "hammer",
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

    const pinbar = ((lower >= 3 * body) && (upper <= 0.5 * body)) || ((upper >= 3 * body) && (lower <= 0.5 * body));
    const hammer = (lower >= 2 * body) && (upper <= 0.5 * body);
    const shooting = (upper >= 2 * body) && (lower <= 0.5 * body);
    const doji = body <= 0.1 * range;
    const thrust = body >= 0.7 * range;
    const thrustBull = thrust && bar.close > bar.open;
    const thrustBear = thrust && bar.close < bar.open;

    out.get("pinbar")![i] = !!pinbar;
    out.get("hammer")![i] = !!hammer;
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

export function EntryPreviewMiniChart({
  entryConditions,
  height = 260,
}: {
  entryConditions: ConditionGroup;
  height?: number;
}) {
  const sampleData = useMemo(() => generateFixedSampleData(300), []);
  const debouncedConditions = useDebouncedValue(entryConditions, 400);

  const [entryIndices, setEntryIndices] = useState<number[]>([]);

  const { indicatorCache, patternCache, warmupBars } = useMemo(() => {
    // 条件から必要な指標specを抽出（左辺＋右辺indicator）
    const specs = new Map<string, { indicatorId: string; params: Record<string, number>; field: string }>();

    const visit = (node: ConditionGroup | IndicatorCondition | PatternCondition) => {
      if ((node as any).conditions) {
        for (const c of (node as ConditionGroup).conditions) visit(c as any);
        if ((node as any).operator === "IF_THEN") {
          const ifNode = (node as any).ifCondition;
          const thenNode = (node as any).thenCondition;
          if (ifNode) visit(ifNode);
          if (thenNode) visit(thenNode);
        }
        return;
      }

      if (isPatternCondition(node as any)) return;
      if (!isIndicatorCondition(node as any)) return;

      const cond = node as IndicatorCondition;
      const leftParams: Record<string, number> = {};
      for (const [k, v] of Object.entries(cond.params ?? {})) {
        if (typeof v === "number" && Number.isFinite(v)) leftParams[k] = v;
      }
      const leftKey = makeIndicatorCacheKey(cond.indicatorId, leftParams, cond.field);
      specs.set(leftKey, { indicatorId: cond.indicatorId, params: leftParams, field: cond.field });

      if (cond.compareTarget.type === "indicator") {
        const rightParams: Record<string, number> = {};
        for (const [k, v] of Object.entries(cond.compareTarget.params ?? {})) {
          if (typeof v === "number" && Number.isFinite(v)) rightParams[k] = v;
        }
        const rightKey = makeIndicatorCacheKey(cond.compareTarget.indicatorId, rightParams, cond.compareTarget.field);
        specs.set(rightKey, { indicatorId: cond.compareTarget.indicatorId, params: rightParams, field: cond.compareTarget.field });
      }
    };

    visit(debouncedConditions);

    const cache = new Map<string, number[]>();
    for (const spec of specs.values()) {
      const series = computeIndicatorSeries(sampleData, spec.indicatorId, spec.params, spec.field);
      const key = makeIndicatorCacheKey(spec.indicatorId, spec.params, spec.field);
      cache.set(key, series);
    }

    const estimateLookback = (indicatorId: string, params: Record<string, number>): number => {
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
    };

    let maxLookback = 50;
    for (const spec of specs.values()) {
      maxLookback = Math.max(maxLookback, estimateLookback(spec.indicatorId, spec.params));
    }

    // 余裕を少し足してから判定開始（移動平均の安定化）
    const warmup = Math.min(sampleData.length - 1, Math.max(30, maxLookback + 10));

    const patterns = computeCandlestickPatterns(sampleData);
    return { indicatorCache: cache, patternCache: patterns, warmupBars: warmup };
  }, [debouncedConditions, sampleData]);

  useEffect(() => {
    // 300本のうち、エントリー成立バーを抽出
    const indices: number[] = [];
    const ctx: EvalContext = {
      data: sampleData,
      currentIndex: 0,
      indicatorCache,
      patternCache,
    };

    // 指標のウォームアップ（条件に応じて）を考慮して前半をスキップ
    for (let i = warmupBars; i < sampleData.length; i++) {
      ctx.currentIndex = i;
      const hit = evalGroup(ctx, debouncedConditions);
      if (hit) indices.push(i);
    }
    setEntryIndices(indices);
  }, [debouncedConditions, indicatorCache, patternCache, sampleData, warmupBars]);

  const ohlcvData: OHLCVDataPoint[] = useMemo(() => {
    return sampleData.map((d) => ({
      timestamp: Date.parse(d.timestamp),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));
  }, [sampleData]);

  const overlayIndicatorKeys = useMemo(() => {
    // プレビューで計算済みのうち、価格スケールで重ねられるものだけを表示
    const keys: string[] = [];
    for (const key of indicatorCache.keys()) {
      const id = key.split("_")[0] ?? "";
      if (["ema", "sma", "vwap", "bb", "kc", "psar"].includes(id)) {
        keys.push(key);
      }
    }
    return keys.slice(0, 3);
  }, [indicatorCache]);

  const indicatorLines: IndicatorLineConfig[] = useMemo(() => {
    // 既存で使っている色のみ（新規の色を増やさない）
    const palette = ["#06b6d4", "#8b5cf6", "#f59e0b"];

    const lines: IndicatorLineConfig[] = [];
    for (let idx = 0; idx < overlayIndicatorKeys.length; idx++) {
      const key = overlayIndicatorKeys[idx]!;
      const series = indicatorCache.get(key);
      if (!series) continue;

      const [rawId, rawParams, rawField] = key.split("_");
      const indicatorId = rawId ?? "";
      const field = rawField ?? "value";

      let name = indicatorId.toUpperCase();
      if (rawParams) {
        try {
          const params = JSON.parse(rawParams) as Record<string, number>;
          const values = Object.values(params);
          if (values.length > 0) name = `${name}(${values.join(",")})`;
        } catch {
          // 失敗時は最小表示
        }
      }
      if (field !== "value") name = `${name}.${field}`;

      const data: { timestamp: number; value: number }[] = [];
      for (let i = 0; i < ohlcvData.length; i++) {
        const v = series[i];
        if (v === undefined || !Number.isFinite(v)) continue;
        data.push({ timestamp: ohlcvData[i]!.timestamp, value: v });
      }

      lines.push({
        id: key,
        name,
        data,
        color: palette[idx % palette.length]!,
        lineWidth: 2,
        pane: "main",
      });
    }

    return lines;
  }, [indicatorCache, ohlcvData, overlayIndicatorKeys]);

  const markers: ChartMarker[] = useMemo(() => {
    const out: ChartMarker[] = [];
    for (const i of entryIndices) {
      const bar = ohlcvData[i];
      if (!bar) continue;
      out.push({
        timestamp: bar.timestamp,
        position: "aboveBar",
        color: "#22c55e",
        shape: "circle",
      });
    }
    return out;
  }, [entryIndices, ohlcvData]);

  const focusTimestamp = useMemo(() => {
    const idx = entryIndices[0] ?? 222;
    const bar = ohlcvData[Math.max(0, Math.min(idx, ohlcvData.length - 1))];
    return bar?.timestamp ?? null;
  }, [entryIndices, ohlcvData]);

  return (
    <div className="bg-slate-900/40 rounded-lg border border-slate-700 p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-semibold text-gray-200">プレビュー（固定サンプル）</div>
          <div className="text-[11px] text-gray-400">上昇→押し目→レンジ→ブレイク→押し目（300本）</div>
        </div>
        <div className="text-[11px] text-gray-300">
          エントリー候補: <span className="text-green-300 font-semibold">{entryIndices.length}</span>
        </div>
      </div>

      <div className="rounded bg-slate-950/40 border border-slate-800">
        <CandlestickChart
          ohlcvData={ohlcvData}
          indicators={indicatorLines}
          markers={markers}
          height={height}
          focusTimestamp={focusTimestamp}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
        <div>条件を変更すると「成立バー」が緑点で表示されます（デバウンス更新）。</div>
        {overlayIndicatorKeys.length > 0 && (
          <div className="text-gray-400">表示中の指標: {overlayIndicatorKeys.map((k) => k.split('_')[0]?.toUpperCase()).join(', ')}</div>
        )}
      </div>
    </div>
  );
}
