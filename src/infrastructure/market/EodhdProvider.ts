/**
 * EODHD Provider (Phase A WebSocket + Phase B OHLCV ヒストリカル)
 *
 * Side-A RealtimeChart のリアルタイム配信 (Phase A) と Side-B / バックテスト用の
 * ヒストリカル OHLCV 取得 (Phase B) を担う統合 Provider。
 *
 * 設計方針:
 * - `IMarketDataProvider` の WebSocket メソッド (connect / subscribeToTicks 等) を実装
 * - feed タイプは forex 固定 (Phase A 主用途)、Phase C で us / crypto 追加
 * - WebSocketTick (s/p/v/t) を内部 TickData (bid/ask/mid/spread) に変換
 *   forex feed では bid/ask 分離フィールドが提供されない場合があるため、
 *   p (last price) を bid/ask/mid 全てに同値で詰め、spread=0 として返す
 * - getHistoricalData: EODHD intraday API は `1m / 5m / 1h` のみ。それ以外の Timeframe は
 *   `ohlcvAggregation.ts` のクライアント側集約で 15m / 30m / 4h を合成する。
 *   1d / 1w は eod API (period=d/w) を直接使用。
 * - getCurrentPrice: getHistoricalData(limit=1) の薄いラッパー
 *
 * 関連:
 * - docs/architecture/EODHD_PHASE_A_WBS.md PR #3 A-12 (Phase A WebSocket)
 * - docs/architecture/EODHD_INTEGRATION.md (Phase A 完了時新規)
 */

import { z } from 'zod';
import {
  EODHDClient,
  type EodDataPoint,
  type EODHDWebSocket,
  type IntradayDataPoint,
  type WebSocketFeed,
  type WebSocketTick,
} from 'eodhd';
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
import {
  TIMEFRAME_MS,
  planEodhdFetch,
  aggregateOHLCV,
} from './ohlcvAggregation';

const KNOWN_QUOTES = ['USDT', 'USD', 'JPY', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'NZD'] as const;

/**
 * Date → 'YYYY-MM-DD' (UTC) 形式に変換。EODHD eod の from/to 用。
 */
function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

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
  // REST (Phase B 実装、2026-05-22)
  // ===========================================

  /**
   * ヒストリカル OHLCV を取得 (limit 件)。
   *
   * 内部 Timeframe → EODHD 取得計画は `planEodhdFetch()` に集約:
   * - 1m / 5m / 1h: intraday API ネイティブ
   * - 15m / 30m / 4h: 5m or 1h を取得後にクライアント側で集約
   * - 1d / 1w: eod API (period=d/w)
   *
   * limit に対する from/to レンジ:
   * - intraday: 必要な native bar 数 = limit × factor、安全係数 ×2.5 で from を計算 (週末・休場日吸収)
   * - eod: 必要な日数 = limit × (period=='w' ? 7 : 1)、安全係数 ×1.6 で from を計算
   */
  async getHistoricalData(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
  ): Promise<MarketDataResult> {
    this.ensureClient();
    const providerSymbol = this.toProviderSymbol(symbol);
    const plan = planEodhdFetch(timeframe);

    if (plan.kind === 'intraday') {
      const nativeTfMs = TIMEFRAME_MS[plan.interval];
      // 必要な native bar 数 (集約後 limit 件を確保)
      const requiredNativeBars = limit * plan.factor;
      // 週末・休場日を含めて余裕を持って取得 (FX は週末 ~2 日 / 計 7 日中 5 営業日 ≈ 2.4x が安全)。
      // ただし limit が小さい (例 limit=1) や週末・連休 (FX は土日閉場) では直近窓が空になり
      // 0 件が返る。例: 土曜に XAUUSD 1m を要求すると EODHD の配信は金曜午前止まりで直近 12h に
      // bar が無く、チャートが描けない (2026-06-06 実機で確認)。最低 7 日の窓を保証して、週末・
      // 連休・配信遅延でも直近営業日のバーを確実に拾う (取得後 slice(-limit) で件数は絞る)。
      const MIN_INTRADAY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
      const lookbackMs = Math.max(requiredNativeBars * nativeTfMs * 2.5, MIN_INTRADAY_LOOKBACK_MS);
      const toSec = Math.floor(Date.now() / 1000);
      const fromSec = toSec - Math.ceil(lookbackMs / 1000);

      const raw = await this.client!.intraday(providerSymbol, {
        interval: plan.interval,
        from: fromSec,
        to: toSec,
      });

      // Copilot review (PR #245) 指摘: EODHD intraday の SDK 返却順は仕様で保証されていないため、
      // factor=1 (native) 経路でも明示的に timestamp 昇順にソートしてから slice する。
      // 集約経路 (factor>1) は aggregateOHLCV() 内で sort 済のため不要。
      const nativeBars = raw.map((p) => this.intradayPointToBar(p));
      let aggregated =
        plan.factor === 1
          ? [...nativeBars].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
          : aggregateOHLCV(nativeBars, TIMEFRAME_MS[timeframe]);

      // フォールバック: EODHD は一部銘柄 (例 XAUUSD/ゴールド) で 1m 以外の intraday が空を返す。
      // native 取得が空なら 1m を取得して目的の timeframe に集約し直す。
      if (aggregated.length === 0 && plan.interval !== '1m') {
        aggregated = await this.fetchOneMinuteAggregated(providerSymbol, timeframe, limit);
      }

      const limited = aggregated.slice(-limit);
      return {
        symbol,
        timeframe,
        bars: limited,
        provider: this.name,
        fetchedAt: new Date(),
      };
    }

    // eod 経路 (1d / 1w)
    const daysPerBar = plan.period === 'w' ? 7 : 1;
    const requiredDays = limit * daysPerBar;
    // 株式・FX は土日休場 / 祝日もあるため 1.6x の安全係数で from を計算
    const lookbackDays = Math.ceil(requiredDays * 1.6);
    const from = formatDateOnly(new Date(Date.now() - lookbackDays * TIMEFRAME_MS['1d']));
    const to = formatDateOnly(new Date());

    const raw = await this.client!.eod(providerSymbol, {
      period: plan.period,
      from,
      to,
      order: 'a',
    });

    const bars = raw.map((p) => this.eodPointToBar(p));
    const limited = bars.slice(-limit);
    return {
      symbol,
      timeframe,
      bars: limited,
      provider: this.name,
      fetchedAt: new Date(),
    };
  }

  async getCurrentPrice(symbol: string, timeframe: Timeframe): Promise<OHLCVBar | null> {
    const result = await this.getHistoricalData(symbol, timeframe, 1);
    return result.bars[result.bars.length - 1] ?? null;
  }

  /**
   * 期間指定でヒストリカル OHLCV を取得 (バックテストキャッシュ用)。
   *
   * `getHistoricalData(limit)` は最新側起点で固定本数を取得するが、
   * バックテストでは特定期間 [from, to] の全 bar が必要 (= `fetchAndCacheOhlcv` 用途)。
   * 本メソッドはその用途専用で、IMarketDataProvider インターフェースには含めない
   * (cTrader 等の他 Provider は別経路を持つため)。
   */
  async getHistoricalRange(
    symbol: string,
    timeframe: Timeframe,
    fromDate: Date,
    toDate: Date,
  ): Promise<MarketDataResult> {
    this.ensureClient();
    const providerSymbol = this.toProviderSymbol(symbol);
    const plan = planEodhdFetch(timeframe);

    if (plan.kind === 'intraday') {
      const fromSec = Math.floor(fromDate.getTime() / 1000);
      const toSec = Math.floor(toDate.getTime() / 1000);

      const raw = await this.client!.intraday(providerSymbol, {
        interval: plan.interval,
        from: fromSec,
        to: toSec,
      });

      // Copilot review (PR #245) 指摘: SDK 返却順が保証されないため、factor=1 経路も明示 sort。
      // 集約経路 (factor>1) は aggregateOHLCV() 内で sort 済。
      const nativeBars = raw.map((p) => this.intradayPointToBar(p));
      let aggregated =
        plan.factor === 1
          ? [...nativeBars].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
          : aggregateOHLCV(nativeBars, TIMEFRAME_MS[timeframe]);

      // フォールバック: native intraday が空の銘柄 (例 XAUUSD) は 1m を取得して集約し直す。
      if (aggregated.length === 0 && plan.interval !== '1m') {
        const rawOneMin = await this.client!.intraday(providerSymbol, {
          interval: '1m',
          from: fromSec,
          to: toSec,
        });
        // 1m も空 / 想定外レスポンスの場合に備えて防御 (fetchOneMinuteAggregated と同様)
        const oneMinBars = (rawOneMin ?? []).map((p) => this.intradayPointToBar(p));
        aggregated = aggregateOHLCV(oneMinBars, TIMEFRAME_MS[timeframe]);
      }

      // 集約後にレンジ内に絞り込む (= バケット端で範囲外に出ることがあるため)
      const inRange = aggregated.filter(
        (b) => b.timestamp >= fromDate && b.timestamp <= toDate,
      );

      return {
        symbol,
        timeframe,
        bars: inRange,
        provider: this.name,
        fetchedAt: new Date(),
      };
    }

    const raw = await this.client!.eod(providerSymbol, {
      period: plan.period,
      from: formatDateOnly(fromDate),
      to: formatDateOnly(toDate),
      order: 'a',
    });

    const bars = raw
      .map((p) => this.eodPointToBar(p))
      .filter((b) => b.timestamp >= fromDate && b.timestamp <= toDate);

    return {
      symbol,
      timeframe,
      bars,
      provider: this.name,
      fetchedAt: new Date(),
    };
  }

  /**
   * 1m intraday を取得して目的の timeframe に集約するフォールバック。
   *
   * EODHD は一部銘柄 (確認済み: XAUUSD/ゴールド) で 5m / 15m / 30m / 1h / 4h の
   * intraday が空配列を返すが、1m は配信されている。native 取得が空のときに本メソッドで
   * 1m から再構築することで、全銘柄でチャートが表示できるようにする。
   *
   * 取得レンジは目的バー数ぶん + 安全係数 2.5。ただし 1m の過大取得を避けるため 60 日で上限。
   */
  private async fetchOneMinuteAggregated(
    providerSymbol: string,
    timeframe: Timeframe,
    limit: number,
  ): Promise<OHLCVBar[]> {
    const targetMs = TIMEFRAME_MS[timeframe];
    const MAX_LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000; // 60 日
    // 最低 7 日の窓を保証 (週末・連休・配信遅延で直近窓が空になり 0 件が返るのを防ぐ。
    // getHistoricalData と同じ理由。MAX_LOOKBACK_MS=60日 を超えない)。
    const MIN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
    const lookbackMs = Math.min(
      Math.max(limit * targetMs * 2.5, MIN_LOOKBACK_MS),
      MAX_LOOKBACK_MS,
    );
    const toSec = Math.floor(Date.now() / 1000);
    const fromSec = toSec - Math.ceil(lookbackMs / 1000);

    const raw = await this.client!.intraday(providerSymbol, {
      interval: '1m',
      from: fromSec,
      to: toSec,
    });
    // 1m もデータが無い場合 (真に空 / 想定外レスポンス) は空配列で安全に返す
    const oneMinBars = (raw ?? []).map((p) => this.intradayPointToBar(p));
    return aggregateOHLCV(oneMinBars, targetMs);
  }

  /**
   * intraday data point → OHLCVBar 変換。
   *
   * EODHD intraday は `timestamp` (Unix epoch 秒) と `datetime` (UTC 文字列) を持つが、
   * timestamp の方が原本に近いため、こちらを Date に変換する。
   */
  private intradayPointToBar(p: IntradayDataPoint): OHLCVBar {
    return {
      timestamp: new Date(p.timestamp * 1000),
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume ?? 0,
    };
  }

  /**
   * eod data point → OHLCVBar 変換。
   *
   * `adjusted_close` は分割・配当調整済の値。バックテストでは生の close を使うのが慣例
   * (= cTrader / Twelve Data と整合) のため、close は無調整値をそのまま使う。
   */
  private eodPointToBar(p: EodDataPoint): OHLCVBar {
    // EODHD eod の date は 'YYYY-MM-DD' 形式。UTC 00:00 として解釈する
    // (Twelve Data / cTrader の 1d バーの timestamp と互換性を保つため)
    return {
      timestamp: new Date(`${p.date}T00:00:00.000Z`),
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume ?? 0,
    };
  }

  private ensureClient(): void {
    if (!this.client) {
      throw new Error(
        'EodhdProvider: EODHD_API_KEY が未設定のため REST API を利用できません',
      );
    }
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
