/**
 * OHLCV インジェストサービス
 *
 * 日次でウォッチリストのシンボルのOHLCVデータを取得し、DBに蓄積
 * - Watchlist モデルからアクティブなシンボル一覧を取得
 * - Twelve Data API から OHLCV データを取得
 * - OHLCVCandle テーブルに保存
 * - レート制限対策（bottleneck）
 */

import { PrismaClient } from '@prisma/client';
import Bottleneck from 'bottleneck';

const prisma = new PrismaClient();

// Twelve Data API のレート制限: 8 req/min（無料プラン）
// 安全マージンを取って 7 req/min に設定
const limiter = new Bottleneck({
  reservoir: 7, // 初期トークン数
  reservoirRefreshAmount: 7, // リフレッシュ時の追加トークン数
  reservoirRefreshInterval: 60 * 1000, // 1分ごとにリフレッシュ
  maxConcurrent: 1, // 同時実行数
  minTime: 9000, // リクエスト間の最小間隔（約6.7秒）
});

// Twelve Data API 設定
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY || '';
const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com';

/**
 * OHLCVデータの型定義
 */
export interface OHLCVData {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Twelve Data API レスポンスの型
 */
interface TwelveDataTimeSeriesResponse {
  meta?: {
    symbol: string;
    interval: string;
    currency?: string;
    exchange_timezone?: string;
    type?: string;
  };
  values?: Array<{
    datetime: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume?: string;
  }>;
  status?: string;
  code?: number;
  message?: string;
}

/**
 * インジェスト結果
 */
export interface IngestResult {
  symbol: string;
  timeframe: string;
  fetchedCount: number;
  savedCount: number;
  skippedCount: number;
  error?: string;
}

/**
 * 全体のインジェスト結果
 */
export interface IngestSummary {
  startTime: Date;
  endTime: Date;
  totalSymbols: number;
  totalTimeframes: number;
  totalFetched: number;
  totalSaved: number;
  totalSkipped: number;
  errors: string[];
  results: IngestResult[];
}

/**
 * Twelve Data API から OHLCV データを取得
 *
 * @param symbol - シンボル（例: USDJPY）
 * @param interval - 時間足（例: 15min, 1h）
 * @param outputSize - 取得件数（デフォルト: 100）
 * @returns OHLCV データ配列
 */
async function fetchFromTwelveData(
  symbol: string,
  interval: string,
  outputSize: number = 100
): Promise<OHLCVData[]> {
  if (!TWELVE_DATA_API_KEY) {
    throw new Error('TWELVE_DATA_API_KEY が設定されていません');
  }

  const url = new URL(`${TWELVE_DATA_BASE_URL}/time_series`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('outputsize', String(outputSize));
  url.searchParams.set('apikey', TWELVE_DATA_API_KEY);

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`Twelve Data API エラー: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as TwelveDataTimeSeriesResponse;

  // エラーチェック
  if (data.status === 'error' || data.code) {
    throw new Error(`Twelve Data API エラー: ${data.message || 'Unknown error'}`);
  }

  if (!data.values || data.values.length === 0) {
    return [];
  }

  // OHLCVData 形式に変換
  return data.values.map((v) => ({
    timestamp: new Date(v.datetime),
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    volume: parseFloat(v.volume || '0'),
  }));
}

/**
 * 時間足をTwelve Data API形式に変換
 */
function convertTimeframe(timeframe: string): string {
  const map: Record<string, string> = {
    '1m': '1min',
    '5m': '5min',
    '15m': '15min',
    '30m': '30min',
    '1h': '1h',
    '4h': '4h',
    '1d': '1day',
  };
  return map[timeframe] || timeframe;
}

/**
 * 単一シンボル・時間足のOHLCVデータをインジェスト
 *
 * @param symbol - シンボル
 * @param timeframe - 時間足（内部形式: 15m, 1h など）
 * @param outputSize - 取得件数
 * @returns インジェスト結果
 */
export async function ingestOHLCV(
  symbol: string,
  timeframe: string,
  outputSize: number = 100
): Promise<IngestResult> {
  const result: IngestResult = {
    symbol,
    timeframe,
    fetchedCount: 0,
    savedCount: 0,
    skippedCount: 0,
  };

  try {
    // レート制限を適用してAPI呼び出し
    const apiInterval = convertTimeframe(timeframe);
    const ohlcvData = await limiter.schedule(() =>
      fetchFromTwelveData(symbol, apiInterval, outputSize)
    );

    result.fetchedCount = ohlcvData.length;

    if (ohlcvData.length === 0) {
      return result;
    }

    // 既存データとの重複をチェックしながら保存
    for (const candle of ohlcvData) {
      try {
        await prisma.oHLCVCandle.upsert({
          where: {
            symbol_timeframe_timestamp: {
              symbol,
              timeframe,
              timestamp: candle.timestamp,
            },
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
            source: 'twelvedata',
          },
          update: {
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
          },
        });
        result.savedCount++;
      } catch (err) {
        // 重複キーエラーなどはスキップ
        result.skippedCount++;
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : '不明なエラー';
    console.error(`[OHLCVIngest] ${symbol}/${timeframe} エラー:`, result.error);
  }

  return result;
}

/**
 * ウォッチリストの全シンボルをインジェスト
 *
 * @param outputSize - 各シンボルの取得件数（デフォルト: 100）
 * @returns インジェストサマリー
 */
export async function ingestAllWatchlist(outputSize: number = 100): Promise<IngestSummary> {
  const startTime = new Date();
  const summary: IngestSummary = {
    startTime,
    endTime: startTime,
    totalSymbols: 0,
    totalTimeframes: 0,
    totalFetched: 0,
    totalSaved: 0,
    totalSkipped: 0,
    errors: [],
    results: [],
  };

  try {
    // アクティブなウォッチリストを取得（重複除去）
    const watchlists = await prisma.watchlist.findMany({
      where: { active: true },
      select: {
        symbol: true,
        timeframes: true,
      },
    });

    // シンボル × 時間足の組み合わせを重複除去
    const symbolTimeframes = new Map<string, Set<string>>();
    for (const wl of watchlists) {
      if (!symbolTimeframes.has(wl.symbol)) {
        symbolTimeframes.set(wl.symbol, new Set());
      }
      const tfSet = symbolTimeframes.get(wl.symbol)!;
      for (const tf of wl.timeframes) {
        tfSet.add(tf);
      }
    }

    summary.totalSymbols = symbolTimeframes.size;

    // 全シンボル × 時間足をインジェスト
    for (const [symbol, timeframes] of symbolTimeframes) {
      for (const timeframe of timeframes) {
        summary.totalTimeframes++;

        console.log(`[OHLCVIngest] ${symbol}/${timeframe} 取得中...`);

        const result = await ingestOHLCV(symbol, timeframe, outputSize);
        summary.results.push(result);
        summary.totalFetched += result.fetchedCount;
        summary.totalSaved += result.savedCount;
        summary.totalSkipped += result.skippedCount;

        if (result.error) {
          summary.errors.push(`${symbol}/${timeframe}: ${result.error}`);
        } else {
          console.log(
            `[OHLCVIngest] ${symbol}/${timeframe} 完了: ` +
              `取得=${result.fetchedCount}, 保存=${result.savedCount}, スキップ=${result.skippedCount}`
          );
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '不明なエラー';
    summary.errors.push(`全体エラー: ${errorMessage}`);
    console.error('[OHLCVIngest] 全体エラー:', errorMessage);
  }

  summary.endTime = new Date();

  console.log('[OHLCVIngest] インジェスト完了:', {
    duration: `${(summary.endTime.getTime() - summary.startTime.getTime()) / 1000}秒`,
    symbols: summary.totalSymbols,
    timeframes: summary.totalTimeframes,
    fetched: summary.totalFetched,
    saved: summary.totalSaved,
    errors: summary.errors.length,
  });

  return summary;
}

/**
 * 古いOHLCVデータを削除（保持ポリシー）
 *
 * @param retentionDays - 保持日数（デフォルト: 180日）
 * @returns 削除件数
 */
export async function pruneOldData(retentionDays: number = 180): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await prisma.oHLCVCandle.deleteMany({
    where: {
      timestamp: {
        lt: cutoffDate,
      },
    },
  });

  console.log(`[OHLCVIngest] ${result.count}件の古いデータを削除（${retentionDays}日以前）`);

  return result.count;
}
