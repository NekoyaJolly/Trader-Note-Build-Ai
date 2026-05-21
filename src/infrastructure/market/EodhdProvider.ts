/**
 * EODHD WebSocket Provider (Phase A A-12、2026-05-21)
 *
 * Side-A RealtimeChart のリアルタイム配信を cTrader → EODHD WebSocket に切替える際の Provider。
 *
 * 設計方針:
 * - `IMarketDataProvider` の WebSocket メソッド (connect / subscribeToTicks 等) を実装
 * - feed タイプは forex 固定 (Phase A 主用途)、Phase C で us / crypto 追加
 * - WebSocketTick (s/p/v/t) を内部 TickData (bid/ask/mid/spread) に変換
 *   forex feed では bid/ask 分離フィールドが提供されない場合があるため、
 *   p (last price) を bid/ask/mid 全てに同値で詰め、spread=0 として返す
 * - getHistoricalData / getCurrentPrice は Phase B で実装予定 (PR #3 では throw)
 *
 * 関連: docs/architecture/EODHD_PHASE_A_WBS.md PR #3 A-12
 */

import { z } from 'zod';
import { EODHDClient, type EODHDWebSocket, type WebSocketFeed, type WebSocketTick } from 'eodhd';
import { config } from '../../config';
import {
  BaseMarketDataProvider,
  type MarketDataResult,
  type OHLCVBar,
  type ProviderType,
  type TickCallback,
  type TickData,
  type Timeframe,
} from './IMarketDataProvider';
import { toEodhdSymbol, fromEodhdSymbol } from '../../utils/symbolNormalization';

const KNOWN_QUOTES = ['USDT', 'USD', 'JPY', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'NZD'] as const;

/**
 * EODHD WebSocket Tick の Zod schema (boundary validation)
 * Copilot review (PR #235) 指摘 6 対応: 手動 typeof 判定を Zod に統一
 */
const WebSocketTickSchema = z
  .object({
    s: z.string().min(1),
    p: z.number().finite().positive(),
    t: z.number().finite(),
    v: z.number().optional(),
  })
  .passthrough();

export interface EodhdProviderOptions {
  /** API トークン (省略時は config.eodhd.apiToken) */
  apiToken?: string;
  /** WebSocket feed 種別 (デフォルト: forex) */
  feed?: WebSocketFeed;
  /** API base URL (省略時は config.eodhd.baseUrl) */
  baseUrl?: string;
}

export class EodhdProvider extends BaseMarketDataProvider {
  readonly name: ProviderType = 'eodhd';

  private client: EODHDClient | null = null;
  private ws: EODHDWebSocket | null = null;
  private tickCallbacks: TickCallback[] = [];
  private subscribedProviderSymbols: Set<string> = new Set();
  private readonly feed: WebSocketFeed;

  constructor(opts: EodhdProviderOptions = {}) {
    super();
    const apiToken = opts.apiToken ?? config.eodhd.apiToken;
    const baseUrl = opts.baseUrl ?? config.eodhd.baseUrl;
    if (apiToken) {
      this.client = new EODHDClient({ apiToken, baseUrl });
    }
    this.feed = opts.feed ?? 'forex';
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  // ===========================================
  // REST (Phase B で実装)
  // ===========================================

  async getHistoricalData(
    _symbol: string,
    _timeframe: Timeframe,
    _limit: number,
  ): Promise<MarketDataResult> {
    throw new Error(
      'EodhdProvider.getHistoricalData() は Phase B (OHLCV 切替) で実装予定',
    );
  }

  async getCurrentPrice(_symbol: string, _timeframe: Timeframe): Promise<OHLCVBar | null> {
    throw new Error(
      'EodhdProvider.getCurrentPrice() は Phase B (OHLCV 切替) で実装予定',
    );
  }

  // ===========================================
  // WebSocket
  // ===========================================

  async connect(): Promise<boolean> {
    if (!this.client) {
      this.setConnectionState('error', new Error('EODHD_API_KEY 未設定'));
      return false;
    }
    if (this.ws) {
      return true;
    }
    this.setConnectionState('connecting');
    console.log(`[EodhdProvider] connecting feed=${this.feed}`);
    try {
      const initial = Array.from(this.subscribedProviderSymbols);
      const ws = this.client.websocket(this.feed, initial);
      ws.on('data', (tick) => this.handleTick(tick));
      ws.on('error', (err) => {
        console.error('[EodhdProvider] error:', err.message);
        this.setConnectionState('error', err);
      });
      ws.on('close', () => {
        console.log('[EodhdProvider] closed');
        this.setConnectionState('disconnected');
      });
      ws.on('reconnectFailed', () => {
        this.setConnectionState('error', new Error('EODHD WebSocket 再接続失敗'));
      });
      this.ws = ws;
      this.setConnectionState('connected');
      console.log('[EodhdProvider] connected');
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('EODHD connect 失敗');
      this.setConnectionState('error', error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.tickCallbacks = [];
    this.subscribedProviderSymbols.clear();
    this.setConnectionState('disconnected');
    console.log('[EodhdProvider] disconnected');
  }

  async subscribeToTicks(symbols: string[], callback: TickCallback): Promise<void> {
    this.tickCallbacks.push(callback);
    await this.addSymbols(symbols);
  }

  /**
   * 既存の Tick callback を再登録せずに symbols だけ購読追加するメソッド。
   * Copilot review (PR #235) 指摘 3 対応: orchestrator 側で callback の重複登録を防ぐため、
   * 2 回目以降の subscribe は本メソッドを呼んで callback の重複を回避する。
   */
  async addSymbols(symbols: string[]): Promise<void> {
    const providerSymbols = symbols.map((s) => this.toProviderSymbol(s));
    for (const ps of providerSymbols) this.subscribedProviderSymbols.add(ps);
    if (this.ws) {
      this.ws.subscribe(providerSymbols);
    } else {
      // 未接続なら接続を開始 (初期 symbols として渡される)
      await this.connect();
    }
  }

  async unsubscribeFromTicks(symbols: string[]): Promise<void> {
    const providerSymbols = symbols.map((s) => this.toProviderSymbol(s));
    for (const ps of providerSymbols) this.subscribedProviderSymbols.delete(ps);
    if (this.ws) {
      this.ws.unsubscribe(providerSymbols);
    }
  }

  // ===========================================
  // Tick ハンドラ
  // ===========================================

  private handleTick(raw: WebSocketTick): void {
    // Copilot review (PR #235) 指摘 6 対応: Zod schema で形状を narrow
    const parsed = WebSocketTickSchema.safeParse(raw);
    if (!parsed.success) {
      // 形状不一致の tick は無視
      return;
    }
    const { s, p, t } = parsed.data;
    const tick: TickData = {
      symbol: this.normalizeSymbol(s),
      timestamp: new Date(t),
      // forex feed は bid/ask 分離フィールドを公開しない場合があるため、
      // p (last price) を mid と仮定し、bid/ask 同値・spread=0 で正規化する。
      // 実 bid/ask が必要な画面では Phase C で us-quote feed を別 Provider 化する。
      bid: p,
      ask: p,
      mid: p,
      spread: 0,
    };
    for (const callback of this.tickCallbacks) {
      try {
        callback(tick);
      } catch (e) {
        console.error('[EODHD WS] callback error:', e);
      }
    }
  }

  // ===========================================
  // シンボル / 時間足の正規化
  // ===========================================

  /**
   * EODHD プロバイダー形式から内部形式 (例 'XAU/USD') に変換
   *
   * 入力例: 'XAUUSD.FOREX' → 'XAU/USD'、'XAUUSD' → 'XAU/USD'
   */
  normalizeSymbol(symbol: string): string {
    const base = fromEodhdSymbol(symbol); // XAUUSD
    for (const quote of KNOWN_QUOTES) {
      if (base.endsWith(quote) && base.length > quote.length) {
        return `${base.slice(0, -quote.length)}/${quote}`;
      }
    }
    return base;
  }

  /**
   * 内部形式 (例 'XAU/USD') を EODHD プロバイダー形式に変換
   *
   * Phase A は FOREX 固定 (PR #3 主用途)、他 feed は Phase C で拡張
   */
  toProviderSymbol(symbol: string): string {
    return toEodhdSymbol(symbol, 'FOREX');
  }

  normalizeTimeframe(timeframe: string): Timeframe {
    // EODHD WebSocket は timeframe 概念なし (Tick streaming)。
    // 内部形式の Timeframe enum をそのまま返す (型 narrow)。
    const allowed: readonly Timeframe[] = [
      '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w',
    ];
    if ((allowed as readonly string[]).includes(timeframe)) {
      return timeframe as Timeframe;
    }
    return '15m';
  }

  toProviderTimeframe(timeframe: Timeframe): string {
    return timeframe;
  }
}
