/**
 * ストラテジー条件評価サービス（共通ロジック）
 * 
 * 目的:
 * - バックテストとリアルタイム監視の両方で使用可能な条件評価ロジック
 * - インジケーター計算の共通化
 * - DRY 原則に従った実装
 */

import type { StrategyDetail } from './strategyService';
import { makeIndicatorCacheKey } from './analysisEngineClient';
// post-Phase 5A: Side-A / Side-B 共通の比較演算ライブラリを使う (drift 防止)。
import { compareValues as sharedCompareValues } from '../../shared/strategy-evaluator/operators';
// レンズ条件タイプ (#3): featureKey の比較種別と数値エンコードはレンズ基盤カタログが単一情報源
import {
  encodeLensFeatureValueAsNumber,
  getLensFeatureComparator,
} from '../../shared/similarity/lensComparators';

// ============================================
// 型定義
// ============================================

/** 論理演算子 */
export type LogicalOperator = 'AND' | 'OR' | 'NOT' | 'IF_THEN' | 'SEQUENCE';

/**
 * 比較演算子。Side-A 既存型を維持しつつ、shared 側の `ComparisonOperator` の subset
 * となるよう揃える (= shared に追加された is_true/is_false/between/in は Side-A の
 * 比較経路では使わない)。
 */
export type ComparisonOperator =
  | '<'
  | '<='
  | '='
  | '>='
  | '>'
  | 'between'
  | 'not_between'
  | 'cross_above'
  | 'cross_below'
  | 'touch_close'
  | 'touch_wick'
  // UI/保存形式の拡張（後方互換）
  | 'GC'
  | 'DC'
  | 'Touch'
  | 'touch';

/** ローソク足パターンID */
export type CandlePatternId =
  | 'pinbar'
  | 'pinbar_bull'
  | 'pinbar_bear'
  | 'hammer'
  | 'hammer_bull'
  | 'hammer_bear'
  | 'shooting_star'
  | 'engulfing_bull'
  | 'engulfing_bear'
  | 'doji'
  | 'thrust_bull'
  | 'thrust_bear';

export type PatternOperator = 'is_true' | 'is_false';

/** インジケーター条件 */
export interface IndicatorCondition {
  conditionId: string;
  indicatorId: string;
  params: Record<string, number>;
  field: string;
  operator: ComparisonOperator;
  compareTarget: {
    type: 'fixed' | 'indicator' | 'price';
    value?: number;
    indicatorId?: string;
    params?: Record<string, number>;
    field?: string;
    priceType?: 'open' | 'high' | 'low' | 'close';
  };
  // between / not_between 専用: 上限（compareTarget は下限）
  compareTargetUpper?: {
    type: 'fixed' | 'indicator' | 'price';
    value?: number;
    indicatorId?: string;
    params?: Record<string, number>;
    field?: string;
    priceType?: 'open' | 'high' | 'low' | 'close';
  };
  // 直近ルックバック: 直近 N 本以内（現在足含む）に成立で true。未指定/1 は現在足のみ
  // (timeframeOverride 指定時はその足の本数で数える)
  lookbackBars?: number;
  /**
   * マルチタイムフレーム条件 (Phase γ): この条件だけ別の時間足で評価する。
   * 未指定 = ストラテジーの基準足。上位足は「確定バーのみ」参照する
   * (進行中の上位足バーは見ない = lookahead 防止)。
   */
  timeframeOverride?: string;
}

/** ローソク足パターン条件 */
export interface PatternCondition {
  conditionId: string;
  type: 'pattern';
  patternId: CandlePatternId;
  operator: PatternOperator;
  // 直近ルックバック: 直近 N 本以内（現在足含む）に出現で true。未指定/1 は現在足のみ
  // (timeframeOverride 指定時はその足の本数で数える)
  lookbackBars?: number;
  /** マルチタイムフレーム条件 (Phase γ)。IndicatorCondition と同義 */
  timeframeOverride?: string;
}

/**
 * レンズ条件の比較演算子。
 * featureKey の比較種別(lensComparators カタログ)ごとに UI 側で使える演算子を制限する
 * (enum/event/bool は =/!=、数値系は </<=/>=/>)。評価器は全演算子を防御的に処理する。
 */
export type LensConditionOperator = '=' | '!=' | '<' | '<=' | '>=' | '>';

/**
 * レンズ条件 (レンズ条件タイプ #3。設計書 NOTE_SIMILARITY_FOUNDATION.md §12.4)。
 *
 * 柱1(ノート類似)のインジケーターレンズが出す正規化済み特徴
 * (例: `ind:rsi#p14` の `rsi_zone`)を、柱2(条件ツリー)の leaf 条件として評価する。
 * 系列は appendLensSeriesToCache が per-bar 数値エンコード済みで
 * `lens:<lensId>:<featureKey>` キーに格納したものを参照する。
 */
export interface LensCondition {
  conditionId: string;
  type: 'lens';
  /** レンズ ID(パラメータ識別子込み。例 `ind:rsi#p14` / `ind:ma_cross#ema20xsma75`) */
  lensId: string;
  /** 比較する featureKey(例 `rsi_zone`)。比較種別は lensComparators カタログで解決 */
  featureKey: string;
  operator: LensConditionOperator;
  /** enum/event は文字列、bool は真偽値、数値系は number */
  value: number | string | boolean;
  // 直近ルックバック: 直近 N 本以内（現在足含む）に成立で true。未指定/1 は現在足のみ
  lookbackBars?: number;
  /** マルチタイムフレーム条件。IndicatorCondition と同義(確定バーのみ参照) */
  timeframeOverride?: string;
}

/** レンズ系列のキャッシュキー規約(設計書 §12.6 確定: `lens:<lensId>:<featureKey>`) */
export function makeLensCacheKey(lensId: string, featureKey: string): string {
  return `lens:${lensId}:${featureKey}`;
}

// ============================================
// 時間条件（時間帯 / 曜日 / セッション、JST 基準）
//
// 注意: 本ロジックはフロント types/strategy.ts の evaluateTimeConditionAt と同等。
// フロントは src/shared を import しない構成のため二重化している（compareValues と同じ方針）。
// 仕様変更時は両方を同時に直すこと。
// ============================================

export type SessionId = 'tokyo' | 'london' | 'newyork';

export type TimeCondition =
  | { conditionId: string; type: 'time'; kind: 'time_range'; startMinutes: number; endMinutes: number; negate?: boolean }
  | { conditionId: string; type: 'time'; kind: 'day_of_week'; days: number[]; negate?: boolean }
  | { conditionId: string; type: 'time'; kind: 'session'; session: SessionId; negate?: boolean };

/** セッションのプリセット時間帯（JST、DST 非考慮の目安。Neko 判断 2026-06-08） */
const SESSION_PRESETS_JST: Record<SessionId, { startMinutes: number; endMinutes: number }> = {
  tokyo: { startMinutes: 8 * 60, endMinutes: 17 * 60 },
  london: { startMinutes: 16 * 60, endMinutes: 1 * 60 },
  newyork: { startMinutes: 21 * 60, endMinutes: 6 * 60 },
};

const JST_OFFSET_MINUTES = 9 * 60;

function jstPartsOf(epochMs: number): { minutes: number; day: number } {
  const shifted = new Date(epochMs + JST_OFFSET_MINUTES * 60_000);
  return {
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    day: shifted.getUTCDay(),
  };
}

function minutesInRange(minutes: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) return minutes >= startMinutes && minutes < endMinutes;
  return minutes >= startMinutes || minutes < endMinutes; // 日跨ぎ
}

/** 時間条件を、あるバーの timestamp(epoch ms) に対して評価する純粋関数 */
export function evaluateTimeConditionAt(condition: TimeCondition, epochMs: number): boolean {
  if (!Number.isFinite(epochMs)) return false;
  const { minutes, day } = jstPartsOf(epochMs);

  let hit: boolean;
  if (condition.kind === 'time_range') {
    hit = minutesInRange(minutes, condition.startMinutes, condition.endMinutes);
  } else if (condition.kind === 'day_of_week') {
    hit = condition.days.includes(day);
  } else {
    const preset = SESSION_PRESETS_JST[condition.session];
    hit = minutesInRange(minutes, preset.startMinutes, preset.endMinutes);
  }
  return condition.negate ? !hit : hit;
}

/** 条件グループ */
export interface ConditionGroup {
  groupId: string;
  operator: LogicalOperator;
  conditions: (IndicatorCondition | PatternCondition | TimeCondition | LensCondition | ConditionGroup)[];
  // IF-THEN専用
  ifCondition?: ConditionGroup | IndicatorCondition | PatternCondition | LensCondition;
  thenCondition?: ConditionGroup | IndicatorCondition | PatternCondition | LensCondition;
  maxBarsToWait?: number;
  // SEQUENCE専用
  sequence?: (ConditionGroup | IndicatorCondition | PatternCondition | LensCondition)[];
  maxBarsBetweenSteps?: number;
}

/** OHLCVデータ */
export interface OHLCV {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * マルチタイムフレーム条件用の別時間足ビュー (Phase γ)。
 * 基準足とは別の時間足のバー列・指標/パターン系列と、
 * 「基準足 index → このビューで参照してよい確定バー index」の対応表を持つ。
 */
export interface TimeframeView {
  data: OHLCV[];
  indicatorCache: Map<string, number[]>;
  patternCache?: Map<CandlePatternId, boolean[]>;
  /** 基準足 index → ビュー側 index。対応する確定バーがまだ無い場合は -1 */
  indexMap: number[];
}

/** 条件評価コンテキスト */
export interface EvaluationContext {
  data: OHLCV[];
  currentIndex: number;
  indicatorCache: Map<string, number[]>;
  patternCache?: Map<CandlePatternId, boolean[]>;
  strategy: StrategyDetail;
  /** timeframeOverride 条件が参照する別時間足ビュー (キー = 時間足文字列。Phase γ) */
  timeframeViews?: Map<string, TimeframeView>;
  // IF-THEN用の状態管理
  ifThenState?: {
    triggered: boolean;
    triggeredIndex: number;
    maxWaitBars: number;
  };
  // SEQUENCE用の状態管理
  sequenceState?: {
    currentStep: number;
    lastStepIndex: number;
    maxBarsBetween: number;
  };
}

// ============================================
// インジケーター計算
// ============================================

/**
 * インジケーター値を計算してキャッシュに格納
 * 
 * @param ctx - 評価コンテキスト
 * @param indicatorId - インジケーターID（'rsi', 'sma', 'ema', 'macd', 'bb'）
 * @param params - パラメータ（period, fastPeriod, slowPeriod など）
 * @param field - フィールド名（'value', 'signal', 'histogram', 'upper', 'lower' など）
 * @returns インジケーター値（計算不可の場合は undefined）
 */
export function getIndicatorValue(
  ctx: EvaluationContext,
  indicatorId: string,
  params: Record<string, number>,
  field: string
): Promise<number | undefined> {
  const cacheKey = makeIndicatorCacheKey(indicatorId, params, field);

  // 原則: インジケーター計算は analysis-engine（Python / pandas-ta）に委譲する。
  // ここでは「キャッシュに存在する値のみ」を参照する。
  if (!ctx.indicatorCache.has(cacheKey)) {
    console.warn(`[ConditionEvaluator] インジケーター値がキャッシュに存在しません（analysis-engine 未取得の可能性）: ${cacheKey}`);
    return Promise.resolve(undefined);
  }

  const cached = ctx.indicatorCache.get(cacheKey);
  if (!cached) return Promise.resolve(undefined);

  const value = cached[ctx.currentIndex];
  // pandas-ta の計算初期は欠損が発生しやすい（NaN）ため、undefined に寄せる
  return Promise.resolve(Number.isFinite(value) ? value : undefined);
}

/**
 * 価格値を取得
 * 
 * @param ctx - 評価コンテキスト
 * @param priceType - 価格タイプ（'open', 'high', 'low', 'close'）
 * @returns 価格値
 */
export function getPriceValue(ctx: EvaluationContext, priceType: string): number {
  const bar = ctx.data[ctx.currentIndex];
  switch (priceType) {
    case 'open': return bar.open;
    case 'high': return bar.high;
    case 'low': return bar.low;
    case 'close':
    default: return bar.close;
  }
}

// ============================================
// 条件評価
// ============================================

/**
 * 比較演算を実行 (post-Phase 5A: shared/strategy-evaluator/operators に委譲)。
 *
 * Side-A / Side-B 両方で同じ評価結果になるよう、本関数は shared 側の `compareValues`
 * を呼び出す薄いアダプタ。
 *
 * `touch_wick` は型上は `ComparisonOperator` に含まれるが、shared 側の compareValues
 * では false を返す (= バーの high-low レンジ判定が必要なため)。実際の判定は
 * `evaluateCondition` 側で `touch_wick` を早期 return + `bar.low <= left && left <= bar.high`
 * で行っている。本アダプタは touch_wick が来ても shared の挙動 (= false 返し) に従う。
 *
 * @param left - 左辺値
 * @param right - 右辺値
 * @param operator - 比較演算子
 * @param prevLeft - 前回の左辺値（クロス判定用）
 * @param prevRight - 前回の右辺値（クロス判定用）
 * @returns 比較結果
 */
function compareValues(
  left: number,
  right: number,
  operator: ComparisonOperator,
  prevLeft?: number,
  prevRight?: number,
): boolean {
  // between / not_between は専用経路（evaluateCondition）で 2 値を解決して判定するため、
  // 単一 right の本関数では扱わない（ここに来たら不成立）。
  if (operator === 'between' || operator === 'not_between') return false;
  // Side-A の op は shared op の subset なので as キャスト相当で渡せる
  return sharedCompareValues(left, right, operator, prevLeft, prevRight);
}

/** 比較対象（固定値 / 価格 / 別指標）を数値に解決する（between の下限・上限用） */
async function resolveCompareTarget(
  ctx: EvaluationContext,
  target: IndicatorCondition['compareTargetUpper'],
): Promise<number | undefined> {
  if (!target) return undefined;
  if (target.type === 'fixed') {
    // 値欠落 (undefined / NaN) はサイレントに 0 扱いせず undefined を返し、範囲判定を不成立にする
    return typeof target.value === 'number' && Number.isFinite(target.value) ? target.value : undefined;
  }
  if (target.type === 'price') return getPriceValue(ctx, target.priceType || 'close');
  return getIndicatorValue(ctx, target.indicatorId || '', target.params || {}, target.field || 'value');
}

/**
 * 単一条件を評価
 * 
 * @param ctx - 評価コンテキスト
 * @param condition - インジケーター条件
 * @returns 条件成立の場合 true
 */
export async function evaluateCondition(
  ctx: EvaluationContext,
  condition: IndicatorCondition
): Promise<boolean> {
  // 左辺（インジケーター値）を取得
  const leftValue = await getIndicatorValue(
    ctx,
    condition.indicatorId,
    condition.params,
    condition.field
  );
  
  if (leftValue === undefined) return false;

  // 範囲（between / not_between）: 下限 compareTarget・上限 compareTargetUpper を解決して判定
  if (condition.operator === 'between' || condition.operator === 'not_between') {
    const lo = await resolveCompareTarget(ctx, condition.compareTarget);
    const hi = await resolveCompareTarget(ctx, condition.compareTargetUpper);
    if (lo === undefined || hi === undefined) return false;
    const inRange = leftValue >= Math.min(lo, hi) && leftValue <= Math.max(lo, hi);
    return condition.operator === 'between' ? inRange : !inRange;
  }

  // 右辺を取得
  let rightValue: number;
  
  if (condition.compareTarget.type === 'fixed') {
    rightValue = condition.compareTarget.value || 0;
  } else if (condition.compareTarget.type === 'indicator') {
    const indicatorVal = await getIndicatorValue(
      ctx,
      condition.compareTarget.indicatorId || '',
      condition.compareTarget.params || {},
      condition.compareTarget.field || 'value'
    );
    if (indicatorVal === undefined) return false;
    rightValue = indicatorVal;
  } else {
    rightValue = getPriceValue(ctx, condition.compareTarget.priceType || 'close');
  }
  
  // 特殊: ヒゲタッチは「当該バーの high-low 到達」を使う（価格が線に触れるイメージ）
  if (condition.operator === 'touch_wick') {
    // 左辺（指標/数値）が、当該バーのレンジに入っているか
    const bar = ctx.data[ctx.currentIndex];
    const inRange = bar.low <= leftValue && leftValue <= bar.high;

    // 右辺が価格の場合は「価格が線に触れた」をこの判定に寄せる
    // 右辺が固定値/別指標の場合でも、ユーザー意図は「線（左辺）にレートが当たる」なので inRange を優先する
    return inRange;
  }

  // クロス判定用の前回値を取得
  let prevLeft: number | undefined;
  let prevRight: number | undefined;

  const needsPrev = [
    'cross_above',
    'cross_below',
    // 後方互換/拡張
    'GC',
    'DC',
    'Touch',
    'touch',
  ].includes(condition.operator);

  if (needsPrev) {
    if (ctx.currentIndex > 0) {
      const prevCtx = { ...ctx, currentIndex: ctx.currentIndex - 1 };
      prevLeft = await getIndicatorValue(prevCtx, condition.indicatorId, condition.params, condition.field);
      
      if (condition.compareTarget.type === 'fixed') {
        prevRight = condition.compareTarget.value;
      } else if (condition.compareTarget.type === 'indicator') {
        prevRight = await getIndicatorValue(
          prevCtx,
          condition.compareTarget.indicatorId || '',
          condition.compareTarget.params || {},
          condition.compareTarget.field || 'value'
        );
      } else {
        prevRight = getPriceValue(prevCtx, condition.compareTarget.priceType || 'close');
      }
    }
  }
  
  return compareValues(leftValue, rightValue, condition.operator, prevLeft, prevRight);
}

/** パターン条件を評価 */
export function evaluatePatternCondition(
  ctx: EvaluationContext,
  condition: PatternCondition
): Promise<boolean> {
  const series = ctx.patternCache?.get(condition.patternId);
  if (!series) return Promise.resolve(false);

  const flag = series[ctx.currentIndex] ?? false;
  return Promise.resolve(condition.operator === 'is_false' ? !flag : !!flag);
}

type ConditionChildItem = IndicatorCondition | PatternCondition | TimeCondition | LensCondition | ConditionGroup;

/** item の基本評価（ルックバックは考慮しない）。種別ごとに適切な評価関数へ振り分ける。 */
/**
 * 基準足 index → 別時間足ビューの「確定バー」index の対応表を作る (Phase γ MTF)。
 *
 * 対応規則: ビュー側バー j の終了時刻 (timestamp + viewTfMs) が、基準足バー i の
 * 終了時刻 (timestamp + baseTfMs) 以下である最大の j。該当が無ければ -1。
 * これにより上位足は「確定した直前バー」だけを参照し、進行中バーによる
 * lookahead (バックテストの将来参照) を構造的に防ぐ。
 * 両バー列は timestamp 昇順前提 (2 ポインタ、O(n+m))。
 */
export function buildTimeframeIndexMap(
  baseBars: ReadonlyArray<OHLCV>,
  baseTfMs: number,
  viewBars: ReadonlyArray<OHLCV>,
  viewTfMs: number
): number[] {
  const indexMap: number[] = new Array<number>(baseBars.length).fill(-1);
  let j = -1;
  for (let i = 0; i < baseBars.length; i++) {
    const baseClose = baseBars[i].timestamp.getTime() + baseTfMs;
    while (
      j + 1 < viewBars.length &&
      viewBars[j + 1].timestamp.getTime() + viewTfMs <= baseClose
    ) {
      j++;
    }
    indexMap[i] = j;
  }
  return indexMap;
}

/**
 * 条件ツリーから timeframeOverride に使われている時間足を収集する (Phase γ MTF)。
 * backtest / live がどの時間足のバー・指標系列を準備すべきかの単一情報源。
 * baseTimeframe と同じ値は「上書きなし」と同義なので含めない。
 */
export function collectTimeframeOverrides(
  group: ConditionGroup | null | undefined,
  baseTimeframe: string
): Set<string> {
  const result = new Set<string>();
  const visitItem = (item: ConditionChildItem | undefined | null): void => {
    if (!item) return;
    const itemType = (item as { type?: string }).type;
    if ('indicatorId' in item || itemType === 'pattern' || itemType === 'lens') {
      const tf = (item as { timeframeOverride?: string }).timeframeOverride;
      if (tf && tf !== baseTimeframe) {
        result.add(tf);
      }
      return;
    }
    if (itemType === 'time') return;
    visitGroup(item as ConditionGroup);
  };
  const visitGroup = (g: ConditionGroup | null | undefined): void => {
    if (!g) return;
    for (const child of g.conditions ?? []) visitItem(child);
    visitItem(g.ifCondition);
    visitItem(g.thenCondition);
    for (const step of g.sequence ?? []) visitItem(step);
  };
  visitGroup(group);
  return result;
}

/**
 * 条件ツリーからレンズ条件を収集する (レンズ条件タイプ #3)。
 * backtest / live が「どのレンズ系列を準備すべきか」を決める単一情報源。
 * timeframeOverride 付きの条件も含めて返す(呼び出し側が足ごとに振り分ける)。
 */
export function collectLensConditions(
  group: ConditionGroup | null | undefined
): LensCondition[] {
  const result: LensCondition[] = [];
  const visitItem = (item: ConditionChildItem | undefined | null): void => {
    if (!item) return;
    if ('indicatorId' in item) return;
    const itemType = (item as { type?: string }).type;
    if (itemType === 'lens') {
      result.push(item as LensCondition);
      return;
    }
    if (itemType === 'pattern' || itemType === 'time') return;
    visitGroup(item as ConditionGroup);
  };
  const visitGroup = (g: ConditionGroup | null | undefined): void => {
    if (!g) return;
    for (const child of g.conditions ?? []) visitItem(child);
    visitItem(g.ifCondition);
    visitItem(g.thenCondition);
    for (const step of g.sequence ?? []) visitItem(step);
  };
  visitGroup(group);
  return result;
}

/**
 * レンズ条件を評価する (レンズ条件タイプ #3。設計書 §12.4)。
 *
 * 系列は appendLensSeriesToCache が `lens:<lensId>:<featureKey>` キーで
 * indicatorCache に格納した「数値エンコード済み per-bar 系列」を参照する。
 * 欠損バー(NaN)・sentinel(イベント未発生)・エンコード不能な条件値は
 * すべて「条件不成立」に倒す(誤発火より発火しない側へ。§12.4-4)。
 */
export function evaluateLensCondition(
  ctx: EvaluationContext,
  condition: LensCondition
): boolean {
  const cacheKey = makeLensCacheKey(condition.lensId, condition.featureKey);
  const series = ctx.indicatorCache.get(cacheKey);
  if (!series) {
    console.warn(
      `[ConditionEvaluator] レンズ系列がキャッシュに存在しません(レンズ系列の準備漏れの可能性): ${cacheKey}`
    );
    return false;
  }
  const left = series[ctx.currentIndex];
  if (left === undefined || !Number.isFinite(left)) return false;

  const comparator = getLensFeatureComparator(condition.lensId, condition.featureKey);
  // sentinel(例: bars_since = -1 「イベント未発生」)を数値比較すると
  // 「-1 < 5 = true」のような誤判定になるため、比較せず不成立に倒す
  if (
    comparator?.kind === 'normalizedLinear' &&
    comparator.sentinel !== undefined &&
    left === comparator.sentinel
  ) {
    return false;
  }
  const right = encodeLensFeatureValueAsNumber(comparator, condition.value);
  if (right === null) return false;

  switch (condition.operator) {
    case '=':
      return left === right;
    case '!=':
      return left !== right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>=':
      return left >= right;
    case '>':
      return left > right;
    default:
      return false;
  }
}

/**
 * timeframeOverride 付き条件の評価ビューを解決する (Phase γ MTF)。
 * - override 無し → 基準コンテキストをそのまま返す
 * - override あり → 対応する TimeframeView の確定バー位置に切り替えたコンテキストを返す
 * - ビュー未準備 / 確定バーがまだ無い → null (= 条件不成立として扱う)
 */
function resolveViewContext(
  ctx: EvaluationContext,
  item: ConditionChildItem
): EvaluationContext | null {
  const tf = (item as { timeframeOverride?: string }).timeframeOverride;
  // 未指定、または基準足と同値は「上書きなし」として基準コンテキストで評価する。
  // collect 側も基準足を除外するためビューは準備されない。両者を一致させて
  // 「同じ足を選ぶと常に不成立」を防ぐ (UI でも基準足と同じ足を選べる。Copilot レビュー対応)
  if (!tf || tf === ctx.strategy.timeframe) return ctx;

  const view = ctx.timeframeViews?.get(tf);
  if (!view) {
    console.warn(
      `[ConditionEvaluator] timeframeOverride=${tf} のビューが未準備のため条件を不成立として扱います`
    );
    return null;
  }
  const viewIndex = view.indexMap[ctx.currentIndex] ?? -1;
  if (viewIndex < 0) return null;

  return {
    ...ctx,
    data: view.data,
    indicatorCache: view.indicatorCache,
    patternCache: view.patternCache,
    currentIndex: viewIndex,
    // ビュー内での再 override は許可しない (条件は leaf 単位の 1 段のみ)
    timeframeViews: undefined,
  };
}

async function evaluateBaseNode(ctx: EvaluationContext, item: ConditionChildItem): Promise<boolean> {
  if ('indicatorId' in item) {
    return evaluateCondition(ctx, item);
  }
  const type = (item as { type?: string }).type;
  if (type === 'pattern') {
    return evaluatePatternCondition(ctx, item as PatternCondition);
  }
  if (type === 'lens') {
    // レンズ条件 (#3): per-bar 数値エンコード済み系列をキャッシュから引いて判定
    return evaluateLensCondition(ctx, item as LensCondition);
  }
  if (type === 'time') {
    // 時間条件: 当該バーの timestamp を JST 換算して判定（指標キャッシュ不要）
    const bar = ctx.data[ctx.currentIndex];
    return bar ? evaluateTimeConditionAt(item as TimeCondition, bar.timestamp.getTime()) : false;
  }
  return evaluateConditionGroup(ctx, item as ConditionGroup);
}

/**
 * item を評価する。indicator / pattern 条件に lookbackBars>1 があれば
 * 「直近 N 本以内（現在足含む）のどこかで成立」で true を返す。
 */
async function evaluateChildNode(ctx: EvaluationContext, item: ConditionChildItem): Promise<boolean> {
  const childType = (item as { type?: string }).type;
  const isLeaf = 'indicatorId' in item || childType === 'pattern' || childType === 'lens';

  // MTF: leaf の timeframeOverride を先に解決する (Phase γ)。
  // 解決後のコンテキストで lookback を回すため、「直近 N 本」は override した
  // 時間足の本数として数えられる (例: 1h override + 直近3本 = 1h 足 3 本以内)
  let evalCtx = ctx;
  if (isLeaf) {
    const resolved = resolveViewContext(ctx, item);
    if (resolved === null) return false;
    evalCtx = resolved;
  }

  const lookbackBars = isLeaf ? (item as { lookbackBars?: number }).lookbackBars : undefined;

  if (lookbackBars && lookbackBars > 1) {
    const start = Math.max(0, evalCtx.currentIndex - (lookbackBars - 1));
    for (let j = evalCtx.currentIndex; j >= start; j--) {
      if (await evaluateBaseNode({ ...evalCtx, currentIndex: j }, item)) return true;
    }
    return false;
  }
  return evaluateBaseNode(evalCtx, item);
}

/**
 * 条件グループを評価
 *
 * @param ctx - 評価コンテキスト
 * @param group - 条件グループ
 * @returns 条件成立の場合 true
 */
export async function evaluateConditionGroup(
  ctx: EvaluationContext,
  group: ConditionGroup
): Promise<boolean> {
  // null/undefined チェック: グループが存在しない場合はfalseを返す
  if (!group) {
    console.warn('[ConditionEvaluator] 条件グループが存在しません');
    return false;
  }

  // 条件配列が空の場合のチェック
  if (!group.conditions || group.conditions.length === 0) {
    // IF-THENやSEQUENCEは専用フィールドを使用するため、AND/OR/NOTのみチェック
    if (group.operator !== 'IF_THEN' && group.operator !== 'SEQUENCE') {
      console.warn('[ConditionEvaluator] 条件配列が空です');
      return false;
    }
  }

  // IF-THEN演算子の処理
  if (group.operator === 'IF_THEN') {
    return evaluateIfThen(ctx, group);
  }
  
  // SEQUENCE演算子の処理
  if (group.operator === 'SEQUENCE') {
    return evaluateSequence(ctx, group);
  }
  
  // 通常の論理演算子（AND, OR, NOT）
  const results: boolean[] = [];

  for (const item of group.conditions) {
    results.push(await evaluateChildNode(ctx, item));
  }

  switch (group.operator) {
    case 'AND':
      return results.every(r => r);
    case 'OR':
      return results.some(r => r);
    case 'NOT':
      return !results[0];
    default:
      return false;
  }
}

/**
 * IF-THEN条件を評価
 * 
 * IF条件が成立したら、指定バー数内にTHEN条件が成立するかチェック
 * 
 * @param ctx - 評価コンテキスト
 * @param group - 条件グループ
 * @returns 条件成立の場合 true
 */
async function evaluateIfThen(
  ctx: EvaluationContext,
  group: ConditionGroup
): Promise<boolean> {
  const ifCondition = group.ifCondition || group.conditions[0];
  const thenCondition = group.thenCondition || group.conditions[1];
  const maxBars = group.maxBarsToWait || 5;
  
  if (!ctx.ifThenState) {
    ctx.ifThenState = {
      triggered: false,
      triggeredIndex: -1,
      maxWaitBars: maxBars,
    };
  }
  
  // IF条件をチェック（indicator/pattern/time/group + lookback を evaluateChildNode で統一処理）
  const ifResult = await evaluateChildNode(ctx, ifCondition);
  
  if (ifResult && !ctx.ifThenState.triggered) {
    ctx.ifThenState.triggered = true;
    ctx.ifThenState.triggeredIndex = ctx.currentIndex;
  }
  
  // IF条件が成立済みで、待機時間内の場合はTHEN条件をチェック
  if (ctx.ifThenState.triggered) {
    const barsSinceTriggered = ctx.currentIndex - ctx.ifThenState.triggeredIndex;
    
    if (barsSinceTriggered > maxBars) {
      // タイムアウト - リセット
      ctx.ifThenState.triggered = false;
      return false;
    }
    
    const thenResult = await evaluateChildNode(ctx, thenCondition);
    
    if (thenResult) {
      // THEN条件成立 - リセット
      ctx.ifThenState.triggered = false;
      return true;
    }
  }
  
  return false;
}

/**
 * SEQUENCE条件を評価
 * 
 * 順序条件が指定バー数内に順番に成立するかチェック
 * 
 * @param ctx - 評価コンテキスト
 * @param group - 条件グループ
 * @returns 条件成立の場合 true
 */
async function evaluateSequence(
  ctx: EvaluationContext,
  group: ConditionGroup
): Promise<boolean> {
  const sequence = group.sequence || group.conditions;
  const maxBarsBetween = group.maxBarsBetweenSteps || 10;
  
  if (!ctx.sequenceState) {
    ctx.sequenceState = {
      currentStep: 0,
      lastStepIndex: -1,
      maxBarsBetween,
    };
  }
  
  const currentStep = ctx.sequenceState.currentStep;
  
  // 最後のステップから時間が経ちすぎている場合はリセット
  if (
    ctx.sequenceState.lastStepIndex >= 0 &&
    ctx.currentIndex - ctx.sequenceState.lastStepIndex > maxBarsBetween
  ) {
    ctx.sequenceState.currentStep = 0;
    ctx.sequenceState.lastStepIndex = -1;
  }
  
  // すべてのステップが完了済みの場合は何もしない（次回の評価でリセットされる）
  if (currentStep >= sequence.length) {
    return false;
  }
  
  // 現在のステップを評価（indicator/pattern/time/group + lookback を evaluateChildNode で統一処理）
  const currentCondition = sequence[currentStep];
  const stepResult = await evaluateChildNode(ctx, currentCondition);
  
  if (stepResult) {
    ctx.sequenceState.currentStep++;
    ctx.sequenceState.lastStepIndex = ctx.currentIndex;
    
    // 最終ステップが成立した場合
    if (ctx.sequenceState.currentStep >= sequence.length) {
      // 次回の評価用にリセット
      ctx.sequenceState.currentStep = 0;
      ctx.sequenceState.lastStepIndex = -1;
      // シーケンス完了を示すため true を返す
      return true;
    }
  }
  
  return false;
}
