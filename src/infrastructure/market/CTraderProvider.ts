/**
 * cTrader WebSocket プロバイダー
 * 
 * 目的: cTrader Open API の WebSocket 接続でリアルタイム Tick データを受信
 * 
 * 機能:
 * - OAuth トークンを使用した認証
 * - 複数シンボルの Tick データ購読
 * - 自動再接続（指数バックオフ）
 * - 接続状態の管理
 * 
 * 参照: 
 * - docs/realtime_similarity_notification_architecture.md
 * - https://help.ctrader.com/open-api/
 */

import { z } from 'zod';
import type {
  TickData,
  OHLCVBar,
  MarketDataResult,
  TickCallback,
  Timeframe,
  ProviderType} from './IMarketDataProvider';
import {
  BaseMarketDataProvider
} from './IMarketDataProvider';
import type { CTraderAuthService } from '../../backend/services/ctrader/ctraderAuthService';
import { config } from '../../config';
import type { JsonValue } from '../../utils/jsonValue';

type WebSocketMessageData = string | Buffer | ArrayBuffer | Buffer[];
type WebSocketEventArg = WebSocketMessageData | Error | number | Buffer;
type CTraderSocketMessage = {
  payloadType?: number;
  payload?: JsonValue;
  clientMsgId?: string;
};

// WebSocket の型（Node.js 環境用）
type WebSocketType = {
  OPEN: number;
  readyState: number;
  on: (event: string, handler: (...args: WebSocketEventArg[]) => void) => void;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  ping: () => void;
};

// ========================================
// cTrader Protocol Buffers メッセージ型
// ========================================

/**
 * cTrader メッセージタイプ（Open API Protocol）
 */
export const CTraderMessageType = {
  PROTO_OA_APPLICATION_AUTH_REQ: 2100,
  PROTO_OA_APPLICATION_AUTH_RES: 2101,
  PROTO_OA_ACCOUNT_AUTH_REQ: 2102,
  PROTO_OA_ACCOUNT_AUTH_RES: 2103,
  PROTO_OA_NEW_ORDER_REQ: 2106,
  PROTO_OA_AMEND_ORDER_REQ: 2107,
  PROTO_OA_CANCEL_ORDER_REQ: 2108,
  PROTO_OA_CLOSE_POSITION_REQ: 2109,
  PROTO_OA_SUBSCRIBE_SPOTS_REQ: 2124,
  PROTO_OA_SUBSCRIBE_SPOTS_RES: 2125,
  PROTO_OA_UNSUBSCRIBE_SPOTS_REQ: 2126,
  PROTO_OA_UNSUBSCRIBE_SPOTS_RES: 2127,
  PROTO_OA_SPOT_EVENT: 2128,
  PROTO_OA_RECONCILE_REQ: 2118,
  PROTO_OA_RECONCILE_RES: 2119,
  PROTO_OA_EXECUTION_EVENT: 2141,
  PROTO_OA_ERROR_RES: 2142,
  HEARTBEAT_EVENT: 51,
} as const;

/**
 * cTrader Spot Event（Tick データ）
 */
export const CTraderSpotEventSchema = z.object({
  symbolId: z.number(),
  bid: z.number().optional(),
  ask: z.number().optional(),
  timestamp: z.number(),
  bidVolume: z.number().optional(),
  askVolume: z.number().optional(),
});

export type CTraderSpotEvent = z.infer<typeof CTraderSpotEventSchema>;

// ========================================
// 再接続設定
// ========================================

interface ReconnectConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
}

const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  maxAttempts: 10,
  baseDelay: 1000,
  maxDelay: 60000,
};

// ========================================
// CTraderProvider クラス
// ========================================

export class CTraderProvider extends BaseMarketDataProvider {
  readonly name: ProviderType = 'ctrader';

  private ws: WebSocketType | null = null;
  private authService: CTraderAuthService;
  private accountId: string;
  private reconnectConfig: ReconnectConfig;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private symbolIdMap: Map<string, number> = new Map();
  private reverseSymbolIdMap: Map<number, string> = new Map();
  private pendingRequests: Map<number, { resolve: (value: JsonValue | undefined) => void; reject: (error: Error) => void }> = new Map();
  private requestId = 0;
  private tickCallbacks: TickCallback[] = [];
  private subscribedSymbols: Set<string> = new Set();

  constructor(
    authService: CTraderAuthService,
    accountId: string,
    reconnectConfig: ReconnectConfig = DEFAULT_RECONNECT_CONFIG
  ) {
    super();
    this.authService = authService;
    this.accountId = accountId;
    this.reconnectConfig = reconnectConfig;
  }

  // ========================================
  // IMarketDataProvider 実装
  // ========================================

  isConfigured(): boolean {
    return !!(config.ctrader.clientId && config.ctrader.clientSecret && this.accountId);
  }

  async getHistoricalData(
    symbol: string,
    timeframe: Timeframe,
    limit: number
  ): Promise<MarketDataResult> {
    const normalizedSymbol = this.normalizeSymbol(symbol);

    try {
      // CTraderDataService を使ってヒストリカルデータを取得
      const { CTraderDataService } = await import('../../backend/services/ctrader/ctraderDataService');
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      const dataService = new CTraderDataService(
        new (await import('../../backend/services/ctrader/ctraderAuthService')).CTraderAuthService(prisma)
      );

      if (!dataService.isConfigured()) {
        console.warn('[cTrader] API未設定: 空のデータを返します');
        return { symbol: normalizedSymbol, timeframe, bars: [], provider: this.name, fetchedAt: new Date() };
      }

      const bars = await dataService.fetchTrendbars(this.accountId, symbol, timeframe, limit);

      return {
        symbol: normalizedSymbol,
        timeframe,
        bars: bars.map(b => ({
          timestamp: b.timestamp,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        })),
        provider: this.name,
        fetchedAt: new Date(),
      };
    } catch (error) {
      console.error('[cTrader] ヒストリカルデータ取得エラー:', error);
      return {
        symbol: normalizedSymbol,
        timeframe,
        bars: [],
        provider: this.name,
        fetchedAt: new Date(),
      };
    }
  }

  getCurrentPrice(_symbol: string, _timeframe: Timeframe): Promise<OHLCVBar | null> {
    return Promise.resolve(null);
  }

  async connect(): Promise<boolean> {
    if (this.connectionState === 'connected') {
      console.log('[cTrader] 既に接続済み');
      return true;
    }

    this.setConnectionState('connecting');
    console.log('[cTrader] WebSocket 接続開始...');

    try {
      const accessToken = await this.authService.getValidAccessToken(this.accountId);
      const WebSocket = (await import('ws')).default;
      this.ws = new WebSocket(config.ctrader.wsUrl);

      return new Promise((resolve, reject) => {
        if (!this.ws) {
          reject(new Error('WebSocket インスタンス作成失敗'));
          return;
        }

        this.ws.on('open', async () => {
          console.log('[cTrader] WebSocket 接続成功');
          this.reconnectAttempts = 0;

          try {
            await this.authenticateApplication();
            await this.authenticateAccount(accessToken);
            this.setConnectionState('connected');
            this.startHeartbeat();
            console.log('[cTrader] 認証完了');
            resolve(true);
          } catch (authError) {
            console.error('[cTrader] 認証エラー:', authError);
            const error = authError instanceof Error ? authError : new Error('cTrader 認証エラー');
            this.setConnectionState('error', error);
            reject(error);
          }
        });

        this.ws.on('message', (data) => this.handleMessage(data as WebSocketMessageData));
        this.ws.on('error', (error) => {
          console.error('[cTrader] WebSocket エラー:', error);
          const err = this.toError(error);
          this.setConnectionState('error', err);
          reject(err);
        });
        this.ws.on('close', (...args) => {
          const [code, reason] = args;
          console.log(`[cTrader] WebSocket 切断: code=${this.eventArgToString(code)}, reason=${this.eventArgToString(reason)}`);
          this.setConnectionState('disconnected');
          this.stopHeartbeat();
          if (this.connectionState !== 'error') {
            this.scheduleReconnect();
          }
        });
      });
    } catch (error) {
      console.error('[cTrader] 接続エラー:', error);
      this.setConnectionState('error', error as Error);
      return false;
    }
  }

  disconnect(): Promise<void> {
    console.log('[cTrader] 切断開始...');
    this.stopHeartbeat();
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.setConnectionState('disconnected');
    console.log('[cTrader] 切断完了');
    return Promise.resolve();
  }

  /**
   * @deprecated Phase A PR #3 (2026-05-21) で Tick 配信は EodhdProvider に移行。
   * CTraderProvider は発注/決済 only に縮小されたため、本メソッドを呼ぶと例外を投げる。
   * リアルタイム Tick が必要な場合は `EodhdProvider.subscribeToTicks()` を使用すること。
   */
  async subscribeToTicks(_symbols: string[], _callback: TickCallback): Promise<void> {
    void _symbols;
    void _callback;
    throw new Error(
      '[cTrader] Tick subscription は Phase A 以降 EodhdProvider に移行済。CTraderProvider は発注/決済 only。',
    );
  }

  /**
   * @deprecated Phase A PR #3 (2026-05-21) で Tick 配信は EodhdProvider に移行。
   * 本メソッドは IMarketDataProvider 互換のため残されているが no-op。
   */
  async unsubscribeFromTicks(_symbols: string[]): Promise<void> {
    void _symbols;
    // no-op: Tick subscription は EodhdProvider に移行済
  }

  // ========================================
  // シンボル・時間足の正規化
  // ========================================

  normalizeSymbol(symbol: string): string {
    const patterns: Record<string, string> = {
      'XAUUSD': 'XAU/USD', 'EURUSD': 'EUR/USD', 'USDJPY': 'USD/JPY', 'GBPUSD': 'GBP/USD',
    };
    return patterns[symbol] || symbol;
  }

  toProviderSymbol(symbol: string): string {
    return symbol.replace('/', '');
  }

  normalizeTimeframe(timeframe: string): Timeframe {
    const mapping: Record<string, Timeframe> = {
      'M1': '1m', 'M5': '5m', 'M15': '15m', 'M30': '30m', 'H1': '1h', 'H4': '4h', 'D1': '1d', 'W1': '1w',
    };
    return mapping[timeframe] || '15m';
  }

  toProviderTimeframe(timeframe: Timeframe): string {
    const mapping: Record<Timeframe, string> = {
      '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1', '1w': 'W1',
    };
    return mapping[timeframe];
  }

  // ========================================
  // cTrader Protocol メソッド
  // ========================================

  private async authenticateApplication(): Promise<void> {
    const message = {
      payloadType: CTraderMessageType.PROTO_OA_APPLICATION_AUTH_REQ,
      payload: { clientId: config.ctrader.clientId, clientSecret: config.ctrader.clientSecret },
    };
    await this.sendRequest(message);
  }

  private async authenticateAccount(accessToken: string): Promise<void> {
    const message = {
      payloadType: CTraderMessageType.PROTO_OA_ACCOUNT_AUTH_REQ,
      payload: { accessToken },
    };
    await this.sendRequest(message);
  }

  private resolveSymbolId(symbol: string): Promise<number> {
    const cached = this.symbolIdMap.get(symbol);
    if (cached) return Promise.resolve(cached);

    const commonSymbolIds: Record<string, number> = {
      'XAUUSD': 1, 'EURUSD': 2, 'USDJPY': 3, 'GBPUSD': 4,
    };

    const symbolId = commonSymbolIds[symbol];
    if (symbolId) {
      this.symbolIdMap.set(symbol, symbolId);
      this.reverseSymbolIdMap.set(symbolId, symbol);
      return Promise.resolve(symbolId);
    }
    return Promise.reject(new Error(`[cTrader] シンボル ${symbol} のIDが見つかりません`));
  }

  private async subscribeToSymbol(symbolId: number): Promise<void> {
    const message = {
      payloadType: CTraderMessageType.PROTO_OA_SUBSCRIBE_SPOTS_REQ,
      payload: { symbolId: [symbolId] },
    };
    await this.sendRequest(message);
  }

  private async unsubscribeFromSymbol(symbolId: number): Promise<void> {
    const message = {
      payloadType: CTraderMessageType.PROTO_OA_UNSUBSCRIBE_SPOTS_REQ,
      payload: { symbolId: [symbolId] },
    };
    await this.sendRequest(message);
  }

  // ========================================
  // WebSocket メッセージ処理
  // ========================================

  private sendRequest(message: object): Promise<JsonValue | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
        reject(new Error('[cTrader] WebSocket が接続されていません'));
        return;
      }
      const reqId = ++this.requestId;
      this.pendingRequests.set(reqId, { resolve, reject });
      setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error('[cTrader] リクエストタイムアウト'));
        }
      }, 10000);
      const payload = JSON.stringify({ ...message, clientMsgId: reqId.toString() });
      this.ws.send(payload);
    });
  }

  private handleMessage(data: WebSocketMessageData): void {
    try {
      const message = JSON.parse(this.websocketDataToString(data)) as CTraderSocketMessage;
      if (message.payloadType === CTraderMessageType.PROTO_OA_SPOT_EVENT) {
        this.handleSpotEvent(message.payload);
        return;
      }
      if (message.payloadType === CTraderMessageType.HEARTBEAT_EVENT) return;
      if (message.payloadType === CTraderMessageType.PROTO_OA_ERROR_RES) {
        console.error('[cTrader] エラー:', message.payload);
        return;
      }
      if (message.clientMsgId) {
        const reqId = parseInt(message.clientMsgId, 10);
        const pending = this.pendingRequests.get(reqId);
        if (pending) {
          this.pendingRequests.delete(reqId);
          pending.resolve(message.payload);
        }
      }
    } catch (error) {
      console.error('[cTrader] メッセージパースエラー:', error);
    }
  }

  private handleSpotEvent(payload: JsonValue | undefined): void {
    const result = CTraderSpotEventSchema.safeParse(payload);
    if (!result.success) return;

    const event = result.data;
    const symbol = this.reverseSymbolIdMap.get(event.symbolId);
    if (!symbol) return;

    const bid = event.bid || 0;
    const ask = event.ask || 0;
    const tick: TickData = {
      symbol,
      timestamp: new Date(event.timestamp),
      bid,
      ask,
      mid: (bid + ask) / 2,
      spread: ask - bid,
    };

    for (const callback of this.tickCallbacks) {
      try { callback(tick); } catch (e) { console.error('[cTrader] Tick コールバックエラー:', e); }
    }
  }

  // ========================================
  // 再接続・ハートビート
  // ========================================

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.reconnectConfig.maxAttempts) {
      console.error('[cTrader] 再接続上限');
      this.setConnectionState('error');
      return;
    }
    const delay = Math.min(this.reconnectConfig.baseDelay * Math.pow(2, this.reconnectAttempts), this.reconnectConfig.maxDelay);
    console.log(`[cTrader] ${delay}ms 後に再接続`);
    this.setConnectionState('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(err => console.error('[cTrader] 再接続失敗:', err));
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === this.ws.OPEN) this.ws.ping();
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  // ========================================
  // パブリックコマンド送信API（口座情報取得用）
  // ========================================

  /**
   * cTrader コマンドを送信（口座情報・ポジション取得用）
   * 
   * @param command - コマンド名（例: 'ProtoOAReconcileReq'）
   * @param payload - ペイロード
   * @returns レスポンス
   */
  async sendCommand<TPayload extends object>(command: string, payload: TPayload): Promise<JsonValue | undefined> {
    // コマンド名からメッセージタイプを解決
    const messageTypeMap: Record<string, number> = {
      'ProtoOAReconcileReq': CTraderMessageType.PROTO_OA_RECONCILE_REQ,
      'ProtoOANewOrderReq': CTraderMessageType.PROTO_OA_NEW_ORDER_REQ,
      'ProtoOAAmendOrderReq': CTraderMessageType.PROTO_OA_AMEND_ORDER_REQ,
      'ProtoOACancelOrderReq': CTraderMessageType.PROTO_OA_CANCEL_ORDER_REQ,
      'ProtoOAClosePositionReq': CTraderMessageType.PROTO_OA_CLOSE_POSITION_REQ,
    };

    const payloadType = messageTypeMap[command];
    if (!payloadType) {
      throw new Error(`[cTrader] 未知のコマンド: ${command}`);
    }

    const message = { payloadType, payload };
    return this.sendRequest(message);
  }

  private websocketDataToString(data: WebSocketMessageData): string {
    if (typeof data === 'string') return data;
    if (Buffer.isBuffer(data)) return data.toString('utf8');
    if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
    return Buffer.from(data).toString('utf8');
  }

  private eventArgToString(value: WebSocketEventArg | undefined): string {
    if (value === undefined) return '';
    if (typeof value === 'number' || typeof value === 'string') return String(value);
    if (value instanceof Error) return value.message;
    if (Buffer.isBuffer(value)) return value.toString('utf8');
    if (Array.isArray(value)) return Buffer.concat(value).toString('utf8');
    return Buffer.from(value).toString('utf8');
  }

  private toError(value: WebSocketEventArg): Error {
    return value instanceof Error ? value : new Error(this.eventArgToString(value));
  }
}
