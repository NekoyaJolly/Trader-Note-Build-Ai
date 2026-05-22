/**
 * OHLCV インジェストサービス (Phase B、2026-05-22 EODHD 切替)
 *
 * 日次でウォッチリストのシンボルの OHLCV データを取得し、DB に蓄積する。
 *
 * - Watchlist モデルからアクティブなシンボル一覧を取得
 * - EODHD All-In-One API から OHLCV データを取得 (旧 Twelve Data 経路を廃止)
 * - OHLCVCandle テーブルに保存
 * - レート制限対策 (bottleneck): EODHD All-In-One = 1,000 req/min なので Twelve Data 時代より緩和
 *
 * Timeframe マッピング:
 * - 1m / 5m / 1h: EODHD intraday API ネイティブ
 * - 15m / 30m / 4h: EODHD intraday (5m or 1h) を取得後にクライアント側で集約
 *   (詳細は `src/infrastructure/market/ohlcvAggregation.ts`)
 * - 1d / 1w: EODHD eod API (period=d/w)
 */

import Bottleneck from 'bottleneck';
import { prisma } from '../db/client';
import { EodhdProvider } from '../../infrastructure/market/EodhdProvider';
import { TimeframeSchema, type Timeframe } from '../../infrastructure/market/IMarketDataProvider';

/**
 * EODHD All-In-One のレート制限: 1,000 req/分。
 * 安全マージン込みで 500 req/分 (= 8.3 req/秒) に設定。
 * Watchlist スキャンは Symbol × Timeframe の組合せ数で逐次回るため、
 * 並列度 1・最小間隔 120ms で安定運用する。
 */
const limiter = new Bottleneck({
  reservoir: 500,
  reservoirRefreshAmount: 500,
  reservoirRefreshInterval: 60 * 1000,
  maxConcurrent: 1,
  minTime: 120,
});

// EODHD Provider のシングルトン (config 経由で APIキー / baseUrl を解決)
const eodhdProvider = new EodhdProvider();

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
 * EODHD から OHLCV データを取得 (Phase B、旧 fetchFromTwelveData の置換)
 *
 * Provider 層で内部 Timeframe → EODHD interval / period のマッピングと
 * 15m / 30m / 4h の集約を一括処理するため、本サービスは Provider に渡すだけ。
 */
async function fetchFromEodhd(
  symbol: string,
  timeframe: Timeframe,
  outputSize: number,
): Promise<OHLCVData[]> {
  const result = await eodhdProvider.getHistoricalData(symbol, timeframe, outputSize);
  return result.bars.map((b) => ({
    timestamp: b.timestamp,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

/**
 * 単一シンボル・時間足の OHLCV データをインジェスト
 *
 * @param symbol - シンボル (例: 'XAU/USD' または 'XAUUSD' どちらでも EodhdProvider が正規化する)
 * @param timeframe - 時間足 (内部形式: 1m / 5m / 15m / 30m / 1h / 4h / 1d / 1w)
 * @param outputSize - 取得件数
 * @returns インジェスト結果
 */
export async function ingestOHLCV(
  symbol: string,
  timeframe: string,
  outputSize: number = 100,
): Promise<IngestResult> {
  const result: IngestResult = {
    symbol,
    timeframe,
    fetchedCount: 0,
    savedCount: 0,
    skippedCount: 0,
  };

  // Zod で内部 Timeframe に narrow (EODHD 非対応の文字列を早期に弾く)
  const parsedTf = TimeframeSchema.safeParse(timeframe);
  if (!parsedTf.success) {
    result.error = `未対応の時間足: ${timeframe} (Timeframe enum 外)`;
    console.error(`[OHLCVIngest] ${symbol}/${timeframe} エラー:`, result.error);
    return result;
  }

  try {
    // レート制限を適用して API 呼び出し
    const ohlcvData = await limiter.schedule(() =>
      fetchFromEodhd(symbol, parsedTf.data, outputSize),
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
            source: 'eodhd',
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
      } catch {
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
