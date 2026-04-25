/**
 * OHLCVデータ取得・キャッシュサービス
 *
 * 目的:
 * - **cTrader Open API のみ**（ブローカーと同一の価格・足区切りを正とする）
 * - cTrader APIの時間範囲制限に対応した分割リクエスト
 * - 取得データをDBに永続化（upsert）
 * - 進捗コールバック対応（SSE配信用）
 */

import { PrismaClient } from '@prisma/client';
import { CTraderDataService } from './ctrader/ctraderDataService';
import { CTraderAuthService } from './ctrader/ctraderAuthService';

const prisma = new PrismaClient();
const ctraderAuthService = new CTraderAuthService(prisma);
const ctraderDataService = new CTraderDataService(ctraderAuthService);

/**
 * 期間外データを cTrader から補完取得できるか
 *（バックテスト・DSL 検証で、キャッシュ未充足時に API を呼ぶ判断に使う）
 */
export function isOhlcvRemoteFetchAvailable(): boolean {
  return ctraderDataService.isConfigured();
}

// ========================================
// 定数
// ========================================

/** cTrader 1リクエスト最大本数（上限） */
const MAX_BARS_PER_REQUEST = 5000;

// ========================================
// 型定義
// ========================================

export interface FetchAndCacheResult {
    success: boolean;
    cachedCount: number;
    error?: string;
    source?: 'ctrader';
    details?: {
        symbol: string;
        timeframe: string;
        startDate: string;
        endDate: string;
        fetchedCount: number;
        chunks: number;
    };
}

/** 進捗情報 */
export interface FetchProgress {
    /** 完了チャンク数 */
    current: number;
    /** 総チャンク数 */
    total: number;
    /** メッセージ */
    message: string;
    /** ソース名 */
    source: string;
    /** 進捗率(0-100) */
    percent: number;
}

/** 進捗コールバック型 */
export type OnProgressCallback = (progress: FetchProgress) => void;

// ========================================
// cTrader API 分割取得制限
// 制限の70%で分割（余裕をもたせる）
// ========================================

const CTRADER_MAX_TIMESPAN_MS: Record<string, number> = {
    '1m': 7 * 24 * 60 * 60 * 1000 * 0.7,       // 1週間 → 5日
    '5m': 35 * 24 * 60 * 60 * 1000 * 0.7,       // 5週間 → 24日
    '15m': 105 * 24 * 60 * 60 * 1000 * 0.7,      // 15週間 → 73日
    '30m': 210 * 24 * 60 * 60 * 1000 * 0.7,      // 30週間 → 147日
    '1h': 365 * 24 * 60 * 60 * 1000 * 0.7,      // 1年 → 255日
    '4h': 365 * 24 * 60 * 60 * 1000 * 0.7,      // 1年 → 255日
    '1d': 365 * 2 * 24 * 60 * 60 * 1000 * 0.7,  // 2年 → 511日
    '1w': 365 * 5 * 24 * 60 * 60 * 1000 * 0.7,  // 5年 → 3.5年
};

// ========================================
// 分割ユーティリティ
// ========================================

interface DateChunk {
    start: Date;
    end: Date;
}

/**
 * 期間を指定された最大タイムスパンで分割
 */
function splitDateRange(startDate: Date, endDate: Date, maxTimespanMs: number): DateChunk[] {
    const chunks: DateChunk[] = [];
    let current = startDate.getTime();
    const endMs = endDate.getTime();

    while (current < endMs) {
        const chunkEnd = Math.min(current + maxTimespanMs, endMs);
        chunks.push({
            start: new Date(current),
            end: new Date(chunkEnd),
        });
        current = chunkEnd;
    }

    return chunks;
}

// ========================================
// メイン関数
// ========================================

/**
 * OHLCVデータを cTrader API から取得してDBにキャッシュ
 *
 * @param symbol - シンボル（例: 'XAUUSD'）
 * @param timeframe - 時間足（例: '1h'）
 * @param startDate - 取得開始日
 * @param endDate - 取得終了日
 * @param onProgress - 進捗コールバック（SSE配信用）
 */
export async function fetchAndCacheOhlcv(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date,
    onProgress?: OnProgressCallback
): Promise<FetchAndCacheResult> {
    try {
        if (!ctraderDataService.isConfigured()) {
            return {
                success: false,
                cachedCount: 0,
                error: 'cTrader API が未設定です。.env の CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET を確認してください。',
            };
        }

        const ctraderResult = await fetchFromCTrader(symbol, timeframe, startDate, endDate, onProgress);
        if (ctraderResult.success) {
            await updateDataPresetMetadata(symbol, timeframe);
            return ctraderResult;
        }

        return {
            success: false,
            cachedCount: 0,
            error: ctraderResult.error ?? 'cTrader から OHLCV を取得できませんでした（接続・トークン・シンボル名を確認）',
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '不明なエラー';
        console.error(`[fetchAndCacheOhlcv] エラー:`, error);
        return {
            success: false,
            cachedCount: 0,
            error: `データ取得エラー: ${errorMessage}`,
        };
    }
}

// ========================================
// cTrader API 分割取得
// ========================================

async function fetchFromCTrader(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date,
    onProgress?: OnProgressCallback
): Promise<FetchAndCacheResult> {
    try {
        // cTraderアカウントID取得
        const ctraderToken = await prisma.cTraderToken.findFirst({
            orderBy: { lastConnectedAt: 'desc' },
        });

        if (!ctraderToken) {
            return { success: false, cachedCount: 0, error: 'cTraderアカウント未登録' };
        }

        // 分割サイズを決定（cTraderの最大期間制限 + 1リクエスト最大本数(5000) の両方を満たす）
        const maxTimespanMsByApi = CTRADER_MAX_TIMESPAN_MS[timeframe];
        if (!maxTimespanMsByApi) {
            return { success: false, cachedCount: 0, error: `cTrader: 未対応の時間足 ${timeframe}` };
        }

        const intervalMinutes = getIntervalMinutes(timeframe);
        // 5000本上限から逆算した最大期間（少し余裕を持たせる）
        const maxTimespanMsByBars = Math.floor(
            MAX_BARS_PER_REQUEST * intervalMinutes * 60 * 1000 * 0.98
        );
        const effectiveMaxTimespanMs = Math.min(maxTimespanMsByApi, maxTimespanMsByBars);
        if (effectiveMaxTimespanMs <= 0) {
            return { success: false, cachedCount: 0, error: `cTrader: チャンクサイズ計算に失敗しました (${symbol}/${timeframe})` };
        }

        // 期間を分割
        const chunks = splitDateRange(startDate, endDate, effectiveMaxTimespanMs);
        console.log(
            `[fetchFromCTrader] ${symbol}/${timeframe}: ${chunks.length}チャンクに分割 ` +
            `(${startDate.toISOString()} ~ ${endDate.toISOString()})`
        );

        const allData: Array<{
            timestamp: Date; open: number; high: number;
            low: number; close: number; volume: number;
        }> = [];

        // チャンクごとに取得
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            // 進捗通知
            onProgress?.({
                current: i,
                total: chunks.length,
                message: `cTrader API: チャンク ${i + 1}/${chunks.length} 取得中...`,
                source: 'ctrader',
                percent: Math.round((i / chunks.length) * 100),
            });

            // 期待バー数を計算
            const chunkDiffMs = chunk.end.getTime() - chunk.start.getTime();
            const expectedBars = Math.ceil(chunkDiffMs / (intervalMinutes * 60 * 1000));

            try {
                const bars = await ctraderDataService.fetchTrendbarsInRange(
                    ctraderToken.accountId,
                    symbol,
                    timeframe,
                    chunk.start,
                    chunk.end,
                    Math.min(expectedBars + 50, MAX_BARS_PER_REQUEST)
                );

                // 期間内のデータのみフィルタ
                const filtered = bars.filter(
                    bar => bar.timestamp >= chunk.start && bar.timestamp <= chunk.end
                );
                allData.push(...filtered);

                console.log(
                    `[fetchFromCTrader] チャンク ${i + 1}/${chunks.length}: ${filtered.length}件取得`
                );
            } catch (chunkError) {
                console.warn(
                    `[fetchFromCTrader] チャンク ${i + 1} エラー:`,
                    chunkError instanceof Error ? chunkError.message : chunkError
                );
                // 個別チャンクのエラーは続行
            }

            // cTrader APIへの間隔を空ける（1秒）
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        if (allData.length === 0) {
            return {
                success: false,
                cachedCount: 0,
                error: `cTrader: ${symbol}/${timeframe} のデータが取得できませんでした`,
            };
        }

        // DBに保存
        onProgress?.({
            current: chunks.length,
            total: chunks.length,
            message: `DBに保存中... (${allData.length}件)`,
            source: 'ctrader',
            percent: 90,
        });

        const cachedCount = await batchUpsertOhlcv(symbol, timeframe, allData);

        // 保存検証: DBから実データを取得できるか確認
        const minTs = allData.reduce((a, d) => (d.timestamp < a ? d.timestamp : a), allData[0].timestamp);
        const maxTs = allData.reduce((a, d) => (d.timestamp > a ? d.timestamp : a), allData[0].timestamp);
        const verification = await verifyOhlcvSaved(symbol, timeframe, cachedCount, minTs, maxTs);
        if (!verification.verified) {
            return {
                success: false,
                cachedCount: 0,
                error: `cTrader: 保存後の検証失敗（取得${verification.fetchedCount}件）`,
            };
        }

        // 完了通知
        onProgress?.({
            current: chunks.length,
            total: chunks.length,
            message: `完了: ${cachedCount}件キャッシュ`,
            source: 'ctrader',
            percent: 100,
        });

        return {
            success: true,
            cachedCount,
            source: 'ctrader',
            details: {
                symbol,
                timeframe,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                fetchedCount: allData.length,
                chunks: chunks.length,
            },
        };

    } catch (error) {
        const msg = error instanceof Error ? error.message : '不明なエラー';
        return { success: false, cachedCount: 0, error: `cTrader エラー: ${msg}` };
    }
}

// ========================================
// DB バッチ保存
// ========================================

/**
 * 並列数（1=直列、5=5本並列など）
 * 環境変数 UPSERT_PARALLEL_SIZE で上書き可能（検証用）
 *
 * 検証結果: ローカルで 100 並列まで成功。本番では 100 で接続枯渇。15 で安定運用。
 */
function getUpsertParallelSize(): number {
    const v = process.env.UPSERT_PARALLEL_SIZE;
    if (v !== undefined) {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= 1) return n;
    }
    return 15; // 本番運用: 5000本で約10秒想定
}

async function batchUpsertOhlcv(
    symbol: string,
    timeframe: string,
    data: Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }>
): Promise<number> {
    const parallelSize = getUpsertParallelSize();
    let cachedCount = 0;

    if (parallelSize <= 1) {
        // 直列: 1本ずつ保存（接続数最小）
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
            cachedCount++;
        }
    } else {
        // 並列: parallelSize 本ずつ
        for (let i = 0; i < data.length; i += parallelSize) {
            const batch = data.slice(i, i + parallelSize);
            await Promise.all(
                batch.map(candle =>
                    prisma.oHLCVCandle.upsert({
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
                    })
                )
            );
            cachedCount += batch.length;
        }
    }

    console.log(`[batchUpsertOhlcv] ${cachedCount}件保存完了: ${symbol}/${timeframe} (並列数=${parallelSize})`);
    return cachedCount;
}

/**
 * DBに保存した実データを取得できるか検証
 * 保存後に呼び出し、実際にSELECTして確認する
 */
async function verifyOhlcvSaved(
    symbol: string,
    timeframe: string,
    savedCount: number,
    minTimestamp: Date,
    maxTimestamp: Date
): Promise<{ verified: boolean; fetchedCount: number; error?: string }> {
    try {
        const fetched = await prisma.oHLCVCandle.findMany({
            where: {
                symbol,
                timeframe,
                timestamp: {
                    gte: minTimestamp,
                    lte: maxTimestamp,
                },
            },
            orderBy: { timestamp: 'asc' },
        });

        const fetchedCount = fetched.length;
        const verified = fetchedCount > 0 && fetchedCount >= Math.min(savedCount, 1);

        if (verified) {
            console.log(
                `[verifyOhlcvSaved] ✅ 検証OK: ${symbol}/${timeframe} 保存${savedCount}件→取得${fetchedCount}件 ` +
                `(サンプル: ${fetched[0]?.timestamp.toISOString()} O=${fetched[0]?.open} C=${fetched[0]?.close})`
            );
        } else {
            console.warn(
                `[verifyOhlcvSaved] ⚠ 検証NG: ${symbol}/${timeframe} 保存${savedCount}件 に対し 取得${fetchedCount}件`
            );
        }

        return { verified, fetchedCount };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[verifyOhlcvSaved] 検証エラー:`, msg);
        return { verified: false, fetchedCount: 0, error: msg };
    }
}

// ========================================
// ユーティリティ
// ========================================

/**
 * DataPresetのメタデータを更新
 */
async function updateDataPresetMetadata(symbol: string, timeframe: string): Promise<void> {
    try {
        const stats = await prisma.oHLCVCandle.aggregate({
            where: { symbol, timeframe },
            _count: { _all: true },
            _min: { timestamp: true },
            _max: { timestamp: true },
        });

        if (stats._count._all > 0 && stats._min.timestamp && stats._max.timestamp) {
            await prisma.dataPreset.upsert({
                where: {
                    symbol_timeframe: { symbol, timeframe },
                },
                update: {
                    startDate: stats._min.timestamp,
                    endDate: stats._max.timestamp,
                    recordCount: stats._count._all,
                    updatedAt: new Date(),
                },
                create: {
                    symbol,
                    timeframe,
                    startDate: stats._min.timestamp,
                    endDate: stats._max.timestamp,
                    recordCount: stats._count._all,
                },
            });
        }
    } catch (error) {
        console.warn(`[updateDataPresetMetadata] 更新失敗:`, error);
    }
}

/**
 * 時間足を分に変換
 */
function getIntervalMinutes(timeframe: string): number {
    const map: Record<string, number> = {
        '1m': 1,
        '5m': 5,
        '15m': 15,
        '30m': 30,
        '1h': 60,
        '4h': 240,
        '1d': 1440,
    };
    return map[timeframe] || 60;
}
