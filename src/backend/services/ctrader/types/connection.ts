/**
 * cTrader WebSocket接続関連の型定義
 * 
 * @reiryoku/ctrader-layer パッケージには型定義がないため、
 * プロジェクト内で共通の型定義を提供する
 */

/**
 * CTraderConnection の型定義
 * @reiryoku/ctrader-layer は型定義がないため独自に定義
 */
export interface CTraderConnectionType {
  open(): Promise<void>;
  close(): Promise<void>;
  sendCommand(command: string, params: Record<string, unknown>): Promise<unknown>;
  sendHeartbeat?(): void;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  off?(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * cTrader アカウント情報
 */
export interface CTraderAccount {
  ctidTraderAccountId: number;
  isLive: boolean;
  traderLogin?: number;
}

/**
 * cTrader アカウント一覧レスポンス
 */
export interface CTraderAccountListResponse {
  ctidTraderAccount?: CTraderAccount[];
}

/**
 * cTrader シンボル情報
 */
export interface CTraderSymbolInfo {
  symbolId: number;
  symbolName: string;
  digits?: number;
  pipPosition?: number;
}

/**
 * cTrader スポット価格イベント
 */
export interface CTraderSpotEvent {
  symbolId?: number;
  bid?: number;
  ask?: number;
  timestamp?: number;
}

/**
 * WebSocket接続設定
 */
export interface CTraderConnectionConfig {
  host: string;
  port: number;
}

/**
 * WebSocket環境タイプ
 */
export type CTraderEnvironment = 'live' | 'demo';
