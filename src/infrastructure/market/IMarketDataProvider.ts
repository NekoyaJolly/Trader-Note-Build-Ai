/**
 * 市場データプロバイダー抽象インターフェース
 * 
 * 目的: Twelve Data、cTrader Open API 等の市場データソースを統一インターフェースで扱う
 * 
 * 設計方針:
 * - Side-A (リアルタイム通知): cTrader Open API（WebSocket）
 * - Side-B (バックテスト): Twelve Data（REST API）
 * - 共通の型定義でデータソースを切り替え可能にする
 * 
 * 参照: docs/realtime_similarity_notification_architecture.md
 */

import { z } from 'zod';

// ========================================
// 共通型定義（Zodスキーマ）
// ========================================

/**
 * OHLCV バー（正規化前）
 */
export const OHLCVBarSchema = z.object({
  /** シンボル（オプション - リアルタイム用） */
  symbol: z.string().optional(),
  /** タイムスタンプ */
  timestamp: z.date(),
  /** 始値 */
  open: z.number(),
  /** 高値 */
  high: z.number(),
  /** 安値 */
  low: z.number(),
  /** 終値 */
  close: z.number(),
  /** 出来高 */
  volume: z.number(),
});

export type OHLCVBar = z.infer<typeof OHLCVBarSchema>;

/**
 * Tick データ（リアルタイム用）
 */
export const TickDataSchema = z.object({
  /** シンボル */
  symbol: z.string(),
  /** タイムスタンプ */
  timestamp: z.date(),
  /** Bid価格 */
  bid: z.number(),
  /** Ask価格 */
  ask: z.number(),
  /** 中値（(bid + ask) / 2） */
  mid: z.number(),
  /** スプレッド（ask - bid） */
  spread: z.number(),
});

export type TickData = z.infer<typeof TickDataSchema>;

/**
 * 市場データ取得結果
 */
export const MarketDataResultSchema = z.object({
  /** シンボル（内部形式: 例 'XAU/USD'） */
  symbol: z.string(),
  /** 時間足 */
  timeframe: z.string(),
  /** OHLCV データ */
  bars: z.array(OHLCVBarSchema),
  /** プロバイダー名 */
  provider: z.string(),
  /** 取得日時 */
  fetchedAt: z.date(),
});

export type MarketDataResult = z.infer<typeof MarketDataResultSchema>;

/**
 * サポートする時間足
 */
export const TimeframeSchema = z.enum([
  '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w',
]);

export type Timeframe = z.infer<typeof TimeframeSchema>;

/**
 * プロバイダー種別
 */
export const ProviderTypeSchema = z.enum([
  'twelve_data',  // Side-B用（REST）
  'ctrader',      // Side-A用（WebSocket）
]);

export type ProviderType = z.infer<typeof ProviderTypeSchema>;

// ========================================
// Tick購読関連の型定義
// ========================================

/**
 * Tick購読コールバック
 */
export type TickCallback = (tick: TickData) => void;

/**
 * 接続状態
 */
export const ConnectionStateSchema = z.enum([
  'disconnected',   // 未接続
  'connecting',     // 接続中
  'connected',      // 接続済み
  'reconnecting',   // 再接続中
  'error',          // エラー
]);

export type ConnectionState = z.infer<typeof ConnectionStateSchema>;

/**
 * 接続状態変更コールバック
 */
export type ConnectionStateCallback = (state: ConnectionState, error?: Error) => void;

// ========================================
// インターフェース定義
// ========================================

/**
 * 市場データプロバイダーの抽象インターフェース
 * 
 * REST API（Twelve Data）と WebSocket（cTrader）の両方をサポート
 */
export interface IMarketDataProvider {
  /** プロバイダー名 */
  readonly name: ProviderType;
  
  /** プロバイダーが設定済みか確認 */
  isConfigured(): boolean;
  
  // ========================================
  // REST API（履歴データ取得）
  // ========================================
  
  /**
   * 履歴データを取得
   * 
   * @param symbol - シンボル（内部形式: 例 'XAU/USD'）
   * @param timeframe - 時間足
   * @param limit - 取得件数
   * @returns OHLCV データ配列
   */
  getHistoricalData(
    symbol: string,
    timeframe: Timeframe,
    limit: number
  ): Promise<MarketDataResult>;
  
  /**
   * 現在の価格を取得（最新1本のみ）
   * 
   * @param symbol - シンボル
   * @param timeframe - 時間足
   * @returns 最新の OHLCV バー
   */
  getCurrentPrice(
    symbol: string,
    timeframe: Timeframe
  ): Promise<OHLCVBar | null>;
  
  // ========================================
  // WebSocket API（リアルタイムデータ）
  // ========================================
  
  /**
   * WebSocket 接続を開始
   * 
   * @returns 接続成功時は true
   */
  connect(): Promise<boolean>;
  
  /**
   * WebSocket 接続を終了
   */
  disconnect(): Promise<void>;
  
  /**
   * 現在の接続状態を取得
   */
  getConnectionState(): ConnectionState;
  
  /**
   * 接続状態変更のリスナーを登録
   * 
   * @param callback - 状態変更時に呼ばれるコールバック
   */
  onConnectionStateChange(callback: ConnectionStateCallback): void;
  
  /**
   * Tick 購読を開始
   * 
   * @param symbols - 購読するシンボルの配列
   * @param callback - Tick 受信時に呼ばれるコールバック
   */
  subscribeToTicks(symbols: string[], callback: TickCallback): Promise<void>;
  
  /**
   * Tick 購読を解除
   * 
   * @param symbols - 購読解除するシンボルの配列
   */
  unsubscribeFromTicks(symbols: string[]): Promise<void>;
  
  // ========================================
  // シンボル・時間足の正規化
  // ========================================
  
  /**
   * シンボルを内部形式に正規化
   * 
   * 例:
   * - Twelve Data: 'XAU/USD' → 'XAU/USD'（そのまま）
   * - cTrader: 'XAUUSD' → 'XAU/USD'
   * 
   * @param symbol - プロバイダー固有のシンボル形式
   * @returns 内部形式のシンボル
   */
  normalizeSymbol(symbol: string): string;
  
  /**
   * 内部形式のシンボルをプロバイダー形式に変換
   * 
   * @param symbol - 内部形式のシンボル
   * @returns プロバイダー固有のシンボル形式
   */
  toProviderSymbol(symbol: string): string;
  
  /**
   * 時間足を内部形式に正規化
   * 
   * @param timeframe - プロバイダー固有の時間足形式
   * @returns 内部形式の時間足
   */
  normalizeTimeframe(timeframe: string): Timeframe;
  
  /**
   * 内部形式の時間足をプロバイダー形式に変換
   * 
   * @param timeframe - 内部形式の時間足
   * @returns プロバイダー固有の時間足形式
   */
  toProviderTimeframe(timeframe: Timeframe): string;
}

// ========================================
// 抽象基底クラス（共通実装）
// ========================================

/**
 * 市場データプロバイダーの抽象基底クラス
 * 
 * 共通のロジック（シンボル正規化等）を提供し、
 * 具象クラスは API 固有の実装のみを行う
 */
export abstract class BaseMarketDataProvider implements IMarketDataProvider {
  abstract readonly name: ProviderType;
  
  protected connectionState: ConnectionState = 'disconnected';
  protected connectionStateCallbacks: ConnectionStateCallback[] = [];
  
  abstract isConfigured(): boolean;
  abstract getHistoricalData(symbol: string, timeframe: Timeframe, limit: number): Promise<MarketDataResult>;
  abstract getCurrentPrice(symbol: string, timeframe: Timeframe): Promise<OHLCVBar | null>;
  abstract connect(): Promise<boolean>;
  abstract disconnect(): Promise<void>;
  abstract subscribeToTicks(symbols: string[], callback: TickCallback): Promise<void>;
  abstract unsubscribeFromTicks(symbols: string[]): Promise<void>;
  abstract normalizeSymbol(symbol: string): string;
  abstract toProviderSymbol(symbol: string): string;
  abstract normalizeTimeframe(timeframe: string): Timeframe;
  abstract toProviderTimeframe(timeframe: Timeframe): string;
  
  /**
   * 現在の接続状態を取得
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }
  
  /**
   * 接続状態変更のリスナーを登録
   */
  onConnectionStateChange(callback: ConnectionStateCallback): void {
    this.connectionStateCallbacks.push(callback);
  }
  
  /**
   * 接続状態を更新し、リスナーに通知
   */
  protected setConnectionState(state: ConnectionState, error?: Error): void {
    this.connectionState = state;
    for (const callback of this.connectionStateCallbacks) {
      try {
        callback(state, error);
      } catch (e) {
        console.error('接続状態コールバック実行エラー:', e);
      }
    }
  }
  
  /**
   * OHLCV バーの妥当性を検証
   */
  protected validateOHLCVBar(bar: unknown): bar is OHLCVBar {
    const result = OHLCVBarSchema.safeParse(bar);
    return result.success;
  }
  
  /**
   * Tick データの妥当性を検証
   */
  protected validateTickData(tick: unknown): tick is TickData {
    const result = TickDataSchema.safeParse(tick);
    return result.success;
  }
}

// ========================================
// ファクトリ関数（型定義のみ）
// ========================================

/**
 * プロバイダーファクトリの設定
 */
export interface ProviderFactoryConfig {
  /** 優先プロバイダー */
  preferredProvider: ProviderType;
  /** Twelve Data API キー（Side-B用） */
  twelveDataApiKey?: string;
  /** cTrader クライアントID（Side-A用） */
  ctraderClientId?: string;
  /** cTrader クライアントシークレット（Side-A用） */
  ctraderClientSecret?: string;
  /** cTrader アクセストークン（Side-A用） */
  ctraderAccessToken?: string;
}
