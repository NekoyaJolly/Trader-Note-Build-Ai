/**
 * ストラテジーバックテストサービス
 * 
 * 目的:
 * - ストラテジー条件をヒストリカルデータに適用してバックテスト実行
 * - 2段階バックテスト: Stage1（高速スキャン）、Stage2（精密検証）
 * - 損益計算、パフォーマンス指標の算出
 */

import type { BacktestOutcome } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db/client';
import type { StrategyDetail } from './strategyService';
import { getStrategy } from './strategyService';
import type {
  BacktestTradeEvent as BaseBacktestTradeEvent,
  BacktestResultSummary,
  TradeSide} from './backtestCalculations';
import {
  calculatePnl,
  calculateSummary,
  createEmptySummary
} from './backtestCalculations';
import type {
  EvaluationContext,
  ConditionGroup,
  IndicatorCondition,
  OHLCV,
  LogicalOperator,
  ComparisonOperator,
  CandlePatternId} from './strategyConditionEvaluator';
import {
  evaluateCondition,
  evaluateConditionGroup,
  collectTimeframeOverrides,
  collectLensConditions,
  makeLensCacheKey,
  buildTimeframeIndexMap,
  type LensCondition,
  type TimeframeView,
} from './strategyConditionEvaluator';
import { ALL_CANDLE_PATTERN_IDS } from '../../shared/patterns';
import { CTraderDataService } from './ctrader/ctraderDataService';
import { CTraderAuthService } from './ctrader/ctraderAuthService';
import { calculateLotSize, slValueToPips, getPipValue } from './positionSizeCalculator';
import { fetchAndCacheOhlcv, isOhlcvRemoteFetchAvailable } from './fetchAndCacheOhlcv';
import {
  fetchIndicatorSeries,
  fetchIndicatorSeriesByStrategyVersion,
  makeIndicatorCacheKey,
} from './analysisEngineClient';
import type { AnalysisEngineIndicatorSpec } from '../../schemas/external/analysisEngine';
// レンズ条件タイプ (#3): lensId → 計算仕様の逆解決と per-bar 系列化はレンズ基盤を使う
import {
  computeIndicatorLensFeatureSeries,
  parseIndicatorLensId,
  type IndicatorLensSpec,
} from '../../shared/similarity/indicatorLenses';
// 状態レンズ (#3 第2弾): TS 側計算の per-bar 系列化
import { appendStateLensSeriesToCache } from '../../services/stateLensSeries';
import {
  encodeLensFeatureValueAsNumber,
  getLensFeatureComparator,
} from '../../shared/similarity/lensComparators';
import { TIMEFRAME_MS } from '../../infrastructure/market/ohlcvAggregation';

// 計算関数を再エクスポート（後方互換性のため）
export { calculatePnl, calculateSummary, createEmptySummary };
export type { BacktestResultSummary, TradeSide };

// 条件評価関数を再エクスポート（後方互換性とテスト用）
export { evaluateCondition, evaluateConditionGroup };
export type { EvaluationContext, ConditionGroup, IndicatorCondition, OHLCV };

// cTrader サービスのインスタンス
const ctraderAuthService = new CTraderAuthService(prisma);
const ctraderDataService = new CTraderDataService(ctraderAuthService);

// ============================================
// 型定義
// ============================================

/** バックテストの時間足 */
export type BacktestTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

/**
 * BacktestTimeframe として安全に扱える時間足か (downstream の getIntervalMinutes /
 * fetchHistoricalData / EODHD fetch が対応する集合)。
 * MTF override では上位足 (1d/1w) も対象。'1M' 等の未対応足や手動編集 JSON の
 * 不正値はここで弾く (Copilot レビュー対応)。
 */
const BACKTEST_TIMEFRAMES: readonly BacktestTimeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
export function isBacktestTimeframe(tf: string): tf is BacktestTimeframe {
  return (BACKTEST_TIMEFRAMES as readonly string[]).includes(tf);
}

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
  lotSize: number; // 固定ロット入力（lotSizeUnit により解釈が変わる）
  /** 固定ロット入力の単位（デフォルト: currency=通貨数） */
  lotSizeUnit?: 'currency' | 'lots';
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
  /** エントリー時点の有効証拠金（%利確/損切の基準） */
  entryEquity: number;
  /** エントリー時点の必要証拠金（%損益表示の基準にも使用） */
  entryRequiredMargin: number;
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
  // プリセットの存在確認（表示用）
  const preset = await prisma.dataPreset.findUnique({
    where: {
      symbol_timeframe: {
        symbol,
        timeframe,
      },
    },
  });

  // DB 内のデータ件数 + 最古/最新タイムスタンプ（要求期間内）を取得
  const stats = await prisma.oHLCVCandle.aggregate({
    where: {
      symbol,
      timeframe,
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    },
    _count: { _all: true },
    _min: { timestamp: true },
    _max: { timestamp: true },
  });

  const dataCount = stats._count._all;
  const minTs = stats._min.timestamp;
  const maxTs = stats._max.timestamp;

  // 期待バー数（表示用）: 休場・ブローカー休止を正確に推定できないため、単純な概算に留める
  const intervalMinutes = getIntervalMinutes(timeframe);
  const diffMs = endDate.getTime() - startDate.getTime();
  const expectedCount = diffMs > 0
    ? Math.max(0, Math.ceil(diffMs / (intervalMinutes * 60 * 1000)))
    : 0;

  if (dataCount === 0 || !minTs || !maxTs) {
    return {
      hasCoverage: false,
      presetExists: !!preset,
      dataCount,
      expectedCount,
      missingStart: startDate,
      missingEnd: endDate,
      coverageRatio: 0,
    };
  }

  // coversStart/coversEnd 判定（バックテスト実行時の fetchHistoricalData と同じ考え方）
  // 理由: プリセットの start/end が古いままでも、実データが期間をカバーしていれば警告を出さないため
  //
  // 2026-05-24 (PR #253): fetchHistoricalData と同じく、3 バーと 49 時間 (FX 週末
  // クローズ 48h + 1h バッファ) の大きい方を採用。週末/祝日ギャップで coverage
  // 判定が常に false 化するのを防ぐ。
  const baseToleranceMs = intervalMinutes * 60 * 1000 * 3; // 3バー分
  const minToleranceMs = 49 * 60 * 60 * 1000; // 49h (= FX 週末クローズ 48h + 1h)
  const toleranceMs = Math.max(baseToleranceMs, minToleranceMs);
  const coversStart = minTs.getTime() <= startDate.getTime() + toleranceMs;
  const coversEnd = maxTs.getTime() >= endDate.getTime() - toleranceMs;

  let missingStart: Date | undefined;
  let missingEnd: Date | undefined;

  if (!coversStart) {
    missingStart = startDate;
    missingEnd = new Date(Math.min(minTs.getTime(), endDate.getTime()));
  }
  if (!coversEnd) {
    if (!missingStart) {
      missingStart = new Date(Math.max(maxTs.getTime(), startDate.getTime()));
    }
    missingEnd = endDate;
  }

  const hasCoverage = coversStart && coversEnd;
  const coverageRatio = expectedCount > 0 ? Math.min(dataCount / expectedCount, 1.0) : 0;

  return {
    hasCoverage,
    presetExists: !!preset,
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
 * 2. 不足時: cTrader API から取得（ブローカーと同一の価格・足区切り）
 * 3. それでも不足: 既存キャッシュのみ返却（モックは使用しない）
 *
 * @param symbol - シンボル
 * @param timeframe - 時間足
 * @param startDate - 開始日
 * @param endDate - 終了日
 * @param forceApiFetch - 後方互換用。`true` のとき従来どおり遠隔取得を試行。
 * デフォルト `false` でも、**キャッシュが期間未充足**かつ cTrader（.env + OAuth トークン）が使えるなら
 * 自動的に補完取得する（以前は常に `forceApiFetch: true` を付けないと DSL 等が遠隔取得できなかった不具合の修正）
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
  //
  // 2026-05-24 (PR #253): tolerance は **3 バー** と **49 時間 (= 週末 + 1h バッファ)** の
  // 大きい方を採用。旧版は 3 バー固定 (= 15m なら 45 分) だったため、要求期間開始が
  // 週末・祝日・年末年始等で cTrader データ無し期間に当たると永遠に coversStart=false で
  // fetchAndCacheOhlcv 再呼び出しが無限ループ (= EvolutionLoop で 43 回再 fetch、
  // smoke 50-60 分の主因)。
  //
  // 2026-05-24 (PR #253 Copilot review): 当初 24h で実装したが、FX 週末クローズは
  // 金 21:00 UTC → 日 21:00 UTC の 48h ギャップ。24h では coversStart=false のまま
  // ループ抑止できない。最低 49h (= 48h 週末 + 1h バッファ) に拡大。
  const baseToleranceMs = intervalMinutes * 60 * 1000 * 3; // 3 バー分
  const minToleranceMs = 49 * 60 * 60 * 1000; // 49h (= FX 週末クローズ 48h + 1h)
  const toleranceMs = Math.max(baseToleranceMs, minToleranceMs);
  let coversStart = false;
  let coversEnd = false;
  if (cachedData.length > 0) {
    const cacheStart = cachedData[0].timestamp.getTime();
    const cacheEnd = cachedData[cachedData.length - 1].timestamp.getTime();
    coversStart = cacheStart <= startDate.getTime() + toleranceMs;
    coversEnd = cacheEnd >= endDate.getTime() - toleranceMs;

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

  // 3. 期間未充足時: 遠隔 API で補完（EODHD 優先 → cTrader フォールバック。Twelve Data は廃止）
  const needsRemoteFill = cachedData.length === 0 || !coversStart || !coversEnd;
  const canRemoteFetch = isOhlcvRemoteFetchAvailable();
  if (forceApiFetch || (needsRemoteFill && canRemoteFetch)) {
    try {
      // fetchAndCacheOhlcv は「指定期間」を分割取得し、DBにupsertしてDataPresetも更新する
      const cacheResult = await fetchAndCacheOhlcv(symbol, timeframe, startDate, endDate);
      if (!cacheResult.success) {
        console.warn(`[fetchHistoricalData] API取得(キャッシュ)失敗: ${cacheResult.error}`);
      }
    } catch (error) {
      console.warn(`[fetchHistoricalData] API取得(キャッシュ)中に例外:`, error);
    }

    // 取得後、DBから再取得（upsert 済みなのでDBが正）
    const mergedData = await prisma.oHLCVCandle.findMany({
      where: {
        symbol,
        timeframe,
        timestamp: { gte: startDate, lte: endDate },
      },
      orderBy: { timestamp: 'asc' },
    });

    if (mergedData.length > 0) {
      console.log(
        `[fetchHistoricalData] API取得+キャッシュ反映後: ${symbol}/${timeframe}, ${mergedData.length}件`
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
  } else if (needsRemoteFill && !canRemoteFetch) {
    console.log(
      `[fetchHistoricalData] 遠隔 API 未設定のため補完取得をスキップ: ${symbol}/${timeframe} ` +
      `（EODHD_API_KEY、または cTrader CLIENT_ID/SECRET + DB の OAuth トークン）`
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
    '1w': 10080,
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
    const effectiveSymbol = (request.symbol?.trim() || strategy.symbol);
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
 * analysis-engine の指標系列レスポンスを evaluator 用キャッシュに変換する。
 *
 * バックテスト(executeBacktestStage)とライブ条件評価(strategyLiveEvaluationService)が
 * **同じ変換**を通ることで「評価 1 経路化」を保証する(completion-roadmap §3)。
 *
 * - null(欠損)は NaN に寄せて evaluator 側で undefined 扱いにする
 * - Python 側キーを正規化して格納(Python float "14.0" → JS int "14" 互換)。
 *   理由: Python は JSON で数値を float (14.0) として出力し、Node は int (14) として出力する。
 *   evaluateCondition → getIndicatorValue は makeIndicatorCacheKey で Node 形式のキーを生成するため、
 *   Python 形式のキーのままではキャッシュルックアップが常に失敗し 0 トレードになる。
 */
export function buildEvaluationCaches(indicatorSeries: {
  series: Record<string, Array<number | null>>;
  patterns?: Record<string, boolean[]>;
}): { indicatorCache: Map<string, number[]>; patternCache: Map<CandlePatternId, boolean[]> } {
  const indicatorCache = new Map<string, number[]>();
  for (const [key, values] of Object.entries(indicatorSeries.series)) {
    const mappedValues = values.map(v => (v === null ? Number.NaN : v));
    const normalizedKey = key.replace(
      /(\d+)\.0(?=[,}])/g,
      '$1'
    );
    indicatorCache.set(normalizedKey, mappedValues);

    // 元のキー（Python形式）でもセットしておく（安全策: 他のコードパスからの参照用）
    if (normalizedKey !== key) {
      indicatorCache.set(key, mappedValues);
    }
  }

  // patterns（bool系列）を evaluator が使えるように格納
  // 注意: analysis-engine は patterns を任意計算にしているため、未指定の場合は空。
  // パターン ID の単一情報源は shared/patterns の ALL_CANDLE_PATTERN_IDS(ドリフト防止)
  const patternCache = new Map<CandlePatternId, boolean[]>();
  for (const [patternId, flags] of Object.entries(indicatorSeries.patterns ?? {})) {
    if ((ALL_CANDLE_PATTERN_IDS as readonly string[]).includes(patternId)) {
      patternCache.set(patternId as CandlePatternId, flags);
    }
  }

  return { indicatorCache, patternCache };
}

/**
 * レンズ条件 (#3) の per-bar 系列を evaluator キャッシュに追加する。
 *
 * 流れ:
 * 1. 条件ツリーから収集したレンズ条件の lensId を parseIndicatorLensId で計算仕様へ逆解決
 *    (不正な lensId は警告してスキップ = 当該条件は評価時に不成立)
 * 2. 必要な指標系列を重複排除し、analysis-engine の明示指定 API で 1 回取得
 *    (by-version API は Python 側抽出がレンズ条件を知らないため、別途この 1 呼び出しを足す)
 * 3. computeIndicatorLensFeatureSeries で per-bar 化(先読み禁止。設計書 §12.2)
 * 4. 数値エンコードして `lens:<lensId>:<featureKey>` キーで格納(§12.6 確定規約)
 *
 * バックテストとライブ条件評価が**同じ本関数**を通ることで評価 1 経路を維持する。
 * レンズ条件が無ければ何もしない(analysis-engine の追加呼び出しも発生しない)。
 */
export async function appendLensSeriesToCache(params: {
  indicatorCache: Map<string, number[]>;
  /** レンズ条件 (lensId のみ参照するため、プレビュー経路は {lensId} の最小形で渡せる) */
  lensConditions: ReadonlyArray<Pick<LensCondition, 'lensId'>>;
  symbol: string;
  timeframe: string;
  startDate: Date;
  endDate: Date;
  /** 評価バー列の終値(レンズ系列はこの長さ・並びに index 整合していなければならない) */
  closes: ReadonlyArray<number>;
  /** テスト用 DI(未指定なら analysis-engine 実呼び出し) */
  fetchIndicatorSeriesFn?: typeof fetchIndicatorSeries;
}): Promise<void> {
  if (params.lensConditions.length === 0) {
    return;
  }

  // 1. lensId → 計算仕様(重複 lensId は 1 回だけ解決)
  const specs = new Map<string, IndicatorLensSpec>();
  for (const condition of params.lensConditions) {
    if (!condition.lensId.startsWith('ind:')) {
      // 状態レンズ (time_session 等) は appendStateLensSeriesToCache の担当 (#3 第2弾)
      continue;
    }
    if (specs.has(condition.lensId)) continue;
    const spec = parseIndicatorLensId(condition.lensId);
    if (!spec) {
      console.warn(`[LensSeries] 不正な lensId のためレンズ条件をスキップします: ${condition.lensId}`);
      continue;
    }
    specs.set(condition.lensId, spec);
  }
  if (specs.size === 0) {
    return;
  }

  // 2. 必要系列をキャッシュキーで重複排除し、**未取得分のみ**一括取得する
  //    (指標条件とレンズ条件が同じ系列を使う場合、by-version 経由で既に
  //     indicatorCache に入っているため再取得しない。Copilot レビュー対応 PR #399)
  const indicatorSpecs = new Map<string, AnalysisEngineIndicatorSpec>();
  for (const spec of specs.values()) {
    for (const required of spec.requiredSeries) {
      const key = makeIndicatorCacheKey(required.indicatorId, { ...required.params }, required.field);
      if (params.indicatorCache.has(key) || indicatorSpecs.has(key)) {
        continue;
      }
      indicatorSpecs.set(key, {
        indicatorId: required.indicatorId,
        params: { ...required.params },
        field: required.field,
      });
    }
  }
  // Python キーの正規化(buildEvaluationCaches と同じ変換)を通して Node 形式キーで引けるようにする
  let fetchedByKey = new Map<string, number[]>();
  if (indicatorSpecs.size > 0) {
    const fetchFn = params.fetchIndicatorSeriesFn ?? fetchIndicatorSeries;
    const response = await fetchFn({
      symbol: params.symbol,
      timeframe: params.timeframe,
      startDate: params.startDate,
      endDate: params.endDate,
      indicators: [...indicatorSpecs.values()],
    });
    fetchedByKey = buildEvaluationCaches({ series: response.series }).indicatorCache;
  }

  // 3-4. レンズごとに per-bar 系列化 → 数値エンコード → キャッシュ格納
  for (const [lensId, spec] of specs) {
    const seriesInput: Record<string, ReadonlyArray<number | null>> = {};
    let missing = false;
    for (const required of spec.requiredSeries) {
      const key = makeIndicatorCacheKey(required.indicatorId, { ...required.params }, required.field);
      // 取得済みキャッシュ(by-version 等)を優先し、無ければ今回フェッチした系列を使う
      const series = params.indicatorCache.get(key) ?? fetchedByKey.get(key);
      if (!series) {
        console.warn(`[LensSeries] 必要系列が analysis-engine から取得できませんでした: ${key}`);
        missing = true;
        break;
      }
      if (series.length !== params.closes.length) {
        // バー列と系列の index がズレると誤った時点の値で判定する事故になるため中断する
        throw new Error(
          `レンズ系列(${key})の長さ(${series.length})がバー列(${params.closes.length})と一致しません`
        );
      }
      seriesInput[required.seriesKey] = series;
    }
    if (missing) continue;

    const featureSeries = computeIndicatorLensFeatureSeries(spec, {
      close: params.closes,
      series: seriesInput,
    });
    for (const [featureKey, values] of Object.entries(featureSeries)) {
      const comparator = getLensFeatureComparator(lensId, featureKey);
      const encoded = values.map((value) => {
        if (value === null) return Number.NaN;
        const numeric = encodeLensFeatureValueAsNumber(comparator, value);
        // エンコード不能(カタログ未定義等)は欠損と同じ扱い = 条件不成立に倒す
        return numeric === null ? Number.NaN : numeric;
      });
      params.indicatorCache.set(makeLensCacheKey(lensId, featureKey), encoded);
    }
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

  const entryConditions = strategy.currentVersion!.entryConditions as ConditionGroup;
  // side=both（Buy & Sell）のときのみ使う「売り用」条件。buy/sell では未使用。
  const shortEntryConditions = (strategy.currentVersion?.shortEntryConditions ?? null) as ConditionGroup | null;
  const exitSettings = strategy.currentVersion!.exitSettings as ExitSettings;

  // 評価する (方向, 条件) のリスト（バックテスト全体で不変）。
  // - buy/sell: entryConditions をその方向の条件として評価
  // - both: entryConditions=買い条件 / shortEntryConditions=売り条件 を別々に評価し、
  //   発火した側を建てる（同一足で両方発火時は買いを優先。同時保有数は maxPositions で制限）
  const entryPlans: { side: TradeSide; group: ConditionGroup | null }[] =
    strategy.side === 'both'
      ? [
          { side: 'buy', group: entryConditions },
          { side: 'sell', group: shortEntryConditions },
        ]
      : [{ side: strategy.side, group: entryConditions }];

  // analysis-engine（Python）から指標系列を一括取得
  // 理由: Node 側での指標計算を廃止し、pandas-ta を正とする
  const startDate = new Date(request.startDate);
  const endDate = new Date(request.endDate);
  let indicatorSeries: Awaited<ReturnType<typeof fetchIndicatorSeriesByStrategyVersion>>;
  try {
    indicatorSeries = await fetchIndicatorSeriesByStrategyVersion({
      strategyId: strategy.id,
      versionId: strategy.currentVersion!.id,
      symbol,
      timeframe,
      startDate,
      endDate,
      // 将来の条件ビルダ拡張に備えて pattern も取得可能（現時点では未使用）
      patterns: [],
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(
      `analysis-engine に接続できません。Docker Compose で analysis-engine を起動しているか、ANALYSIS_ENGINE_URL を確認してください。詳細: ${messageText}`
    );
    if (error instanceof Error) {
      (wrapped as Error & { cause?: Error }).cause = error;
    }
    throw wrapped;
  }

  const { indicatorCache, patternCache } = buildEvaluationCaches(indicatorSeries);

  // === レンズ条件 (#3): per-bar レンズ系列を基準足キャッシュに追加 ===
  // timeframeOverride 付きのレンズ条件は後段の各ビュー側キャッシュに積む
  const allLensConditions = entryPlans.flatMap((plan) => collectLensConditions(plan.group));
  const baseLensConditions = allLensConditions.filter(
    (c) => !c.timeframeOverride || c.timeframeOverride === timeframe
  );
  await appendLensSeriesToCache({
    indicatorCache,
    lensConditions: baseLensConditions,
    symbol,
    timeframe,
    startDate,
    endDate,
    closes: data.map((bar) => bar.close),
  });
  // 状態レンズ (#3 第2弾): TS 側計算のみ・analysis-engine 不要
  await appendStateLensSeriesToCache({
    indicatorCache,
    lensConditions: baseLensConditions,
    symbol,
    timeframe,
    bars: data,
  });

  // === MTF: timeframeOverride 条件用の別時間足ビューを準備 (Phase γ) ===
  // 条件ツリーから使用時間足を収集し、足ごとにバー列 + 指標系列を取得して
  // 「基準足 index → 確定バー index」の対応表ごと evaluator に渡す。
  const overrideTimeframes = new Set<string>();
  for (const plan of entryPlans) {
    for (const tf of collectTimeframeOverrides(plan.group, timeframe)) {
      overrideTimeframes.add(tf);
    }
  }
  const timeframeViews = new Map<string, TimeframeView>();
  for (const tf of overrideTimeframes) {
    // downstream (getIntervalMinutes / fetchHistoricalData) が対応する BacktestTimeframe
    // 以外 (例: 手動編集 JSON の '1w') は弾く (Copilot レビュー対応)
    if (!isBacktestTimeframe(tf)) {
      throw new Error(`timeframeOverride に未対応の時間足が指定されています: ${tf}`);
    }
    const viewTfMs = TIMEFRAME_MS[tf];
    const viewData = await fetchHistoricalData(
      symbol,
      tf,
      new Date(request.startDate),
      new Date(request.endDate),
      true
    );
    if (viewData.length === 0) {
      throw new Error(`timeframeOverride=${tf} のヒストリカルデータが取得できませんでした`);
    }
    const viewSeries = await fetchIndicatorSeriesByStrategyVersion({
      strategyId: strategy.id,
      versionId: strategy.currentVersion!.id,
      symbol,
      timeframe: tf,
      startDate,
      endDate,
      patterns: [],
    });
    const viewCaches = buildEvaluationCaches(viewSeries);
    // バー列と指標/パターン系列の index 整合ガード (live 評価と同じ事故防止)。
    // パターン条件のみのストラテジーは indicatorCache が空のため patternCache も検証する
    const viewLengths = [
      ...viewCaches.indicatorCache.values(),
      ...viewCaches.patternCache.values(),
    ].map((v) => v.length);
    if (viewLengths.some((len) => len !== viewData.length)) {
      throw new Error(
        `timeframeOverride=${tf} のバー列(${viewData.length}本)と指標/パターン系列の長さが一致しません。` +
          `誤った時点の値で判定する事故を防ぐため中断します`
      );
    }
    // レンズ条件 (#3): この足を override に指定したレンズ条件の系列をビュー側キャッシュへ
    const viewLensConditions = allLensConditions.filter((c) => c.timeframeOverride === tf);
    await appendLensSeriesToCache({
      indicatorCache: viewCaches.indicatorCache,
      lensConditions: viewLensConditions,
      symbol,
      timeframe: tf,
      startDate,
      endDate,
      closes: viewData.map((bar) => bar.close),
    });
    await appendStateLensSeriesToCache({
      indicatorCache: viewCaches.indicatorCache,
      lensConditions: viewLensConditions,
      symbol,
      timeframe: tf,
      bars: viewData,
    });
    timeframeViews.set(tf, {
      data: viewData,
      indicatorCache: viewCaches.indicatorCache,
      patternCache: viewCaches.patternCache,
      indexMap: buildTimeframeIndexMap(data, TIMEFRAME_MS[timeframe], viewData, viewTfMs),
    });
  }

  // 評価コンテキストを初期化
  const ctx: EvaluationContext = {
    data,
    currentIndex: 0,
    indicatorCache,
    patternCache,
    strategy,
    ...(timeframeViews.size > 0 ? { timeframeViews } : {}),
  };

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
  let symbolContractSize: number | undefined;
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

        const contractSize = await ctraderDataService.getSymbolContractSize(ctraderToken.accountId, symbol);
        if (contractSize !== null) {
          symbolContractSize = contractSize;
          console.log(`[executeBacktestStage] cTrader contractSize 取得: ${symbol} → contractSize=${contractSize}`);
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
        timeframe,
        {
          lotSize: pos.lotSize,
          entryEquity: pos.entryEquity,
          symbol,
          digits: symbolDigits,
        }
      );

      if (exitResult.shouldExit) {
        const pnl = calculatePnl(
          pos.side,
          pos.entryPrice,
          exitResult.exitPrice,
          pos.lotSize
        );

        const requiredMargin = pos.entryRequiredMargin;

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
    // 方向ごとに条件を評価する（both は買い→売りの順、買い優先）。
    for (const plan of entryPlans) {
      if (openPositions.size >= maxPositions) break;
      if (!plan.group) continue;
      const shouldEnter = await evaluateConditionGroup(ctx, plan.group);

      if (shouldEnter) {
        const entryTiming = (strategy.currentVersion?.entryTiming || 'next_open').toLowerCase();

        // 現足エントリー: 条件成立した「その足」でエントリー
        // - current_close: 終値でエントリー（実装上の近似）
        // - それ以外は next_open（従来互換）
        const isCurrentBarEntry = entryTiming === 'current_close' || entryTiming === 'current_bar' || entryTiming === 'current';

        if (!isCurrentBarEntry && i + 1 >= data.length) {
          continue;
        }

        const entryBar = isCurrentBarEntry ? bar : data[i + 1];
        const entryPrice = isCurrentBarEntry ? bar.close : entryBar.open;
        const entryIndex = isCurrentBarEntry ? i : i + 1;

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
          // 固定ロット:
          // - currency: そのまま通貨数
          // - lots: ロット数 × contractSize（1ロットあたり通貨数）
          if ((request.lotSizeUnit || 'currency') === 'lots') {
            const contractSize = symbolContractSize ?? 100000;
            tradeLotSize = request.lotSize * contractSize;
          } else {
            tradeLotSize = request.lotSize;
          }
        }

        // ロットが0以下ならスキップ
        if (tradeLotSize <= 0) {
          continue;
        }

        // 証拠金チェック
        // 必要証拠金 = (現在価格 × 通貨数) / レバレッジ
        const requiredMargin = (entryPrice * tradeLotSize) / request.leverage;

        // 使用中証拠金も「現在価格（近似: 現在足の終値）」ベースで再計算
        let usedMargin = 0;
        for (const [, pos] of openPositions) {
          usedMargin += (bar.close * pos.lotSize) / request.leverage;
        }

        if (usedMargin + requiredMargin > currentCapital) {
          // 証拠金不足 → エントリースキップ
          continue;
        }

        const ticketId = uuidv4();
        // この plan の方向で建てる（both は買い/売りを別 plan として評価済み）
        const entrySide: TradeSide = plan.side;
        openPositions.set(ticketId, {
          ticketId,
          entryPrice,
          entryTime: entryBar.timestamp.toISOString(),
          entryIndex,
          lotSize: tradeLotSize,
          side: entrySide,
          entryEquity: currentCapital,
          entryRequiredMargin: requiredMargin,
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
      const requiredMargin = pos.entryRequiredMargin;
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
  timeframe: BacktestTimeframe,
  basis: {
    /** ポジション数量（通貨数） */
    lotSize: number;
    /** %利確/損切の基準（エントリー時の有効証拠金） */
    entryEquity: number;
    /** pipValue フォールバック用のシンボル */
    symbol: string;
    /** cTrader digits（あれば優先） */
    digits?: number;
  }
): { shouldExit: boolean; exitPrice: number; reason: 'take_profit' | 'stop_loss' | 'timeout' | 'signal' } {
  const intervalMinutes = getIntervalMinutes(timeframe);
  const minutesHeld = barsHeld * intervalMinutes;

  // 利確・損切のしきい値を計算
  let tpPrice: number;
  let slPrice: number;

  // % の場合: 「価格変動率」ではなく「損益額（entryEquity 基準）」として扱う
  // 例: takeProfit=1% → entryEquity の 1% 分の利益が出たら利確
  if (exitSettings.takeProfit.unit === 'percent') {
    const targetProfit = basis.entryEquity * (exitSettings.takeProfit.value / 100);
    const tpDiff = basis.lotSize > 0 ? targetProfit / basis.lotSize : 0;
    tpPrice = side === 'buy' ? entryPrice + tpDiff : entryPrice - tpDiff;
  } else {
    // Pips: digits を参照して動的化（10 pips などが通貨ごとに正しい値幅になる）
    const pipValue = getPipValue(basis.symbol, basis.digits);
    const tpDiff = exitSettings.takeProfit.value * pipValue;
    tpPrice = side === 'buy' ? entryPrice + tpDiff : entryPrice - tpDiff;
  }

  if (exitSettings.stopLoss.unit === 'percent') {
    const targetLoss = basis.entryEquity * (exitSettings.stopLoss.value / 100);
    const slDiff = basis.lotSize > 0 ? targetLoss / basis.lotSize : 0;
    slPrice = side === 'buy' ? entryPrice - slDiff : entryPrice + slDiff;
  } else {
    const pipValue = getPipValue(basis.symbol, basis.digits);
    const slDiff = exitSettings.stopLoss.value * pipValue;
    slPrice = side === 'buy' ? entryPrice - slDiff : entryPrice + slDiff;
  }

  // TP/SL ヒット判定
  // 同一バー内でTP/SL両方ヒットする場合はSL優先（保守的）
  const tpHit = side === 'buy' ? bar.high >= tpPrice : bar.low <= tpPrice;
  const slHit = side === 'buy' ? bar.low <= slPrice : bar.high >= slPrice;

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
    // Critical-9: winCount/lossCount/totalProfit/totalLoss は全て pnl 符号で統一する。
    // calculateSummary も pnl > 0 / pnl < 0 で winningTrades/losingTrades を返すので整合。
    // timeoutCount は exitReason='timeout' の件数（TP/SL に届かなかった件数の参考値）であり、
    // winCount/lossCount とは独立軸であるため意味的に重複しうる点に注意。
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
        // both で買い/売りを区別できるよう各トレードの方向を保存する
        side: trade.side,
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
  // both は各イベントの side（買い/売り）を保存済み。legacy(null) は当時の strategy.side から復元
  // （both の legacy は片側のみ記録されていたため buy にフォールバック）。
  const fallbackSide: TradeSide = (run.strategy.side === 'both' ? 'buy' : run.strategy.side);
  const trades: BacktestTradeEvent[] = run.events.map(e => {
    const eventSide: TradeSide = e.side === 'buy' || e.side === 'sell' ? e.side : fallbackSide;
    const entryPrice = e.entryPrice.toNumber();
    const exitPrice = e.exitPrice?.toNumber() || 0;
    const pnl = e.pnl?.toNumber() || 0;
    // pnlPercent: エントリー価格に対する変動率（%）。売りは符号反転。
    const pnlPercent = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 * (eventSide === 'buy' ? 1 : -1) : 0;
    return {
      eventId: e.id,
      entryTime: e.entryTime.toISOString(),
      entryPrice,
      exitTime: e.exitTime?.toISOString() || '',
      exitPrice,
      side: eventSide,
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
    // トレードイベントを構築（side は各イベント保存値を優先、legacy は strategy.side から復元）
    const fallbackSide: TradeSide = (run.strategy.side === 'both' ? 'buy' : run.strategy.side);
    const trades: BacktestTradeEvent[] = run.events.map(e => {
      const eventSide: TradeSide = e.side === 'buy' || e.side === 'sell' ? e.side : fallbackSide;
      const entryPrice = e.entryPrice.toNumber();
      const exitPrice = e.exitPrice?.toNumber() || 0;
      const pnl = e.pnl?.toNumber() || 0;
      const pnlPercent = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 * (eventSide === 'buy' ? 1 : -1) : 0;
      return {
        eventId: e.id,
        entryTime: e.entryTime.toISOString(),
        entryPrice,
        exitTime: e.exitTime?.toISOString() || '',
        exitPrice,
        side: eventSide,
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
