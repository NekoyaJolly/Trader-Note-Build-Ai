/**
 * ストラテジーバックテストサービス
 * 
 * 目的:
 * - ストラテジー条件をヒストリカルデータに適用してバックテスト実行
 * - 2段階バックテスト: Stage1（高速スキャン）、Stage2（精密検証）
 * - 損益計算、パフォーマンス指標の算出
 */

import { PrismaClient, BacktestOutcome } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { rsi, sma, ema, macd, bb } from 'indicatorts';
import { getStrategy, StrategyDetail } from './strategyService';
import {
  calculatePnl,
  calculateSummary,
  createEmptySummary,
  BacktestTradeEvent as BaseBacktestTradeEvent,
  BacktestResultSummary,
  TradeSide,
} from './backtestCalculations';

// 計算関数を再エクスポート（後方互換性のため）
export { calculatePnl, calculateSummary, createEmptySummary };
export type { BacktestResultSummary, TradeSide };

const prisma = new PrismaClient();

// ============================================
// 型定義
// ============================================

/** バックテストの時間足 */
export type BacktestTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

/** バックテストステージ */
export type BacktestStage = 'stage1' | 'stage2';

// TradeSideはbacktestCalculations.tsから再エクスポート済み

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

/** イグジット設定 */
export interface ExitSettings {
  takeProfit: { value: number; unit: 'percent' | 'pips' };
  stopLoss: { value: number; unit: 'percent' | 'pips' };
  maxHoldingMinutes?: number;
}

/** バックテスト実行リクエスト */
export interface BacktestRequest {
  strategyId: string;
  startDate: string;
  endDate: string;
  stage1Timeframe: BacktestTimeframe;
  runStage2: boolean;
  initialCapital: number;
  lotSize: number; // 固定ロット数（通貨量、例: 10000 = 1万通貨）
  leverage: number; // レバレッジ（1〜1000倍）
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

// BacktestTradeEventはbacktestCalculations.tsから再エクスポート
export type BacktestTradeEvent = BaseBacktestTradeEvent;

// BacktestResultSummaryはbacktestCalculations.tsから再エクスポート済み

/** バックテスト実行結果 */
export interface BacktestResult {
  id: string;
  strategyId: string;
  versionNumber: number;
  executedAt: string;
  startDate: string;
  endDate: string;
  timeframe: BacktestTimeframe;
  stage: BacktestStage;
  summary: BacktestResultSummary;
  trades: BacktestTradeEvent[];
  status: 'running' | 'completed' | 'failed';
  errorMessage?: string;
}

// ============================================
// ヒストリカルデータ取得（DBキャッシュ優先）
// ============================================

/**
 * ヒストリカルOHLCVデータを取得
 *
 * 優先順位:
 * 1. DB (OHLCVCandle テーブル) からキャッシュ済みデータを取得
 * 2. 不足期間があれば Twelve Data API から取得（将来実装）
 * 3. DBにもAPIにもデータがない場合はモックデータを生成
 *
 * @param symbol - シンボル
 * @param timeframe - 時間足
 * @param startDate - 開始日
 * @param endDate - 終了日
 * @returns OHLCV データ配列
 */
export async function fetchHistoricalData(
  symbol: string,
  timeframe: BacktestTimeframe,
  startDate: Date,
  endDate: Date
): Promise<OHLCV[]> {
  // 1. DBからキャッシュ済みデータを取得
  const cachedData = await prisma.oHLCVCandle.findMany({
    where: {
      symbol,
      timeframe,
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { timestamp: 'asc' },
  });

  // キャッシュが十分にある場合はそのまま返す
  // （期間の80%以上のデータがあれば十分とみなす）
  const expectedCandles = calculateExpectedCandles(timeframe, startDate, endDate);
  const cacheRatio = cachedData.length / expectedCandles;

  if (cacheRatio >= 0.8 && cachedData.length > 0) {
    console.log(
      `[fetchHistoricalData] DBキャッシュを使用: ${symbol}/${timeframe}, ` +
        `${cachedData.length}/${expectedCandles}件 (${(cacheRatio * 100).toFixed(1)}%)`
    );
    return cachedData.map((c) => ({
      timestamp: c.timestamp,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume),
    }));
  }

  // 2. キャッシュが不十分な場合
  // TODO: Twelve Data API から不足分を取得する実装を追加
  // 現時点ではモックデータにフォールバック

  if (cachedData.length > 0) {
    console.log(
      `[fetchHistoricalData] 部分キャッシュ + モック: ${symbol}/${timeframe}, ` +
        `キャッシュ=${cachedData.length}件, 期待=${expectedCandles}件`
    );
  } else {
    console.log(`[fetchHistoricalData] モックデータを生成: ${symbol}/${timeframe}`);
  }

  // 3. モックデータを生成（キャッシュがない期間用）
  return generateMockData(symbol, timeframe, startDate, endDate);
}

/**
 * 期待されるキャンドル数を計算
 */
function calculateExpectedCandles(
  timeframe: BacktestTimeframe,
  startDate: Date,
  endDate: Date
): number {
  const intervalMinutes = getIntervalMinutes(timeframe);
  const diffMs = endDate.getTime() - startDate.getTime();
  return Math.ceil(diffMs / (intervalMinutes * 60 * 1000));
}

/**
 * モックOHLCVデータを生成（テスト・開発用）
 * シード値を使用して再現性のあるデータを生成
 */
function generateMockData(
  symbol: string,
  timeframe: BacktestTimeframe,
  startDate: Date,
  endDate: Date
): OHLCV[] {
  const data: OHLCV[] = [];
  const intervalMinutes = getIntervalMinutes(timeframe);
  let current = new Date(startDate);

  // ベース価格（シンボルに応じて変更）
  let price = symbol.includes('JPY') ? 150.0 : 1.1;
  const volatility = symbol.includes('JPY') ? 0.5 : 0.005;
  
  // シード値：開始日とシンボルから決定的なシードを生成
  let seed = startDate.getTime() + symbol.charCodeAt(0);
  const seededRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  while (current <= endDate) {
    // シード付きランダムウォークでOHLCV生成（再現性あり）
    const change = (seededRandom() - 0.5) * volatility;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + seededRandom() * volatility * 0.5;
    const low = Math.min(open, close) - seededRandom() * volatility * 0.5;

    data.push({
      timestamp: new Date(current),
      open,
      high,
      low,
      close,
      volume: Math.floor(seededRandom() * 10000) + 1000,
    });

    price = close;
    current = new Date(current.getTime() + intervalMinutes * 60 * 1000);
  }

  return data;
}

/**
 * 時間足を分に変換
 */
function getIntervalMinutes(timeframe: BacktestTimeframe): number {
  const map: Record<BacktestTimeframe, number> = {
    '1m': 1,
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '1h': 60,
    '4h': 240,
    '1d': 1440,
  };
  return map[timeframe];
}

// ============================================
// 条件評価エンジン
// ============================================

/** 条件評価コンテキスト */
interface EvaluationContext {
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

/**
 * インジケーター値を計算してキャッシュに格納
 */
async function getIndicatorValue(
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
          // ライブラリはhistogramを提供しないため、手動計算
          if (field === 'signal' && result.signalLine) {
            values = result.signalLine;
          } else if (field === 'histogram') {
            // histogram = macdLine - signalLine
            values = result.macdLine.map((m, i) => m - (result.signalLine[i] || 0));
          } else if (result.macdLine) {
            values = result.macdLine;
          }
          break;
        }
        case 'bb':
        case 'bollinger': {
          // indicatorsライブラリのBBはstdDevパラメータをサポートしていない
          // periodのみ設定可能
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
          console.warn(`未対応のインジケーター: ${indicatorId}`);
          return undefined;
      }
      
      ctx.indicatorCache.set(cacheKey, values);
    } catch (error) {
      console.error(`インジケーター計算エラー: ${indicatorId}`, error);
      return undefined;
    }
  }
  
  const cached = ctx.indicatorCache.get(cacheKey);
  return cached ? cached[ctx.currentIndex] : undefined;
}

/**
 * 価格値を取得
 */
function getPriceValue(ctx: EvaluationContext, priceType: string): number {
  const bar = ctx.data[ctx.currentIndex];
  switch (priceType) {
    case 'open': return bar.open;
    case 'high': return bar.high;
    case 'low': return bar.low;
    case 'close':
    default: return bar.close;
  }
}

/**
 * 比較演算を実行
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
 * テスト用にエクスポート
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
 * テスト用にエクスポート
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
 */
async function evaluateSequence(
  ctx: EvaluationContext,
  group: ConditionGroup
): Promise<boolean> {
  const sequence = group.sequence || group.conditions;
  const maxBars = group.maxBarsBetweenSteps || 10;
  
  if (!ctx.sequenceState) {
    ctx.sequenceState = {
      currentStep: 0,
      lastStepIndex: -1,
      maxBarsBetween: maxBars,
    };
  }
  
  // 現在のステップの条件をチェック
  const currentCondition = sequence[ctx.sequenceState.currentStep];
  if (!currentCondition) return false;
  
  // ステップ間の時間制限をチェック
  if (ctx.sequenceState.currentStep > 0 && ctx.sequenceState.lastStepIndex >= 0) {
    const barsSinceLastStep = ctx.currentIndex - ctx.sequenceState.lastStepIndex;
    if (barsSinceLastStep > maxBars) {
      // タイムアウト - リセット
      ctx.sequenceState.currentStep = 0;
      ctx.sequenceState.lastStepIndex = -1;
    }
  }
  
  let stepResult: boolean;
  if ('indicatorId' in currentCondition) {
    stepResult = await evaluateCondition(ctx, currentCondition as IndicatorCondition);
  } else {
    stepResult = await evaluateConditionGroup(ctx, currentCondition as ConditionGroup);
  }
  
  if (stepResult) {
    ctx.sequenceState.lastStepIndex = ctx.currentIndex;
    ctx.sequenceState.currentStep++;
    
    // すべてのステップが完了
    if (ctx.sequenceState.currentStep >= sequence.length) {
      ctx.sequenceState.currentStep = 0;
      ctx.sequenceState.lastStepIndex = -1;
      return true;
    }
  }
  
  return false;
}

// ============================================
// バックテスト実行エンジン
// ============================================

/**
 * バックテストを実行
 */
export async function runBacktest(request: BacktestRequest): Promise<BacktestResult> {
  const resultId = uuidv4();
  const executedAt = new Date().toISOString();
  
  try {
    // ストラテジーを取得
    const strategy = await getStrategy(request.strategyId);
    if (!strategy || !strategy.currentVersion) {
      throw new Error('ストラテジーが見つかりません');
    }
    
    // Stage1: 高速スキャン（15m以上の時間足）
    const stage1Result = await executeBacktestStage(
      strategy,
      request,
      'stage1',
      request.stage1Timeframe
    );
    
    // Stage2が必要な場合は1m足で精密検証
    let finalResult = stage1Result;
    if (request.runStage2 && stage1Result.trades.length > 0) {
      const stage2Result = await executeBacktestStage(
        strategy,
        request,
        'stage2',
        '1m'
      );
      finalResult = stage2Result;
    }
    
    // 最終結果オブジェクトを構築
    const backtestResult: BacktestResult = {
      ...finalResult,
      id: resultId,
      strategyId: request.strategyId,
      versionNumber: strategy.currentVersion.versionNumber,
      executedAt,
      startDate: request.startDate,
      endDate: request.endDate,
      status: 'completed',
    };
    
    // 結果をDBに保存
    await saveBacktestResult(
      backtestResult,
      strategy.currentVersion.id,
      strategy.symbol
    );
    
    return backtestResult;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'バックテスト実行エラー';
    
    return {
      id: resultId,
      strategyId: request.strategyId,
      versionNumber: 0,
      executedAt,
      startDate: request.startDate,
      endDate: request.endDate,
      timeframe: request.stage1Timeframe,
      stage: 'stage1',
      summary: createEmptySummary(),
      trades: [],
      status: 'failed',
      errorMessage,
    };
  }
}

/**
 * バックテストステージを実行
 */
async function executeBacktestStage(
  strategy: StrategyDetail,
  request: BacktestRequest,
  stage: BacktestStage,
  timeframe: BacktestTimeframe
): Promise<Omit<BacktestResult, 'id' | 'strategyId' | 'versionNumber' | 'executedAt' | 'startDate' | 'endDate' | 'status'>> {
  // ヒストリカルデータを取得
  const data = await fetchHistoricalData(
    strategy.symbol,
    timeframe,
    new Date(request.startDate),
    new Date(request.endDate)
  );
  
  if (data.length === 0) {
    throw new Error('ヒストリカルデータが取得できませんでした');
  }
  
  // 評価コンテキストを初期化
  const ctx: EvaluationContext = {
    data,
    currentIndex: 0,
    indicatorCache: new Map(),
    strategy,
  };
  
  const entryConditions = strategy.currentVersion!.entryConditions as ConditionGroup;
  const exitSettings = strategy.currentVersion!.exitSettings as ExitSettings;
  const trades: BacktestTradeEvent[] = [];
  
  // ポジション状態
  let inPosition = false;
  let entryPrice = 0;
  let entryTime = '';
  let entryIndex = 0;
  
  // 資金残高追跡（破産判定用）
  let currentCapital = request.initialCapital;
  const bankruptcyThreshold = request.initialCapital * 0.5; // 50%を下回ったら破産
  let isBankrupt = false;
  
  // データをスキャン
  for (let i = 50; i < data.length; i++) { // 最初の50バーはインジケーター計算用にスキップ
    // 破産判定: 資金が50%を切ったら停止
    if (currentCapital <= bankruptcyThreshold) {
      isBankrupt = true;
      console.log(`[Backtest] 破産判定: 資金が${Math.round(currentCapital).toLocaleString()}円（初期資金の${Math.round(currentCapital / request.initialCapital * 100)}%）に減少。テスト終了。`);
      break;
    }
    
    ctx.currentIndex = i;
    const bar = data[i];
    
    if (!inPosition) {
      // エントリー条件をチェック
      const shouldEnter = await evaluateConditionGroup(ctx, entryConditions);
      
      if (shouldEnter) {
        // 次足始値でエントリー
        if (i + 1 < data.length) {
          inPosition = true;
          entryPrice = data[i + 1].open;
          entryTime = data[i + 1].timestamp.toISOString();
          entryIndex = i + 1;
        }
      }
    } else {
      // イグジット判定
      const exitResult = checkExit(
        bar,
        entryPrice,
        strategy.side as TradeSide,
        exitSettings,
        i - entryIndex,
        timeframe
      );
      
      if (exitResult.shouldExit) {
        // 固定ロット数で損益計算（シンプル）
        // lotSize = 通貨量（例: 10000 = 1万通貨）
        // pnl = 価格差 × ロット数
        const pnl = calculatePnl(
          strategy.side as TradeSide,
          entryPrice,
          exitResult.exitPrice,
          request.lotSize
        );
        
        // 必要証拠金 = ロット数 × エントリー価格 / レバレッジ
        const requiredMargin = (request.lotSize * entryPrice) / request.leverage;
        
        trades.push({
          eventId: uuidv4(),
          entryTime,
          entryPrice,
          exitTime: bar.timestamp.toISOString(),
          exitPrice: exitResult.exitPrice,
          side: strategy.side as TradeSide,
          lotSize: request.lotSize,
          pnl,
          // pnlPercentは必要証拠金に対する利益率
          pnlPercent: (pnl / requiredMargin) * 100,
          exitReason: exitResult.reason,
        });
        
        // 資金残高を更新（破産判定用）
        currentCapital += pnl;
        
        inPosition = false;
      }
    }
  }
  
  // サマリーを計算（破産フラグも含める）
  const summary = calculateSummary(trades, request.initialCapital);
  
  // 破産した場合はサマリーに情報を追加
  if (isBankrupt) {
    summary.stoppedReason = 'bankruptcy';
    summary.finalCapital = currentCapital;
  }
  
  return {
    timeframe,
    stage,
    summary,
    trades,
  };
}

/**
 * イグジット判定
 */
function checkExit(
  bar: OHLCV,
  entryPrice: number,
  side: TradeSide,
  exitSettings: ExitSettings,
  barsHeld: number,
  timeframe: BacktestTimeframe
): { shouldExit: boolean; exitPrice: number; reason: 'take_profit' | 'stop_loss' | 'timeout' | 'signal' } {
  const intervalMinutes = getIntervalMinutes(timeframe);
  const minutesHeld = barsHeld * intervalMinutes;
  
  // 利確・損切のしきい値を計算
  let tpPrice: number;
  let slPrice: number;
  
  if (exitSettings.takeProfit.unit === 'percent') {
    const tpDiff = entryPrice * (exitSettings.takeProfit.value / 100);
    tpPrice = side === 'buy' ? entryPrice + tpDiff : entryPrice - tpDiff;
  } else {
    // Pips（0.01円または0.0001ドルとして計算）
    const pipValue = entryPrice > 50 ? 0.01 : 0.0001;
    const tpDiff = exitSettings.takeProfit.value * pipValue;
    tpPrice = side === 'buy' ? entryPrice + tpDiff : entryPrice - tpDiff;
  }
  
  if (exitSettings.stopLoss.unit === 'percent') {
    const slDiff = entryPrice * (exitSettings.stopLoss.value / 100);
    slPrice = side === 'buy' ? entryPrice - slDiff : entryPrice + slDiff;
  } else {
    const pipValue = entryPrice > 50 ? 0.01 : 0.0001;
    const slDiff = exitSettings.stopLoss.value * pipValue;
    slPrice = side === 'buy' ? entryPrice - slDiff : entryPrice + slDiff;
  }
  
  // 利確チェック
  if (side === 'buy') {
    if (bar.high >= tpPrice) {
      return { shouldExit: true, exitPrice: tpPrice, reason: 'take_profit' };
    }
    if (bar.low <= slPrice) {
      return { shouldExit: true, exitPrice: slPrice, reason: 'stop_loss' };
    }
  } else {
    if (bar.low <= tpPrice) {
      return { shouldExit: true, exitPrice: tpPrice, reason: 'take_profit' };
    }
    if (bar.high >= slPrice) {
      return { shouldExit: true, exitPrice: slPrice, reason: 'stop_loss' };
    }
  }
  
  // タイムアウトチェック
  if (exitSettings.maxHoldingMinutes && minutesHeld >= exitSettings.maxHoldingMinutes) {
    return { shouldExit: true, exitPrice: bar.close, reason: 'timeout' };
  }
  
  return { shouldExit: false, exitPrice: 0, reason: 'signal' };
}

// calculatePnl, calculateSummary, createEmptySummaryは
// backtestCalculations.tsからインポート済み

/**
 * exitReasonをBacktestOutcomeに変換
 */
function toBacktestOutcome(exitReason: 'take_profit' | 'stop_loss' | 'timeout' | 'signal'): BacktestOutcome {
  switch (exitReason) {
    case 'take_profit':
      return 'win';
    case 'stop_loss':
      return 'loss';
    case 'timeout':
      return 'timeout';
    case 'signal':
      return 'win'; // シグナル決済は利確扱い
  }
}

/**
 * バックテスト結果をDBに保存
 * 注意: 現在のPrismaスキーマはStrategyBacktestResultを別テーブルで保持
 */
async function saveBacktestResult(result: BacktestResult, versionId: string, symbol: string): Promise<void> {
  // バックテスト実行レコードを作成
  await prisma.strategyBacktestRun.create({
    data: {
      id: result.id,
      strategyId: result.strategyId,
      versionId: versionId,
      symbol: symbol,
      timeframe: result.timeframe,
      startDate: new Date(result.startDate),
      endDate: new Date(result.endDate),
      stage: result.stage,
      status: result.status === 'completed' ? 'completed' : result.status === 'failed' ? 'failed' : 'running',
    },
  });
  
  // 集計結果を保存（StrategyBacktestResult テーブル）
  if (result.status === 'completed') {
    await prisma.strategyBacktestResult.create({
      data: {
        runId: result.id,
        setupCount: result.summary.totalTrades,
        winCount: result.summary.winningTrades,
        lossCount: result.summary.losingTrades,
        timeoutCount: result.trades.filter(t => t.exitReason === 'timeout').length,
        winRate: result.summary.winRate,
        profitFactor: result.summary.profitFactor || null,
        totalProfit: result.summary.netProfit > 0 ? result.summary.netProfit : 0,
        totalLoss: result.summary.netProfit < 0 ? Math.abs(result.summary.netProfit) : 0,
        averagePnL: result.summary.totalTrades > 0 ? result.summary.netProfit / result.summary.totalTrades : 0,
        expectancy: result.summary.totalTrades > 0 ? result.summary.netProfit / result.summary.totalTrades : 0,
        maxDrawdown: result.summary.maxDrawdown || null,
      },
    });
  }
  
  // トレードイベントを保存
  if (result.trades.length > 0) {
    await prisma.strategyBacktestEvent.createMany({
      data: result.trades.map(trade => ({
        id: trade.eventId,
        runId: result.id,
        entryTime: new Date(trade.entryTime),
        entryPrice: trade.entryPrice,
        exitTime: new Date(trade.exitTime),
        exitPrice: trade.exitPrice,
        outcome: toBacktestOutcome(trade.exitReason),
        pnl: trade.pnl,
        indicatorValues: trade.indicatorValues || {},
      })),
    });
  }
}

/**
 * バックテスト結果を取得
 */
export async function getBacktestResult(runId: string): Promise<BacktestResult | null> {
  const run = await prisma.strategyBacktestRun.findUnique({
    where: { id: runId },
    include: {
      events: true,
      result: true,
      strategy: {
        include: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
          },
        },
      },
    },
  });
  
  if (!run) return null;
  
  // サマリーの取得（resultテーブルから、またはeventsから計算）
  const summary: BacktestResultSummary = run.result ? {
    totalTrades: run.result.setupCount,
    winningTrades: run.result.winCount,
    losingTrades: run.result.lossCount,
    winRate: run.result.winRate,
    netProfit: run.result.totalProfit.toNumber() - run.result.totalLoss.toNumber(),
    netProfitRate: 0, // 計算には初期資金が必要
    maxDrawdown: run.result.maxDrawdown?.toNumber() || 0,
    maxDrawdownRate: 0,
    profitFactor: run.result.profitFactor || 0,
    averageWin: 0,
    averageLoss: 0,
    riskRewardRatio: 0,
    maxConsecutiveWins: 0,
    maxConsecutiveLosses: 0,
  } : createEmptySummary();
  
  return {
    id: run.id,
    strategyId: run.strategyId,
    versionNumber: run.strategy.versions[0]?.versionNumber || 1,
    executedAt: run.createdAt.toISOString(),
    startDate: run.startDate.toISOString(),
    endDate: run.endDate.toISOString(),
    timeframe: run.timeframe as BacktestTimeframe,
    stage: run.stage as BacktestStage,
    summary,
    trades: run.events.map(e => ({
      eventId: e.id,
      entryTime: e.entryTime.toISOString(),
      entryPrice: e.entryPrice.toNumber(),
      exitTime: e.exitTime?.toISOString() || '',
      exitPrice: e.exitPrice?.toNumber() || 0,
      side: run.strategy.side as TradeSide,
      lotSize: 10000, // デフォルト値（1万通貨）
      pnl: e.pnl?.toNumber() || 0,
      pnlPercent: 0,
      exitReason: e.outcome === 'win' ? 'take_profit' : e.outcome === 'loss' ? 'stop_loss' : 'timeout' as const,
      indicatorValues: e.indicatorValues as Record<string, number>,
    })),
    status: run.status as 'running' | 'completed' | 'failed',
  };
}

/**
 * ストラテジーのバックテスト履歴を取得
 */
export async function getBacktestHistory(strategyId: string, limit: number = 20): Promise<BacktestResult[]> {
  const runs = await prisma.strategyBacktestRun.findMany({
    where: { strategyId },
    orderBy: { createdAt: 'desc' },
    include: {
      events: true,
      result: true,
      strategy: {
        include: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
          },
        },
      },
    },
    take: limit,
  });
  
  return runs.map(run => {
    const summary: BacktestResultSummary = run.result ? {
      totalTrades: run.result.setupCount,
      winningTrades: run.result.winCount,
      losingTrades: run.result.lossCount,
      winRate: run.result.winRate,
      netProfit: run.result.totalProfit.toNumber() - run.result.totalLoss.toNumber(),
      netProfitRate: 0,
      maxDrawdown: run.result.maxDrawdown?.toNumber() || 0,
      maxDrawdownRate: 0,
      profitFactor: run.result.profitFactor || 0,
      averageWin: 0,
      averageLoss: 0,
      riskRewardRatio: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
    } : createEmptySummary();
    
    return {
      id: run.id,
      strategyId: run.strategyId,
      versionNumber: run.strategy.versions[0]?.versionNumber || 1,
      executedAt: run.createdAt.toISOString(),
      startDate: run.startDate.toISOString(),
      endDate: run.endDate.toISOString(),
      timeframe: run.timeframe as BacktestTimeframe,
      stage: run.stage as BacktestStage,
      summary,
      trades: run.events.map(e => ({
        eventId: e.id,
        entryTime: e.entryTime.toISOString(),
        entryPrice: e.entryPrice.toNumber(),
        exitTime: e.exitTime?.toISOString() || '',
        exitPrice: e.exitPrice?.toNumber() || 0,
        side: run.strategy.side as TradeSide,
        lotSize: 10000,
        pnl: e.pnl?.toNumber() || 0,
        pnlPercent: 0,
        exitReason: e.outcome === 'win' ? 'take_profit' : e.outcome === 'loss' ? 'stop_loss' : 'timeout' as const,
        indicatorValues: e.indicatorValues as Record<string, number>,
      })),
      status: run.status as 'running' | 'completed' | 'failed',
    };
  });
}
