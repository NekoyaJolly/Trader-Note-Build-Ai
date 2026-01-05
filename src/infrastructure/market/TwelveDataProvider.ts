/**
 * Twelve Data プロバイダー（Side-B 用）
 * 
 * 目的: Twelve Data REST API を使用した履歴データ取得
 * 
 * 用途:
 * - Side-B のバックテスト用データ取得
 * - 日次バッチでのインジケーター計算
 * 
 * 制約:
 * - REST API のみ（WebSocket は有料プラン）
 * - 無料プラン: 800回/日, 8回/分
 * 
 * 参照: docs/realtime_similarity_notification_architecture.md
 */

import { z } from 'zod';
import {
  BaseMarketDataProvider,
  OHLCVBar,
  MarketDataResult,
  Timeframe,
  TimeframeSchema,
  TickCallback,
  ConnectionState,
} from './IMarketDataProvider';
import {
  TwelveDataTimeSeriesResponseSchema,
  TwelveDataTimeSeriesSuccess,
} from '../../schemas/external/twelveData';

// ========================================
// 設定スキーマ
// ========================================

/**
 * Twelve Data プロバイダー設定
 */
export const TwelveDataConfigSchema = z.object({
  apiUrl: z.string().url().default('https://api.twelvedata.com'),
  apiKey: z.string().min(1, 'APIキーは必須です'),
});

export type TwelveDataConfig = z.infer<typeof TwelveDataConfigSchema>;

// ========================================
// 時間足マッピング
// ========================================

/**
 * 内部形式 → Twelve Data API 形式
 */
const TIMEFRAME_TO_API: Record<Timeframe, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1h': '1h',
  '4h': '4h',
  '1d': '1day',
  '1w': '1week',
};

/**
 * Twelve Data API 形式 → 内部形式
 */
const API_TO_TIMEFRAME: Record<string, Timeframe> = {
  '1min': '1m',
  '5min': '5m',
  '15min': '15m',
  '30min': '30m',
  '1h': '1h',
  '4h': '4h',
  '1day': '1d',
  '1week': '1w',
};

// ========================================
// TwelveDataProvider 実装
// ========================================

/**
 * Twelve Data REST API プロバイダー
 * 
 * Side-B のバックテスト用データ取得に使用
 * WebSocket はサポートしない（有料プランのみのため）
 */
export class TwelveDataProvider extends BaseMarketDataProvider {
  readonly name = 'twelve_data' as const;
  
  private apiUrl: string;
  private apiKey: string;
  
  constructor(config: TwelveDataConfig) {
    super();
    // Zod でバリデーション
    const validated = TwelveDataConfigSchema.parse(config);
    this.apiUrl = validated.apiUrl;
    this.apiKey = validated.apiKey;
  }
  
  /**
   * 環境変数から設定を読み込んでインスタンスを生成
   */
  static fromEnv(): TwelveDataProvider | null {
    const apiKey = process.env.TWELVE_DATA_API_KEY || process.env.MARKET_API_KEY;
    const apiUrl = process.env.TWELVE_DATA_API_URL || 'https://api.twelvedata.com';
    
    if (!apiKey) {
      console.warn('[TwelveDataProvider] APIキーが設定されていません');
      return null;
    }
    
    return new TwelveDataProvider({ apiUrl, apiKey });
  }
  
  // ========================================
  // 基本メソッド
  // ========================================
  
  /**
   * プロバイダーが設定済みか確認
   */
  isConfigured(): boolean {
    return !!(this.apiUrl && this.apiKey);
  }
  
  // ========================================
  // REST API（履歴データ取得）
  // ========================================
  
  /**
   * 履歴データを取得
   */
  async getHistoricalData(
    symbol: string,
    timeframe: Timeframe,
    limit: number
  ): Promise<MarketDataResult> {
    const providerSymbol = this.toProviderSymbol(symbol);
    const interval = this.toProviderTimeframe(timeframe);
    
    const url = new URL(`${this.apiUrl}/time_series`);
    url.searchParams.set('symbol', providerSymbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('outputsize', String(limit));
    url.searchParams.set('apikey', this.apiKey);
    
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`Twelve Data API エラー: ${response.status} ${response.statusText}`);
    }
    
    const json = await response.json();
    
    // Zod でパース（型安全）
    const result = TwelveDataTimeSeriesResponseSchema.safeParse(json);
    
    if (!result.success) {
      throw new Error(`Twelve Data レスポンスパースエラー: ${result.error.message}`);
    }
    
    // エラーレスポンスの場合
    if ('code' in result.data) {
      throw new Error(`Twelve Data API エラー: ${result.data.message}`);
    }
    
    // 成功レスポンス
    const successData = result.data as TwelveDataTimeSeriesSuccess;
    
    // OHLCV バーに変換（時系列順: 古い → 新しい）
    const bars: OHLCVBar[] = successData.values
      .map(v => ({
        timestamp: new Date(v.datetime),
        open: v.open,
        high: v.high,
        low: v.low,
        close: v.close,
        volume: v.volume ?? 0,
      }))
      .reverse();
    
    return {
      symbol: this.normalizeSymbol(successData.meta.symbol),
      timeframe,
      bars,
      provider: this.name,
      fetchedAt: new Date(),
    };
  }
  
  /**
   * 現在の価格を取得（最新1本のみ）
   */
  async getCurrentPrice(
    symbol: string,
    timeframe: Timeframe
  ): Promise<OHLCVBar | null> {
    const result = await this.getHistoricalData(symbol, timeframe, 1);
    return result.bars[0] ?? null;
  }
  
  // ========================================
  // WebSocket API（未サポート）
  // ========================================
  
  /**
   * WebSocket 接続を開始
   * 
   * Twelve Data の WebSocket は有料プランのみのため、
   * Side-B（バックテスト用途）では実装しない
   */
  async connect(): Promise<boolean> {
    console.warn('[TwelveDataProvider] WebSocket は有料プランのみのため未サポートです');
    this.setConnectionState('disconnected');
    return false;
  }
  
  /**
   * WebSocket 接続を終了
   */
  async disconnect(): Promise<void> {
    this.setConnectionState('disconnected');
  }
  
  /**
   * Tick 購読を開始（未サポート）
   */
  async subscribeToTicks(_symbols: string[], _callback: TickCallback): Promise<void> {
    throw new Error('[TwelveDataProvider] WebSocket Tick 購読は未サポートです。Side-A では CTraderProvider を使用してください。');
  }
  
  /**
   * Tick 購読を解除（未サポート）
   */
  async unsubscribeFromTicks(_symbols: string[]): Promise<void> {
    // No-op
  }
  
  // ========================================
  // シンボル・時間足の正規化
  // ========================================
  
  /**
   * シンボルを内部形式に正規化
   * 
   * Twelve Data はスラッシュ区切り形式を使用
   * 例: 'XAU/USD' → 'XAU/USD'（そのまま）
   */
  normalizeSymbol(symbol: string): string {
    // 既にスラッシュ区切りの場合はそのまま
    if (symbol.includes('/')) {
      return symbol;
    }
    
    // よくある通貨ペアの変換
    const knownPairs: Record<string, string> = {
      'XAUUSD': 'XAU/USD',
      'EURUSD': 'EUR/USD',
      'GBPUSD': 'GBP/USD',
      'USDJPY': 'USD/JPY',
      'BTCUSD': 'BTC/USD',
      'ETHUSD': 'ETH/USD',
    };
    
    return knownPairs[symbol.toUpperCase()] || symbol;
  }
  
  /**
   * 内部形式のシンボルをプロバイダー形式に変換
   * 
   * Twelve Data はスラッシュ区切りを受け付ける
   */
  toProviderSymbol(symbol: string): string {
    // そのまま返す（Twelve Data はスラッシュ区切り形式）
    return symbol;
  }
  
  /**
   * 時間足を内部形式に正規化
   */
  normalizeTimeframe(timeframe: string): Timeframe {
    // まず API 形式から内部形式への変換を試みる
    const mapped = API_TO_TIMEFRAME[timeframe.toLowerCase()];
    if (mapped) {
      return mapped;
    }
    
    // 既に内部形式の場合
    const result = TimeframeSchema.safeParse(timeframe);
    if (result.success) {
      return result.data;
    }
    
    // デフォルト
    console.warn(`[TwelveDataProvider] 不明な時間足: ${timeframe}, デフォルト '15m' を使用`);
    return '15m';
  }
  
  /**
   * 内部形式の時間足をプロバイダー形式に変換
   */
  toProviderTimeframe(timeframe: Timeframe): string {
    return TIMEFRAME_TO_API[timeframe] || '15min';
  }
}
