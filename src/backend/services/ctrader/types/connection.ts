/**
 * cTrader WebSocket接続関連の型定義
 * 
 * @reiryoku/ctrader-layer パッケージには型定義がないため、
 * プロジェクト内で共通の型定義を提供する
 * 
 * 注意: cTrader APIレスポンスの型定義は src/schemas/external/ctrader.ts で
 * Zodスキーマから生成されています。このファイルには、WebSocket接続に固有の
 * 型定義のみを含めてください。
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
