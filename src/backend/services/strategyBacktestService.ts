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
import { getStrategy, StrategyDetail } from './strategyService';
import {
  calculatePnl,
  calculateSummary,
  createEmptySummary,
  BacktestTradeEvent as BaseBacktestTradeEvent,
  BacktestResultSummary,
  TradeSide,
} from './backtestCalculations';
import {
  evaluateCondition,
  evaluateConditionGroup,
  EvaluationContext,
  ConditionGroup,
  IndicatorCondition,
  OHLCV,
  LogicalOperator,
  ComparisonOperator,
} from './strategyConditionEvaluator';
import { MarketDataService } from '../../services/marketDataService';

// 計算関数を再エクスポート（後方互換性のため）
export { calculatePnl, calculateSummary, createEmptySummary };
export type { BacktestResultSummary, TradeSide };

// 条件評価関数を再エクスポート（後方互換性とテスト用）
export { evaluateCondition, evaluateConditionGroup };
export type { EvaluationContext, ConditionGroup, IndicatorCondition, OHLCV };

const prisma = new PrismaClient();
// 市場データサービスのインスタンス（Twelve Data API 連携用）
const marketDataService = new MarketDataService();

// ============================================
// 型定義
// ============================================

/** バックテストの時間足 */
export type BacktestTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

/** バックテストステージ */
export type BacktestStage = 'stage1' | 'stage2';

// 以下の型は strategyConditionEvaluator.ts から再エクスポート
export type { LogicalOperator, ComparisonOperator };

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

/** データカバレッジチェック結果 */
export interface CoverageCheckResult {
  /** カバレッジが十分か */
  hasCoverage: boolean;
  /** プリセットが存在するか */
  presetExists: boolean;
  /** DB に存在するデータ件数 */
  dataCount: number;
  /** 期待されるデータ件数 */
  expectedCount: number;
  /** 不足開始日時 */
  missingStart?: Date;
  /** 不足終了日時 */
  missingEnd?: Date;
  /** カバレッジ率（0.0 〜 1.0） */
  coverageRatio: number;
}

// ============================================
// ヒストリカルデータ取得（プリセット優先）
// ============================================

/**
 * 指定期間のデータカバレッジをチェック
 * 
 * @param symbol - シンボル
 * @param timeframe - 時間足
 * @param startDate - 開始日
 * @param endDate - 終了日
 * @returns カバレッジ情報
 */
export async function checkDataCoverage(
  symbol: string,
  timeframe: BacktestTimeframe,
  startDate: Date,
  endDate: Date
): Promise<CoverageCheckResult> {
  // プリセットの存在確認
  const preset = await prisma.dataPreset.findUnique({
    where: {
      symbol_timeframe: {
        symbol,
        timeframe,
      },
    },
  });

  // DB 内のデータ件数をカウント（要求期間内）
  const dataCount = await prisma.oHLCVCandle.count({
    where: {
      symbol,
      timeframe,
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  // プリセットがない場合
  if (!preset) {
    // プリセットがない場合は旧ロジック（24時間連続の期待値）
    const intervalMinutes = getIntervalMinutes(timeframe);
    const diffMs = endDate.getTime() - startDate.getTime();
    const expectedCount = Math.ceil(diffMs / (intervalMinutes * 60 * 1000));
    const coverageRatio = expectedCount > 0 ? dataCount / expectedCount : 0;

    return {
      hasCoverage: false,
      presetExists: false,
      dataCount,
      expectedCount,
      missingStart: startDate,
      missingEnd: endDate,
      coverageRatio,
    };
  }

  // プリセットの期間と要求期間を比較
  const presetStart = preset.startDate.getTime();
  const presetEnd = preset.endDate.getTime();
  const reqStart = startDate.getTime();
  const reqEnd = endDate.getTime();

  // 期待バー数の計算:
  // プリセットの実データ密度（recordCount / プリセット期間）を使用して
  // 要求期間の期待値を算出する
  const presetDurationMs = presetEnd - presetStart;
  const requestDurationMs = Math.min(reqEnd, presetEnd) - Math.max(reqStart, presetStart);
  
  // 要求期間がプリセット期間と重なっている部分の期待値を計算
  let expectedCount: number;
  if (requestDurationMs > 0 && presetDurationMs > 0) {
    // 実データの密度から期待値を算出（休場日も自動的に考慮される）
    const dataPerMs = preset.recordCount / presetDurationMs;
    expectedCount = Math.round(dataPerMs * requestDurationMs);
  } else {
    // 重なりがない場合
    expectedCount = 0;
  }

  // カバレッジ率を計算
  const coverageRatio = expectedCount > 0 ? Math.min(dataCount / expectedCount, 1.0) : 0;

  // 不足期間の判定
  let missingStart: Date | undefined;
  let missingEnd: Date | undefined;

  if (reqStart < presetStart) {
    missingStart = startDate;
    missingEnd = new Date(Math.min(presetStart, reqEnd));
  }
  if (reqEnd > presetEnd) {
    if (!missingStart) {
      missingStart = new Date(Math.max(presetEnd, reqStart));
    }
    missingEnd = endDate;
  }

  // 95% 以上のカバレッジがあり、期間外への要求がなければ十分とみなす
  const hasCoverage = coverageRatio >= 0.95 && !missingStart;

  return {
    hasCoverage,
    presetExists: true,
    dataCount,
    expectedCount,
    missingStart,
    missingEnd,
    coverageRatio,
  };
}

/**
 * ヒストリカルOHLCVデータを取得
 *
 * 優先順位:
 * 1. DB (OHLCVCandle テーブル) からプリセットデータを取得
 * 2. 不足があり forceApiFetch=true の場合のみ Twelve Data API から取得
 * 3. それ以外は不足分をモックデータで補完
 *
 * @param symbol - シンボル
 * @param timeframe - 時間足
 * @param startDate - 開始日
 * @param endDate - 終了日
 * @param forceApiFetch - 不足時に API 取得を強制するか（デフォルト: false）
 * @returns OHLCV データ配列
 */
export async function fetchHistoricalData(
  symbol: string,
  timeframe: BacktestTimeframe,
  startDate: Date,
  endDate: Date,
  forceApiFetch: boolean = false
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
  // 期待バー数は時間差から算出（休場日を考慮せずに概算）
  const intervalMinutes = getIntervalMinutes(timeframe);
  const diffMs = endDate.getTime() - startDate.getTime();
  const expectedCandles = Math.ceil(diffMs / (intervalMinutes * 60 * 1000));
  const cacheRatio = cachedData.length / expectedCandles;

  // 50%以上のデータがあればキャッシュとして有効とみなす
  // （休場日があるため100%にはならない前提）
  if (cacheRatio >= 0.5 && cachedData.length > 0) {
    console.log(
      `[fetchHistoricalData] DBプリセットを使用: ${symbol}/${timeframe}, ` +
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

  // 2. キャッシュが不十分かつ forceApiFetch=true の場合のみ API から取得
  if (forceApiFetch && marketDataService.isApiConfigured()) {
    try {
      // 期待される本数と開始・終了時刻を計算
      const requiredCandles = expectedCandles - cachedData.length;
      console.log(
        `[fetchHistoricalData] Twelve Data API から取得: ${symbol}/${timeframe}, ` +
          `不足=${requiredCandles}件`
      );

      // API から履歴データを取得（最大5000件）
      const apiLimit = Math.min(requiredCandles + 50, 5000); // バッファを含めて取得
      const apiData = await marketDataService.getHistoricalData(symbol, timeframe, apiLimit);

      if (apiData.length > 0) {
        // API で取得したデータを OHLCV 形式に変換
        const ohlcvData: OHLCV[] = apiData
          .filter((bar) => bar.timestamp >= startDate && bar.timestamp <= endDate)
          .map((bar) => ({
            timestamp: bar.timestamp,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
          }));

        // DBにキャッシュ保存（将来の高速化のため）
        await cacheOhlcvData(symbol, timeframe, ohlcvData);

        console.log(
          `[fetchHistoricalData] API データ取得成功: ${symbol}/${timeframe}, ${ohlcvData.length}件`
        );
        return ohlcvData;
      }
    } catch (error) {
      console.warn(`[fetchHistoricalData] API 取得エラー、モックにフォールバック:`, error);
    }
  } else if (!forceApiFetch && cacheRatio < 0.8) {
    // forceApiFetch=false かつプリセットが不十分な場合、APIは呼ばずにモック補完
    console.log(
      `[fetchHistoricalData] プリセット不足 (${(cacheRatio * 100).toFixed(1)}%)、` +
        `forceApiFetch=false のため API をスキップしてモックで補完: ${symbol}/${timeframe}`
    );
  }

  // 3. API 未設定、forceApiFetch=false、または取得失敗時はモックデータにフォールバック
  if (cachedData.length > 0) {
    console.log(
      `[fetchHistoricalData] 部分プリセット + モック: ${symbol}/${timeframe}, ` +
        `プリセット=${cachedData.length}件, 期待=${expectedCandles}件`
    );
  } else {
    console.log(`[fetchHistoricalData] モックデータを生成: ${symbol}/${timeframe}`);
  }

  // 4. モックデータを生成（キャッシュがない期間用）
  return generateMockData(symbol, timeframe, startDate, endDate);
}

/**
 * OHLCV データをデータベースにキャッシュ
 * 
 * @param symbol - シンボル
 * @param timeframe - 時間足
 * @param data - OHLCV データ
 */
async function cacheOhlcvData(
  symbol: string,
  timeframe: string,
  data: OHLCV[]
): Promise<void> {
  try {
    // 重複を避けるため upsert を使用
    for (const candle of data) {
      await prisma.oHLCVCandle.upsert({
        where: {
          symbol_timeframe_timestamp: {
            symbol,
            timeframe,
            timestamp: candle.timestamp,
          },
        },
        update: {
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
        create: {
          symbol,
          timeframe,
          timestamp: candle.timestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
      });
    }
    console.log(`[cacheOhlcvData] ${data.length}件のデータをキャッシュ: ${symbol}/${timeframe}`);
  } catch (error) {
    // キャッシュ失敗はワーニングのみ（メイン処理は継続）
    console.warn(`[cacheOhlcvData] キャッシュ保存エラー:`, error);
  }
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
  
  // エントリー条件のバリデーション
  if (!entryConditions || !entryConditions.conditions || entryConditions.conditions.length === 0) {
    // IF-THENやSEQUENCEの場合は別のフィールドをチェック
    const hasIfThenConditions = entryConditions?.operator === 'IF_THEN' && 
      (entryConditions.ifCondition || entryConditions.thenCondition);
    const hasSequenceConditions = entryConditions?.operator === 'SEQUENCE' && 
      entryConditions.sequence && entryConditions.sequence.length > 0;
    
    if (!hasIfThenConditions && !hasSequenceConditions) {
      throw new Error('エントリー条件が設定されていません。ストラテジーの編集画面で条件を追加してください。');
    }
  }
  
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
