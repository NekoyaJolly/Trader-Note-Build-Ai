/**
 * ストラテジー条件評価サービス（共通ロジック）
 * 
 * 目的:
 * - バックテストとリアルタイム監視の両方で使用可能な条件評価ロジック
 * - インジケーター計算の共通化
 * - DRY 原則に従った実装
 */

import { rsi, sma, ema, macd, bb } from 'indicatorts';
import { StrategyDetail } from './strategyService';

// ============================================
// 型定義
// ============================================

/** 論理演算子 */
export type LogicalOperator = 'AND' | 'OR' | 'NOT' | 'IF_THEN' | 'SEQUENCE';

/** 比較演算子 */
export type ComparisonOperator = '<' | '<=' | '=' | '>=' | '>' | 'cross_above' | 'cross_below';

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

/** 条件グループ */
export interface ConditionGroup {
  groupId: string;
  operator: LogicalOperator;
  conditions: (IndicatorCondition | ConditionGroup)[];
  // IF-THEN専用
  ifCondition?: ConditionGroup | IndicatorCondition;
  thenCondition?: ConditionGroup | IndicatorCondition;
  maxBarsToWait?: number;
  // SEQUENCE専用
  sequence?: (ConditionGroup | IndicatorCondition)[];
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
export async function getIndicatorValue(
  ctx: EvaluationContext,
  indicatorId: string,
  params: Record<string, number>,
  field: string
): Promise<number | undefined> {
  const cacheKey = `${indicatorId}_${JSON.stringify(params)}_${field}`;
  
  if (!ctx.indicatorCache.has(cacheKey)) {
    // OHLCVデータからインジケーター計算
    const closes = ctx.data.map(d => d.close);
    
    try {
      let values: number[] = [];
      
      // インジケーターIDに応じて適切な関数を呼び出す
      switch (indicatorId.toLowerCase()) {
        case 'rsi': {
          const period = params?.period || 14;
          const result = rsi(closes, { period });
          values = Array.isArray(result) ? result : [];
          break;
        }
        case 'sma': {
          const period = params?.period || 20;
          const result = sma(closes, { period });
          values = Array.isArray(result) ? result : [];
          break;
        }
        case 'ema': {
          const period = params?.period || 20;
          const result = ema(closes, { period });
          values = Array.isArray(result) ? result : [];
          break;
        }
        case 'macd': {
          const fastPeriod = params?.fastPeriod || 12;
          const slowPeriod = params?.slowPeriod || 26;
          const signalPeriod = params?.signalPeriod || 9;
          const result = macd(closes, { fast: fastPeriod, slow: slowPeriod, signal: signalPeriod });
          // MACDの場合はfield指定に応じて適切な配列を使用
          if (field === 'signal' && result.signalLine) {
            values = result.signalLine;
          } else if (field === 'histogram') {
            // histogram = macdLine - signalLine
            // 両方の配列が同じ長さであることを確認し、undefined 値を適切に処理
            if (result.macdLine && result.signalLine) {
              values = result.macdLine.map((m, i) => {
                const signal = result.signalLine[i];
                // 両方の値が存在する場合のみ計算、そうでなければ 0
                return (m !== undefined && signal !== undefined) ? m - signal : 0;
              });
            }
          } else if (result.macdLine) {
            values = result.macdLine;
          }
          break;
        }
        case 'bb':
        case 'bollinger': {
          const period = params?.period || 20;
          const result = bb(closes, { period });
          // BBの場合はfield指定に応じて適切な配列を使用
          if (field === 'upper' && result.upper) {
            values = result.upper;
          } else if (field === 'lower' && result.lower) {
            values = result.lower;
          } else if (result.middle) {
            values = result.middle;
          }
          break;
        }
        default:
          console.warn(`[ConditionEvaluator] 未対応のインジケーター: ${indicatorId}`);
          return undefined;
      }
      
      ctx.indicatorCache.set(cacheKey, values);
    } catch (error) {
      console.error(`[ConditionEvaluator] インジケーター計算エラー: ${indicatorId}`, error);
      return undefined;
    }
  }
  
  const cached = ctx.indicatorCache.get(cacheKey);
  return cached ? cached[ctx.currentIndex] : undefined;
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
 * 比較演算を実行
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
  prevRight?: number
): boolean {
  switch (operator) {
    case '<': return left < right;
    case '<=': return left <= right;
    case '=': return Math.abs(left - right) < 0.0001;
    case '>=': return left >= right;
    case '>': return left > right;
    case 'cross_above':
      // 前回は下、今回は上
      if (prevLeft === undefined || prevRight === undefined) return false;
      return prevLeft < prevRight && left > right;
    case 'cross_below':
      // 前回は上、今回は下
      if (prevLeft === undefined || prevRight === undefined) return false;
      return prevLeft > prevRight && left < right;
    default:
      return false;
  }
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
  
  // クロス判定用の前回値を取得
  let prevLeft: number | undefined;
  let prevRight: number | undefined;
  
  if (condition.operator === 'cross_above' || condition.operator === 'cross_below') {
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
      result = await evaluateCondition(ctx, item as IndicatorCondition);
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
    ifResult = await evaluateCondition(ctx, ifCondition as IndicatorCondition);
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
      thenResult = await evaluateCondition(ctx, thenCondition as IndicatorCondition);
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
    stepResult = await evaluateCondition(ctx, currentCondition as IndicatorCondition);
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
