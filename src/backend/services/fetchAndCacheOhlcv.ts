/**
 * OHLCVデータ取得・キャッシュサービス
 * 
 * 目的:
 * - Twelve Data APIから不足分のOHLCVデータを取得
 * - 取得データをDBに永続化
 * - Rate Limit対応（8リクエスト/分）
 */

import { PrismaClient } from '@prisma/client';
import { MarketDataService } from '../../services/marketDataService';

const prisma = new PrismaClient();
const marketDataService = new MarketDataService();

// Rate Limit: 8リクエスト/分 = 最低7.5秒間隔
const MIN_REQUEST_INTERVAL_MS = 8000;
let lastApiRequestTime = 0;

/**
 * Rate Limit待機
 */
async function waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - lastApiRequestTime;

    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
        const waitTime = MIN_REQUEST_INTERVAL_MS - elapsed;
        console.log(`[fetchAndCacheOhlcv] Rate Limit待機: ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    lastApiRequestTime = Date.now();
}

/**
 * OHLCVデータをAPIから取得してDBにキャッシュ
 */
export interface FetchAndCacheResult {
    success: boolean;
    cachedCount: number;
    error?: string;
    details?: {
        symbol: string;
        timeframe: string;
        startDate: string;
        endDate: string;
        fetchedCount: number;
    };
}

export async function fetchAndCacheOhlcv(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date
): Promise<FetchAndCacheResult> {
    try {
        // API設定確認
        if (!marketDataService.isApiConfigured()) {
            return {
                success: false,
                cachedCount: 0,
                error: 'Twelve Data APIが設定されていません。環境変数 TWELVE_DATA_API_KEY を設定してください。',
            };
        }

        // Rate Limit待機
        await waitForRateLimit();

        // 期待バー数を計算
        const intervalMinutes = getIntervalMinutes(timeframe);
        const diffMs = endDate.getTime() - startDate.getTime();
        const expectedCandles = Math.ceil(diffMs / (intervalMinutes * 60 * 1000));

        console.log(
            `[fetchAndCacheOhlcv] APIからデータ取得開始: ${symbol}/${timeframe}, ` +
            `期間: ${startDate.toISOString()} - ${endDate.toISOString()}, ` +
            `期待バー数: ${expectedCandles}`
        );

        // APIからデータ取得（最大5000件ずつ分割）
        const MAX_BARS_PER_REQUEST = 5000;
        const allData: Array<{
            timestamp: Date;
            open: number;
            high: number;
            low: number;
            close: number;
            volume: number;
        }> = [];

        // 期間が長い場合は分割取得
        if (expectedCandles > MAX_BARS_PER_REQUEST) {
            // 複数回に分けて取得
            const chunks = Math.ceil(expectedCandles / MAX_BARS_PER_REQUEST);
            const chunkDurationMs = diffMs / chunks;

            for (let i = 0; i < chunks; i++) {
                if (i > 0) {
                    await waitForRateLimit(); // 2回目以降はRate Limit待機
                }

                const chunkStart = new Date(startDate.getTime() + i * chunkDurationMs);
                const chunkEnd = new Date(Math.min(startDate.getTime() + (i + 1) * chunkDurationMs, endDate.getTime()));

                console.log(`[fetchAndCacheOhlcv] チャンク ${i + 1}/${chunks} 取得中...`);

                const chunkData = await marketDataService.getHistoricalData(
                    symbol,
                    timeframe,
                    MAX_BARS_PER_REQUEST
                );

                // 期間内のデータのみフィルタ
                const filteredData = chunkData.filter(
                    bar => bar.timestamp >= chunkStart && bar.timestamp <= chunkEnd
                );
                allData.push(...filteredData);
            }
        } else {
            // 一度に取得
            const apiData = await marketDataService.getHistoricalData(
                symbol,
                timeframe,
                expectedCandles + 50 // バッファ
            );

            // 期間内のデータのみフィルタ
            const filteredData = apiData.filter(
                bar => bar.timestamp >= startDate && bar.timestamp <= endDate
            );
            allData.push(...filteredData);
        }

        if (allData.length === 0) {
            return {
                success: false,
                cachedCount: 0,
                error: `指定期間のデータが取得できませんでした: ${symbol}/${timeframe}`,
            };
        }

        console.log(`[fetchAndCacheOhlcv] ${allData.length}件のデータを取得、DBに保存中...`);

        // DBにupsert（バッチ処理で高速化）
        let cachedCount = 0;
        const BATCH_SIZE = 100;

        for (let i = 0; i < allData.length; i += BATCH_SIZE) {
            const batch = allData.slice(i, i + BATCH_SIZE);

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

        console.log(`[fetchAndCacheOhlcv] ${cachedCount}件のデータをDBに保存完了`);

        // DataPresetメタデータも更新（あれば）
        await updateDataPresetMetadata(symbol, timeframe);

        return {
            success: true,
            cachedCount,
            details: {
                symbol,
                timeframe,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                fetchedCount: allData.length,
            },
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '不明なエラー';
        console.error(`[fetchAndCacheOhlcv] エラー:`, error);

        // Rate Limitエラーの判定
        if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
            return {
                success: false,
                cachedCount: 0,
                error: 'API Rate Limitに達しました。しばらく待ってから再試行してください。',
            };
        }

        // その他のAPIエラー
        if (errorMessage.includes('401') || errorMessage.includes('403')) {
            return {
                success: false,
                cachedCount: 0,
                error: 'APIキーが無効または期限切れです。設定を確認してください。',
            };
        }

        return {
            success: false,
            cachedCount: 0,
            error: `データ取得エラー: ${errorMessage}`,
        };
    }
}

/**
 * DataPresetのメタデータを更新
 */
async function updateDataPresetMetadata(symbol: string, timeframe: string): Promise<void> {
    try {
        // 現在のデータ範囲とカウントを取得
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
        // メタデータ更新失敗は警告のみ
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
