/**
 * cTrader データ取得サービス
 *
 * 目的: cTrader Open API (ProtoOAGetTrendbarsReq) で OHLCV ヒストリカルデータを取得
 *
 * 設計:
 * - @reiryoku/ctrader-layer の sendCommand() で Protobuf 処理を代行
 * - 認証フローは CTraderAuthService を再利用
 * - symbolId はキャッシュ付きで動的解決
 * - 相対値（low + delta）から絶対価格に変換
 *
 * 参照: https://help.ctrader.com/open-api/
 */

import { config } from '../../../config';
import { CTraderAuthService } from './ctraderAuthService';
import { CTraderConnectionType } from './types/connection';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CTraderConnection } = require('@reiryoku/ctrader-layer');

// ========================================
// 型定義
// ========================================

/**
 * cTrader Trendbar 期間（ProtoOATrendbarPeriod）
 */
export const CTraderTrendbarPeriod = {
    M1: 1,
    M2: 2,
    M3: 3,
    M4: 4,
    M5: 5,
    M10: 6,
    M15: 7,
    M30: 8,
    H1: 9,
    H4: 10,
    H12: 11,
    D1: 12,
    W1: 13,
    MN1: 14,
} as const;

export type CTraderPeriod = typeof CTraderTrendbarPeriod[keyof typeof CTraderTrendbarPeriod];

/**
 * 内部時間足 → cTrader 期間
 */
const TIMEFRAME_TO_PERIOD: Record<string, CTraderPeriod> = {
    '1m': CTraderTrendbarPeriod.M1,
    '5m': CTraderTrendbarPeriod.M5,
    '15m': CTraderTrendbarPeriod.M15,
    '30m': CTraderTrendbarPeriod.M30,
    /** アプリ層の 60m 表記。 cTrader トレンドバーは 1h（H1）に対応 */
    '60m': CTraderTrendbarPeriod.H1,
    '1h': CTraderTrendbarPeriod.H1,
    '4h': CTraderTrendbarPeriod.H4,
    '1d': CTraderTrendbarPeriod.D1,
    '1w': CTraderTrendbarPeriod.W1,
};

/**
 * 期間ごとの最大取得範囲（ミリ秒）
 * cTrader APIの制約に基づく
 */
const MAX_TIMESPAN_MS: Record<CTraderPeriod, number> = {
    [CTraderTrendbarPeriod.M1]: 7 * 24 * 60 * 60 * 1000,       // 1週間
    [CTraderTrendbarPeriod.M2]: 14 * 24 * 60 * 60 * 1000,      // 2週間
    [CTraderTrendbarPeriod.M3]: 21 * 24 * 60 * 60 * 1000,      // 3週間
    [CTraderTrendbarPeriod.M4]: 28 * 24 * 60 * 60 * 1000,      // 4週間
    [CTraderTrendbarPeriod.M5]: 35 * 24 * 60 * 60 * 1000,      // 5週間
    [CTraderTrendbarPeriod.M10]: 70 * 24 * 60 * 60 * 1000,     // 10週間
    [CTraderTrendbarPeriod.M15]: 105 * 24 * 60 * 60 * 1000,    // 15週間
    [CTraderTrendbarPeriod.M30]: 210 * 24 * 60 * 60 * 1000,    // 30週間
    [CTraderTrendbarPeriod.H1]: 365 * 24 * 60 * 60 * 1000,     // 1年
    [CTraderTrendbarPeriod.H4]: 365 * 24 * 60 * 60 * 1000,     // 1年
    [CTraderTrendbarPeriod.H12]: 365 * 24 * 60 * 60 * 1000,    // 1年
    [CTraderTrendbarPeriod.D1]: 365 * 2 * 24 * 60 * 60 * 1000, // 2年
    [CTraderTrendbarPeriod.W1]: 365 * 5 * 24 * 60 * 60 * 1000, // 5年
    [CTraderTrendbarPeriod.MN1]: 365 * 10 * 24 * 60 * 60 * 1000, // 10年
};

/**
 * cTrader Trendbar レスポンス（生データ）
 */
export interface CTraderTrendbar {
    /** ミリ秒タイムスタンプ（UTC） */
    utcTimestampInMinutes?: number;
    timestamp?: number;
    /** 安値（100000倍の整数） */
    low: number;
    /** open の delta（low からの差分） */
    deltaOpen: number;
    /** close の delta */
    deltaClose: number;
    /** high の delta */
    deltaHigh: number;
    /** Tick出来高 */
    volume?: number;
}

/**
 * 変換後の OHLCV バー
 */
export interface OHLCVBarResult {
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

/**
 * シンボル情報（キャッシュ用）
 */
interface SymbolInfo {
    symbolId: number;
    symbolName: string;
    digits: number;
    /** 1ロットあたりの通貨数（cTrader: lotSize） */
    contractSize: number;
}

// ========================================
// CTraderDataService
// ========================================

export class CTraderDataService {
    private authService: CTraderAuthService;
    private symbolCache: Map<string, SymbolInfo> = new Map();
    private symbolListCache: Map<string, SymbolInfo[]> = new Map();

    constructor(authService: CTraderAuthService) {
        this.authService = authService;
    }

    /**
     * 利用可能なシンボル一覧を取得
     * cTrader APIの ProtoOASymbolsListReq を使用
     */
    async getAvailableSymbols(accountId: string): Promise<{ symbolName: string; symbolId: number }[]> {
        const connection = await this.connectAndAuth(accountId);

        const cacheKey = accountId;
        let symbolList = this.symbolListCache.get(cacheKey);

        if (!symbolList) {
            console.log('[cTraderData] シンボルリスト取得中...');
            const response = await connection.sendCommand('ProtoOASymbolsListReq', {
                ctidTraderAccountId: parseInt(accountId, 10),
                includeArchivedSymbols: false,
            });

            const rawResponse = response as { symbol?: Array<{ symbolId: number; symbolName: string; digits?: number; lotSize?: number }> };
            const symbols = rawResponse?.symbol || [];

            symbolList = symbols.map(s => ({
                symbolId: s.symbolId,
                symbolName: s.symbolName,
                digits: s.digits ?? 5,
                // lotSize がない場合のフォールバック（FXの一般的な contractSize）
                contractSize: s.lotSize ?? 100000,
            }));

            this.symbolListCache.set(cacheKey, symbolList);
            console.log(`[cTraderData] ${symbolList.length}シンボルをキャッシュ`);
        }

        return symbolList.map(s => ({
            symbolName: s.symbolName,
            symbolId: s.symbolId,
        }));
    }

    /**
     * シンボルの digits（小数桁数）を取得
     * digits から pipValue を導出可能: pipValue = 10^-(digits-1)
     *
     * @param accountId - cTrader アカウントID
     * @param symbol - シンボル名 (例: 'USDJPY', 'EURUSD')
     * @returns digits（取得できない場合は null）
     */
    async getSymbolDigits(accountId: string, symbol: string): Promise<number | null> {
        try {
            const connection = await this.connectAndAuth(accountId);
            const symbolInfo = await this.resolveSymbolId(connection, accountId, symbol);
            return symbolInfo.digits;
        } catch (error) {
            console.warn(`[cTraderData] digits 取得失敗: ${symbol}`, error);
            return null;
        }
    }

    /**
     * シンボルの ContractSize（1ロットあたりの通貨数）を取得
     * 
     * 注意:
     * - cTrader の SymbolsList では lotSize として返ることが多い
     * - 取得できない場合は null（呼び出し側でフォールバックする）
     */
    async getSymbolContractSize(accountId: string, symbol: string): Promise<number | null> {
        try {
            const connection = await this.connectAndAuth(accountId);
            const symbolInfo = await this.resolveSymbolId(connection, accountId, symbol);
            return symbolInfo.contractSize;
        } catch (error) {
            console.warn(`[cTraderData] contractSize 取得失敗: ${symbol}`, error);
            return null;
        }
    }

    /**
     * OHLCV ヒストリカルデータを取得
     *
     * @param accountId - cTrader アカウントID
     * @param symbol - シンボル（例: 'XAU/USD', 'XAUUSD'）
     * @param timeframe - 時間足（例: '15m', '4h', '1d'）
     * @param count - 取得本数（デフォルト: 100）
     * @returns OHLCV バー配列（時系列順: 古い→新しい）
     */
    async fetchTrendbars(
        accountId: string,
        symbol: string,
        timeframe: string,
        count: number = 100,
    ): Promise<OHLCVBarResult[]> {
        const period = TIMEFRAME_TO_PERIOD[timeframe];
        if (period === undefined) {
            throw new Error(`[cTraderData] 未対応の時間足: ${timeframe}`);
        }

        let connection: CTraderConnectionType | null = null;

        try {
            // 1. 接続 & 認証
            connection = await this.connectAndAuth(accountId);

            // 2. シンボルID解決
            const symbolInfo = await this.resolveSymbolId(connection, accountId, symbol);
            console.log(`[cTraderData] シンボル解決: ${symbol} → ID=${symbolInfo.symbolId}, digits=${symbolInfo.digits}`);

            // 3. 時間範囲を計算
            const now = Date.now();
            const maxTimespan = MAX_TIMESPAN_MS[period];
            const fromTimestamp = now - Math.min(maxTimespan, this.estimateRequiredTimespan(period, count));
            const toTimestamp = now;

            // 4. ProtoOAGetTrendbarsReq 送信
            console.log(`[cTraderData] Trendbar取得: ${symbol} ${timeframe} count=${count}`);
            const response = await connection.sendCommand('ProtoOAGetTrendbarsReq', {
                ctidTraderAccountId: parseInt(accountId, 10),
                symbolId: symbolInfo.symbolId,
                period,
                fromTimestamp,
                toTimestamp,
                count,
            });

            // 5. レスポンスをパース・変換
            const rawResponse = response as { trendbar?: CTraderTrendbar[] };
            const trendbars = rawResponse?.trendbar || [];

            if (trendbars.length === 0) {
                console.warn(`[cTraderData] Trendbarが空: ${symbol} ${timeframe}`);
                return [];
            }

            // 6. 相対値→絶対価格に変換
            const bars = this.convertTrendbars(trendbars, symbolInfo.digits);
            console.log(`[cTraderData] ${bars.length}本のOHLCVを取得: ${symbol} ${timeframe}`);

            return bars;

        } finally {
            if (connection) {
                try { await connection.close(); } catch { /* ignore */ }
            }
        }
    }

    /**
     * OHLCV ヒストリカルデータを「指定期間」で取得
     *
     * 重要: cTrader API は period ごとに取得可能な最大期間があるため、
     * 呼び出し元で事前にチャンク分割してから使用すること。
     *
     * @param accountId - cTrader アカウントID
     * @param symbol - シンボル（例: 'XAU/USD', 'XAUUSD'）
     * @param timeframe - 時間足（例: '15m', '4h', '1d'）
     * @param from - 取得開始（UTC）
     * @param to - 取得終了（UTC）
     * @param count - 取得本数上限（API上限: 5000）
     * @returns OHLCV バー配列（時系列順: 古い→新しい）
     */
    async fetchTrendbarsInRange(
        accountId: string,
        symbol: string,
        timeframe: string,
        from: Date,
        to: Date,
        count: number = 5000,
    ): Promise<OHLCVBarResult[]> {
        const period = TIMEFRAME_TO_PERIOD[timeframe];
        if (period === undefined) {
            throw new Error(`[cTraderData] 未対応の時間足: ${timeframe}`);
        }

        const fromTimestamp = from.getTime();
        const toTimestamp = to.getTime();
        if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp)) {
            throw new Error('[cTraderData] from/to が不正です（Date変換に失敗）');
        }
        if (toTimestamp <= fromTimestamp) {
            throw new Error('[cTraderData] to は from より後の日時を指定してください');
        }

        const maxTimespan = MAX_TIMESPAN_MS[period];
        if (toTimestamp - fromTimestamp > maxTimespan) {
            throw new Error(
                `[cTraderData] 取得期間が上限を超過: ${timeframe} は最大${Math.round(maxTimespan / (24 * 60 * 60 * 1000))}日まで（指定=${Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60 * 1000))}日）`
            );
        }

        let connection: CTraderConnectionType | null = null;

        try {
            // 1. 接続 & 認証
            connection = await this.connectAndAuth(accountId);

            // 2. シンボルID解決
            const symbolInfo = await this.resolveSymbolId(connection, accountId, symbol);
            console.log(`[cTraderData] シンボル解決: ${symbol} → ID=${symbolInfo.symbolId}, digits=${symbolInfo.digits}`);

            // 3. ProtoOAGetTrendbarsReq 送信（指定期間）
            const safeCount = Math.min(Math.max(Math.trunc(count), 1), 5000);
            console.log(
                `[cTraderData] Trendbar取得(期間指定): ${symbol} ${timeframe} count=${safeCount} ` +
                `from=${new Date(fromTimestamp).toISOString()} to=${new Date(toTimestamp).toISOString()}`
            );

            const response = await connection.sendCommand('ProtoOAGetTrendbarsReq', {
                ctidTraderAccountId: parseInt(accountId, 10),
                symbolId: symbolInfo.symbolId,
                period,
                fromTimestamp,
                toTimestamp,
                count: safeCount,
            });

            // 4. レスポンスをパース・変換
            const rawResponse = response as { trendbar?: CTraderTrendbar[] };
            const trendbars = rawResponse?.trendbar || [];

            if (trendbars.length === 0) {
                console.warn(`[cTraderData] Trendbarが空: ${symbol} ${timeframe} (期間指定)`);
                return [];
            }

            // 5. 相対値→絶対価格に変換
            const bars = this.convertTrendbars(trendbars, symbolInfo.digits);
            console.log(`[cTraderData] ${bars.length}本のOHLCVを取得(期間指定): ${symbol} ${timeframe}`);

            return bars;
        } finally {
            if (connection) {
                try { await connection.close(); } catch { /* ignore */ }
            }
        }
    }

    /**
     * 利用可能か確認
     */
    isConfigured(): boolean {
        return !!(config.ctrader.clientId && config.ctrader.clientSecret);
    }

    // ========================================
    // 内部メソッド
    // ========================================

    /**
     * WebSocket接続 & 認証（Live優先、Demo フォールバック）
     */
    private async connectAndAuth(accountId: string): Promise<CTraderConnectionType> {
        const accessToken = await this.authService.getValidAccessToken(accountId);

        // Live環境で接続
        const environments = [
            { host: config.ctrader.wsLiveHost, label: 'Live' },
            { host: config.ctrader.wsDemoHost, label: 'Demo' },
        ];

        let lastError: Error | null = null;

        for (const env of environments) {
            try {
                const connection = new CTraderConnection({
                    host: env.host,
                    port: config.ctrader.wsPort,
                }) as CTraderConnectionType;

                await connection.open();

                // アプリケーション認証
                await connection.sendCommand('ProtoOAApplicationAuthReq', {
                    clientId: config.ctrader.clientId,
                    clientSecret: config.ctrader.clientSecret,
                });

                // アカウント認証
                await connection.sendCommand('ProtoOAAccountAuthReq', {
                    ctidTraderAccountId: parseInt(accountId, 10),
                    accessToken,
                });

                console.log(`[cTraderData] ${env.label}環境で接続・認証成功`);
                return connection;

            } catch (error) {
                const errorMsg = error instanceof Error
                    ? error.message
                    : typeof error === 'string'
                        ? error
                        : JSON.stringify(error);
                lastError = error instanceof Error ? error : new Error(errorMsg);
                console.warn(`[cTraderData] ${env.label}環境で接続失敗:`, errorMsg);
            }
        }

        throw lastError || new Error('[cTraderData] 接続に失敗しました');
    }

    /**
     * シンボル名→symbolId 解決（キャッシュ付き）
     */
    private async resolveSymbolId(
        connection: CTraderConnectionType,
        accountId: string,
        symbol: string,
    ): Promise<SymbolInfo> {
        // 正規化
        const normalizedSymbol = symbol.replace('/', '');

        // キャッシュ確認
        const cached = this.symbolCache.get(normalizedSymbol);
        if (cached) return cached;

        // キャッシュにない場合、シンボルリストを取得
        const cacheKey = accountId;
        let symbolList = this.symbolListCache.get(cacheKey);

        if (!symbolList) {
            console.log('[cTraderData] シンボルリスト取得中...');
            const response = await connection.sendCommand('ProtoOASymbolsListReq', {
                ctidTraderAccountId: parseInt(accountId, 10),
                includeArchivedSymbols: false,
            });

            const rawResponse = response as { symbol?: Array<{ symbolId: number; symbolName: string; digits?: number; lotSize?: number }> };
            const symbols = rawResponse?.symbol || [];

            symbolList = symbols.map(s => ({
                symbolId: s.symbolId,
                symbolName: s.symbolName,
                digits: s.digits ?? 5,
                contractSize: s.lotSize ?? 100000,
            }));

            this.symbolListCache.set(cacheKey, symbolList);
            console.log(`[cTraderData] ${symbolList.length}シンボルをキャッシュ`);
        }

        // シンボル検索（名前の部分一致）
        const found = symbolList.find(s => {
            const name = s.symbolName.replace(/[\/\s]/g, '').toUpperCase();
            return name === normalizedSymbol.toUpperCase()
                || name.includes(normalizedSymbol.toUpperCase());
        });

        if (!found) {
            throw new Error(`[cTraderData] シンボル "${symbol}" が見つかりません`);
        }

        // キャッシュに保存
        this.symbolCache.set(normalizedSymbol, found);
        return found;
    }

    /**
     * cTrader Trendbar を OHLCV に変換
     *
     * cTrader の Trendbar は相対値形式:
     * - low = 実際のlow × 100000（整数）
     * - open = low + deltaOpen
     * - high = low + deltaHigh
     * - close = low + deltaClose
     *
     * @param trendbars - 生の Trendbar 配列
     * @param digits - 小数桁数（XAU/USD=2, EUR/USD=5 等）
     * @returns OHLCV バー配列
     */
    convertTrendbars(trendbars: CTraderTrendbar[], digits: number): OHLCVBarResult[] {
        const divisor = Math.pow(10, digits);

        return trendbars
            .map(bar => {
                // cTrader API はすべての数値フィールドを文字列で返すため、
                // 明示的に Number() でキャストしないと + 演算子が文字列連結になる
                const lowRaw = Number(bar.low);
                const openRaw = lowRaw + Number(bar.deltaOpen || 0);
                const highRaw = lowRaw + Number(bar.deltaHigh || 0);
                const closeRaw = lowRaw + Number(bar.deltaClose || 0);

                // タイムスタンプの解決
                let timestamp: Date;
                if (bar.utcTimestampInMinutes) {
                    timestamp = new Date(Number(bar.utcTimestampInMinutes) * 60 * 1000);
                } else if (bar.timestamp) {
                    timestamp = new Date(Number(bar.timestamp));
                } else {
                    timestamp = new Date();
                }

                return {
                    timestamp,
                    open: parseFloat((openRaw / divisor).toFixed(digits)),
                    high: parseFloat((highRaw / divisor).toFixed(digits)),
                    low: parseFloat((lowRaw / divisor).toFixed(digits)),
                    close: parseFloat((closeRaw / divisor).toFixed(digits)),
                    volume: Number(bar.volume || 0),
                };
            })
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }

    /**
     * 必要な時間範囲を推定（count × 期間の時間幅）
     */
    private estimateRequiredTimespan(period: CTraderPeriod, count: number): number {
        const periodMinutes: Record<CTraderPeriod, number> = {
            [CTraderTrendbarPeriod.M1]: 1,
            [CTraderTrendbarPeriod.M2]: 2,
            [CTraderTrendbarPeriod.M3]: 3,
            [CTraderTrendbarPeriod.M4]: 4,
            [CTraderTrendbarPeriod.M5]: 5,
            [CTraderTrendbarPeriod.M10]: 10,
            [CTraderTrendbarPeriod.M15]: 15,
            [CTraderTrendbarPeriod.M30]: 30,
            [CTraderTrendbarPeriod.H1]: 60,
            [CTraderTrendbarPeriod.H4]: 240,
            [CTraderTrendbarPeriod.H12]: 720,
            [CTraderTrendbarPeriod.D1]: 1440,
            [CTraderTrendbarPeriod.W1]: 10080,
            [CTraderTrendbarPeriod.MN1]: 43200,
        };

        // 市場休場を考慮して1.5倍のバッファ
        return periodMinutes[period] * count * 60 * 1000 * 1.5;
    }
}
