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
}

/** ローソク足パターン条件 */
export interface PatternCondition {
  conditionId: string;
  type: 'pattern';
  patternId: CandlePatternId;
  operator: PatternOperator;
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
  conditions: (IndicatorCondition | PatternCondition | TimeCondition | ConditionGroup)[];
  // IF-THEN専用
  ifCondition?: ConditionGroup | IndicatorCondition | PatternCondition;
  thenCondition?: ConditionGroup | IndicatorCondition | PatternCondition;
  maxBarsToWait?: number;
  // SEQUENCE専用
  sequence?: (ConditionGroup | IndicatorCondition | PatternCondition)[];
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

/** 条件評価コンテキスト */
export interface EvaluationContext {
  data: OHLCV[];
  currentIndex: number;
  indicatorCache: Map<string, number[]>;
  patternCache?: Map<CandlePatternId, boolean[]>;
  strategy: StrategyDetail;
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
  // Side-A の op は shared op の subset なので as キャスト相当で渡せる
  return sharedCompareValues(left, right, operator, prevLeft, prevRight);
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
    let result: boolean;
    if ('indicatorId' in item) {
      result = await evaluateCondition(ctx, item);
    } else if ((item as { type?: string }).type === 'pattern') {
      result = await evaluatePatternCondition(ctx, item as PatternCondition);
    } else if ((item as { type?: string }).type === 'time') {
      // 時間条件: 当該バーの timestamp を JST 換算して判定（指標キャッシュ不要）
      const bar = ctx.data[ctx.currentIndex];
      result = bar ? evaluateTimeConditionAt(item as TimeCondition, bar.timestamp.getTime()) : false;
    } else {
      result = await evaluateConditionGroup(ctx, item as ConditionGroup);
    }
    results.push(result);
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
  
  // IF条件をチェック
  let ifResult: boolean;
  if ('indicatorId' in ifCondition) {
    ifResult = await evaluateCondition(ctx, ifCondition);
  } else {
    ifResult = await evaluateConditionGroup(ctx, ifCondition as ConditionGroup);
  }
  
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
    
    let thenResult: boolean;
    if ('indicatorId' in thenCondition) {
      thenResult = await evaluateCondition(ctx, thenCondition);
    } else {
      thenResult = await evaluateConditionGroup(ctx, thenCondition as ConditionGroup);
    }
    
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
  
  // 現在のステップを評価
  const currentCondition = sequence[currentStep];
  let stepResult: boolean;
  
  if ('indicatorId' in currentCondition) {
    stepResult = await evaluateCondition(ctx, currentCondition);
  } else {
    stepResult = await evaluateConditionGroup(ctx, currentCondition as ConditionGroup);
  }
  
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
