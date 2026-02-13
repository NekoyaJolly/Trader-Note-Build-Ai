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
import { CTraderDataService } from './ctrader/ctraderDataService';
import { CTraderAuthService } from './ctrader/ctraderAuthService';
import { OHLCVRepository } from '../repositories/ohlcvRepository';
import { calculateLotSize, slValueToPips, calculateUsedMargin } from './positionSizeCalculator';

// 計算関数を再エクスポート（後方互換性のため）
export { calculatePnl, calculateSummary, createEmptySummary };
export type { BacktestResultSummary, TradeSide };

// 条件評価関数を再エクスポート（後方互換性とテスト用）
export { evaluateCondition, evaluateConditionGroup };
export type { EvaluationContext, ConditionGroup, IndicatorCondition, OHLCV };

const prisma = new PrismaClient();
// 市場データサービスのインスタンス（Twelve Data API 連携用）
const marketDataService = new MarketDataService();
// cTrader サービスのインスタンス
const ctraderAuthService = new CTraderAuthService(prisma);
const ctraderDataService = new CTraderDataService(ctraderAuthService);

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

/** バックテスト実行ソース（どこから実行されたか） */
export type BacktestSource = 'manual' | 'walkforward' | 'montecarlo';

/** ロットモード */
export type LotMode = 'fixed' | 'variable';

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
  /** シンボル（省略時はストラテジーのシンボルを使用） */
  symbol?: string;
  /** ロットモード（デフォルト: 'fixed'） */
  lotMode?: LotMode;
  /** リスク割合 % (lotMode='variable' 時) */
  riskPercent?: number;
  /** リスク固定金額 (lotMode='variable' 時) */
  riskAmount?: number;
  /** 同時ポジション上限 (1〜15、デフォルト: 1) */
  maxPositions?: number;
  /** 実行ソース（省略時は 'manual'）*/
  source?: BacktestSource;
}

/** 保有中のポジション（チケット方式） */
interface OpenPosition {
  ticketId: string;
  entryPrice: number;
  entryTime: string;
  entryIndex: number;
  lotSize: number;
  side: TradeSide;
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
 * データ充足判定:
 * - DBキャッシュのタイムスタンプ範囲（最古〜最新）が要求期間をカバーしているかで判定
 * - 期待バー数の計算は行わない（休場日・ブローカー固有の休止時間を正確に予測できないため）
 * - APIが返すバーを「正しい全データ」として信頼する（権威あるソース）
 *
 * 優先順位:
 * 1. DB (OHLCVCandle テーブル) からキャッシュ済みデータを取得
 * 2. 不足時: cTrader API から取得（無料、自分のアカウント）
 * 3. 不足時: Twelve Data API から取得（無料枠制限あり）
 * 4. それでも不足: 既存データのみ返却（モックは使用しない）
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
  const intervalMinutes = getIntervalMinutes(timeframe);

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

  // 2. キャッシュのカバレッジをタイムスタンプ範囲で判定
  //    期待バー数ではなく、最古/最新のタイムスタンプが要求期間をカバーしているかで判断
  //    （休場日・ブローカー固有の休止はAPIが返さないバー＝存在しないデータなので無視）
  const toleranceMs = intervalMinutes * 60 * 1000 * 3; // 3バー分の許容誤差
  if (cachedData.length > 0) {
    const cacheStart = cachedData[0].timestamp.getTime();
    const cacheEnd = cachedData[cachedData.length - 1].timestamp.getTime();
    const coversStart = cacheStart <= startDate.getTime() + toleranceMs;
    const coversEnd = cacheEnd >= endDate.getTime() - toleranceMs;

    if (coversStart && coversEnd) {
      console.log(
        `[fetchHistoricalData] DBキャッシュで期間カバー済み: ${symbol}/${timeframe}, ` +
        `${cachedData.length}件 (${new Date(cacheStart).toISOString()} 〜 ${new Date(cacheEnd).toISOString()})`
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

    console.log(
      `[fetchHistoricalData] DBキャッシュが期間を未カバー: ${symbol}/${timeframe}, ` +
      `キャッシュ=${cachedData.length}件, ` +
      `開始カバー=${coversStart}, 終了カバー=${coversEnd}`
    );
  } else {
    console.log(`[fetchHistoricalData] DBキャッシュなし: ${symbol}/${timeframe}`);
  }

  // 3. API取得（forceApiFetch=true の場合のみ）
  if (forceApiFetch) {
    const apiFetched = await fetchFromApis(symbol, timeframe, startDate, endDate);

    if (apiFetched) {
      // API取得分をDBにキャッシュ（upsert で重複回避）
      await cacheOhlcvData(symbol, timeframe, apiFetched);

      // キャッシュ + API 取得分をマージして再取得（upsert 済みなのでDBから一括取得が確実）
      const mergedData = await prisma.oHLCVCandle.findMany({
        where: {
          symbol,
          timeframe,
          timestamp: { gte: startDate, lte: endDate },
        },
        orderBy: { timestamp: 'asc' },
      });

      console.log(
        `[fetchHistoricalData] API取得+キャッシュマージ完了: ${symbol}/${timeframe}, ${mergedData.length}件`
      );
      return mergedData.map((c) => ({
        timestamp: c.timestamp,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
      }));
    }
  } else {
    console.log(
      `[fetchHistoricalData] forceApiFetch=false のため API をスキップ: ${symbol}/${timeframe}`
    );
  }

  // 4. 既存データのみ返却（モックデータは使用しない）
  if (cachedData.length > 0) {
    console.log(
      `[fetchHistoricalData] 既存キャッシュのみ使用: ${symbol}/${timeframe}, ${cachedData.length}件`
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

  console.warn(
    `[fetchHistoricalData] データなし: ${symbol}/${timeframe}, ` +
    `APIデータ取得を有効にするか、「データプリセット」からインポートしてください`
  );
  return [];
}

/**
 * cTrader / Twelve Data API からデータを取得する内部ヘルパー
 *
 * @returns 取得した OHLCV データ（取得失敗時は null）
 */
async function fetchFromApis(
  symbol: string,
  timeframe: BacktestTimeframe,
  startDate: Date,
  endDate: Date,
): Promise<OHLCV[] | null> {
  // cTrader API（優先：無料、自分のアカウント）
  if (ctraderDataService.isConfigured()) {
    try {
      const ctraderToken = await prisma.cTraderToken.findFirst({
        orderBy: { lastConnectedAt: 'desc' },
      });

      if (ctraderToken) {
        // 期間から概算バー数を算出（API の count パラメータ用、多めに取る）
        const intervalMinutes = getIntervalMinutes(timeframe);
        const diffMs = endDate.getTime() - startDate.getTime();
        const estimatedBars = Math.ceil(diffMs / (intervalMinutes * 60 * 1000));

        console.log(
          `[fetchFromApis] cTrader API から取得: ${symbol}/${timeframe}, 推定=${estimatedBars}件`
        );

        const bars = await ctraderDataService.fetchTrendbars(
          ctraderToken.accountId,
          symbol,
          timeframe,
          Math.min(estimatedBars + 100, 5000)
        );

        if (bars.length > 0) {
          const ohlcvData: OHLCV[] = bars
            .filter((bar) => bar.timestamp >= startDate && bar.timestamp <= endDate)
            .map((bar) => ({
              timestamp: bar.timestamp,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume,
            }));

          console.log(
            `[fetchFromApis] cTrader 取得成功: ${symbol}/${timeframe}, ${ohlcvData.length}件`
          );
          return ohlcvData;
        }
      } else {
        console.log(`[fetchFromApis] cTrader アカウント未登録、次のソースへ`);
      }
    } catch (error) {
      console.warn(`[fetchFromApis] cTrader API エラー、Twelve Data にフォールバック:`, error);
    }
  }

  // Twelve Data API（フォールバック：無料枠制限あり）
  if (marketDataService.isApiConfigured()) {
    try {
      const intervalMinutes = getIntervalMinutes(timeframe);
      const diffMs = endDate.getTime() - startDate.getTime();
      const estimatedBars = Math.ceil(diffMs / (intervalMinutes * 60 * 1000));

      console.log(
        `[fetchFromApis] Twelve Data API から取得: ${symbol}/${timeframe}, 推定=${estimatedBars}件`
      );

      const apiLimit = Math.min(estimatedBars + 100, 5000);
      const apiData = await marketDataService.getHistoricalData(symbol, timeframe, apiLimit);

      if (apiData.length > 0) {
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

        console.log(
          `[fetchFromApis] Twelve Data 取得成功: ${symbol}/${timeframe}, ${ohlcvData.length}件`
        );
        return ohlcvData;
      }
    } catch (error) {
      console.warn(`[fetchFromApis] Twelve Data API エラー:`, error);
    }
  }

  console.warn(`[fetchFromApis] 全APIソースからの取得に失敗: ${symbol}/${timeframe}`);
  return null;
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
    // OHLCVRepository.bulkInsert() で一括挿入（createMany + skipDuplicates + バッチ処理）
    const repo = new OHLCVRepository();
    const insertData = data.map(candle => ({
      symbol,
      timeframe,
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      source: 'api',
    }));
    const insertedCount = await repo.bulkInsert(insertData);
    console.log(`[cacheOhlcvData] ${insertedCount}/${data.length}件のデータをキャッシュ: ${symbol}/${timeframe}`);
  } catch (error) {
    // キャッシュ失敗はワーニングのみ（メイン処理は継続）
    console.warn(`[cacheOhlcvData] キャッシュ保存エラー:`, error);
  }
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

    // 使用するシンボル（リクエストで指定されていれば上書き）
    const effectiveSymbol = (request.symbol?.trim() || strategy.symbol) as string;
    if (!effectiveSymbol) {
      throw new Error('シンボルが指定されていません');
    }

    // Stage1: 高速スキャン（15m以上の時間足）
    const stage1Result = await executeBacktestStage(
      strategy,
      request,
      effectiveSymbol,
      'stage1',
      request.stage1Timeframe
    );

    // Stage2が必要な場合は1m足で精密検証
    let finalResult = stage1Result;
    if (request.runStage2 && stage1Result.trades.length > 0) {
      const stage2Result = await executeBacktestStage(
        strategy,
        request,
        effectiveSymbol,
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
      effectiveSymbol,
      request.source || 'manual'
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
  symbol: string,
  stage: BacktestStage,
  timeframe: BacktestTimeframe
): Promise<Omit<BacktestResult, 'id' | 'strategyId' | 'versionNumber' | 'executedAt' | 'startDate' | 'endDate' | 'status'>> {
  // ヒストリカルデータを取得
  const data = await fetchHistoricalData(
    symbol,
    timeframe,
    new Date(request.startDate),
    new Date(request.endDate),
    true // forceApiFetch: バックテスト実行時は不足データを自動取得
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

  // ポジション管理（チケット方式）
  const openPositions = new Map<string, OpenPosition>();
  const lotMode = request.lotMode || 'fixed';
  const maxPositions = Math.min(Math.max(request.maxPositions || 1, 1), 15);

  // SL を pips に変換（可変ロット計算用）
  // ※ エントリー価格がまだ不明なので、data の中央値を暫定使用
  //    実際の計算はエントリー時に行う
  // symbol は引数で渡される（リクエスト指定 or ストラテジー）

  // cTrader API からシンボルの digits を動的取得
  // digits が取れれば pipValue = 10^-(digits-1) で正確な値を使用
  // 取れなければ getPipValue() のハードコードフォールバック
  let symbolDigits: number | undefined;
  if (ctraderDataService.isConfigured()) {
    try {
      const ctraderToken = await prisma.cTraderToken.findFirst({
        orderBy: { lastConnectedAt: 'desc' },
      });
      if (ctraderToken) {
        const digits = await ctraderDataService.getSymbolDigits(ctraderToken.accountId, symbol);
        if (digits !== null) {
          symbolDigits = digits;
          console.log(`[executeBacktestStage] cTrader digits 取得: ${symbol} → digits=${digits}, pipValue=${Math.pow(10, -(digits - 1))}`);
        }
      }
    } catch (error) {
      console.warn(`[executeBacktestStage] cTrader digits 取得失敗、フォールバック使用: ${symbol}`, error);
    }
  }

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

    // ============ Phase 1: 既存ポジションのイグジット判定 ============
    const closedTickets: string[] = [];
    for (const [ticketId, pos] of openPositions) {
      const exitResult = checkExit(
        bar,
        pos.entryPrice,
        pos.side,
        exitSettings,
        i - pos.entryIndex,
        timeframe
      );

      if (exitResult.shouldExit) {
        const pnl = calculatePnl(
          pos.side,
          pos.entryPrice,
          exitResult.exitPrice,
          pos.lotSize
        );

        const requiredMargin = (pos.lotSize * pos.entryPrice) / request.leverage;

        trades.push({
          eventId: uuidv4(),
          entryTime: pos.entryTime,
          entryPrice: pos.entryPrice,
          exitTime: bar.timestamp.toISOString(),
          exitPrice: exitResult.exitPrice,
          side: pos.side,
          lotSize: pos.lotSize,
          pnl,
          pnlPercent: requiredMargin > 0 ? (pnl / requiredMargin) * 100 : 0,
          exitReason: exitResult.reason,
        });

        currentCapital += pnl;
        closedTickets.push(ticketId);
      }
    }
    // クローズ済みチケットを削除
    for (const ticketId of closedTickets) {
      openPositions.delete(ticketId);
    }

    // ============ Phase 2: 新規エントリー判定 ============
    if (openPositions.size < maxPositions) {
      const shouldEnter = await evaluateConditionGroup(ctx, entryConditions);

      if (shouldEnter && i + 1 < data.length) {
        const nextBar = data[i + 1];
        const entryPrice = nextBar.open;

        // ロットサイズ決定
        let tradeLotSize: number;
        if (lotMode === 'variable') {
          // リスクベース計算
          const slPips = slValueToPips(
            exitSettings.stopLoss.value,
            exitSettings.stopLoss.unit,
            entryPrice,
            symbol,
            symbolDigits
          );
          const result = calculateLotSize({
            capital: currentCapital,
            riskPercent: request.riskPercent,
            riskAmount: request.riskAmount,
            slPips,
            symbol,
            leverage: request.leverage,
            entryPrice,
            digits: symbolDigits,
          });
          tradeLotSize = result.lotSize;
        } else {
          tradeLotSize = request.lotSize;
        }

        // ロットが0以下ならスキップ
        if (tradeLotSize <= 0) {
          continue;
        }

        // 証拠金チェック
        const requiredMargin = (tradeLotSize * entryPrice) / request.leverage;
        const usedMargin = calculateUsedMargin(openPositions as Map<string, { entryPrice: number; lotSize: number }>, request.leverage);
        if (usedMargin + requiredMargin > currentCapital) {
          // 証拠金不足 → エントリースキップ
          continue;
        }

        const ticketId = uuidv4();
        openPositions.set(ticketId, {
          ticketId,
          entryPrice,
          entryTime: nextBar.timestamp.toISOString(),
          entryIndex: i + 1,
          lotSize: tradeLotSize,
          side: strategy.side as TradeSide,
        });
      }
    }
  }

  // 未クローズポジションを最終バーの終値で強制決済
  if (openPositions.size > 0 && data.length > 0) {
    const lastBar = data[data.length - 1];
    for (const [, pos] of openPositions) {
      const pnl = calculatePnl(
        pos.side,
        pos.entryPrice,
        lastBar.close,
        pos.lotSize
      );
      const requiredMargin = (pos.lotSize * pos.entryPrice) / request.leverage;
      trades.push({
        eventId: uuidv4(),
        entryTime: pos.entryTime,
        entryPrice: pos.entryPrice,
        exitTime: lastBar.timestamp.toISOString(),
        exitPrice: lastBar.close,
        side: pos.side,
        lotSize: pos.lotSize,
        pnl,
        pnlPercent: requiredMargin > 0 ? (pnl / requiredMargin) * 100 : 0,
        exitReason: 'timeout',
      });
      currentCapital += pnl;
    }
    openPositions.clear();
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

  // TP/SL ヒット判定
  // 同一バー内でTP/SL両方ヒットする場合はSL優先（保守的）
  let tpHit = false;
  let slHit = false;

  if (side === 'buy') {
    tpHit = bar.high >= tpPrice;
    slHit = bar.low <= slPrice;
  } else {
    tpHit = bar.low <= tpPrice;
    slHit = bar.high >= slPrice;
  }

  // 同一バーで両方ヒット → SL優先（保守的判定）
  if (slHit && tpHit) {
    return { shouldExit: true, exitPrice: slPrice, reason: 'stop_loss' };
  }
  if (slHit) {
    return { shouldExit: true, exitPrice: slPrice, reason: 'stop_loss' };
  }
  if (tpHit) {
    return { shouldExit: true, exitPrice: tpPrice, reason: 'take_profit' };
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
 * @param source - 実行ソース（manual/walkforward/montecarlo）
 */
async function saveBacktestResult(
  result: BacktestResult,
  versionId: string,
  symbol: string,
  source: BacktestSource = 'manual'
): Promise<void> {
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
      source: source,
      status: result.status === 'completed' ? 'completed' : result.status === 'failed' ? 'failed' : 'running',
    },
  });

  // 集計結果を保存（StrategyBacktestResult テーブル）
  if (result.status === 'completed') {
    // トレードごとに利益・損失を分離して集計（netProfitから振り分けない）
    const totalProfit = result.trades
      .filter(t => t.pnl > 0)
      .reduce((sum, t) => sum + t.pnl, 0);
    const totalLoss = result.trades
      .filter(t => t.pnl < 0)
      .reduce((sum, t) => sum + Math.abs(t.pnl), 0);

    await prisma.strategyBacktestResult.create({
      data: {
        runId: result.id,
        setupCount: result.summary.totalTrades,
        winCount: result.summary.winningTrades,
        lossCount: result.summary.losingTrades,
        timeoutCount: result.trades.filter(t => t.exitReason === 'timeout').length,
        winRate: result.summary.winRate,
        profitFactor: result.summary.profitFactor || null,
        totalProfit,
        totalLoss,
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

  // トレードイベントを先に構築
  const side = run.strategy.side as TradeSide;
  const trades: BacktestTradeEvent[] = run.events.map(e => {
    const entryPrice = e.entryPrice.toNumber();
    const exitPrice = e.exitPrice?.toNumber() || 0;
    const pnl = e.pnl?.toNumber() || 0;
    // pnlPercent: エントリー価格に対する変動率（%）
    const pnlPercent = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 * (side === 'buy' ? 1 : -1) : 0;
    return {
      eventId: e.id,
      entryTime: e.entryTime.toISOString(),
      entryPrice,
      exitTime: e.exitTime?.toISOString() || '',
      exitPrice,
      side,
      lotSize: 10000, // DB未保存のためデフォルト値
      pnl,
      pnlPercent,
      exitReason: e.outcome === 'win' ? 'take_profit' as const : e.outcome === 'loss' ? 'stop_loss' as const : 'timeout' as const,
      indicatorValues: e.indicatorValues as Record<string, number>,
    };
  });

  // サマリーをトレードイベントから再計算（averageWin/Loss/consecutiveWins等を正確に算出）
  const summary: BacktestResultSummary = trades.length > 0
    ? calculateSummary(trades, 1000000) // 初期資金はデフォルト値で再計算
    : createEmptySummary();

  // DB結果テーブルからmaxDrawdownを補完（calculateSummaryの値より正確な場合）
  if (run.result?.maxDrawdown) {
    const dbMaxDrawdown = run.result.maxDrawdown.toNumber();
    if (dbMaxDrawdown > summary.maxDrawdown) {
      summary.maxDrawdown = dbMaxDrawdown;
    }
  }

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
    trades,
    status: run.status as 'running' | 'completed' | 'failed',
  };
}

/**
 * ストラテジーのバックテスト履歴を取得
 * @param strategyId - ストラテジーID
 * @param limit - 取得件数上限
 * @param source - 実行ソースでフィルタリング（省略時は 'manual' のみ）
 */
export async function getBacktestHistory(
  strategyId: string,
  limit: number = 20,
  source: BacktestSource | 'all' = 'manual'
): Promise<BacktestResult[]> {
  // フィルタ条件を構築（source='all' の場合はフィルタなし）
  const whereCondition: { strategyId: string; source?: string } = { strategyId };
  if (source !== 'all') {
    whereCondition.source = source;
  }

  const runs = await prisma.strategyBacktestRun.findMany({
    where: whereCondition,
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
    // トレードイベントを構築
    const side = run.strategy.side as TradeSide;
    const trades: BacktestTradeEvent[] = run.events.map(e => {
      const entryPrice = e.entryPrice.toNumber();
      const exitPrice = e.exitPrice?.toNumber() || 0;
      const pnl = e.pnl?.toNumber() || 0;
      const pnlPercent = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 * (side === 'buy' ? 1 : -1) : 0;
      return {
        eventId: e.id,
        entryTime: e.entryTime.toISOString(),
        entryPrice,
        exitTime: e.exitTime?.toISOString() || '',
        exitPrice,
        side,
        lotSize: 10000,
        pnl,
        pnlPercent,
        exitReason: e.outcome === 'win' ? 'take_profit' as const : e.outcome === 'loss' ? 'stop_loss' as const : 'timeout' as const,
        indicatorValues: e.indicatorValues as Record<string, number>,
      };
    });

    // サマリーをトレードイベントから再計算
    const summary: BacktestResultSummary = trades.length > 0
      ? calculateSummary(trades, 1000000)
      : createEmptySummary();

    if (run.result?.maxDrawdown) {
      const dbMaxDrawdown = run.result.maxDrawdown.toNumber();
      if (dbMaxDrawdown > summary.maxDrawdown) {
        summary.maxDrawdown = dbMaxDrawdown;
      }
    }

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
      trades,
      status: run.status as 'running' | 'completed' | 'failed',
    };
  });
}
