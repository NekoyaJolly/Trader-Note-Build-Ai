/**
 * cTrader リアルタイムオーケストレーター
 * 
 * 目的: cTrader WebSocket 接続と RealtimeTickService を統合し、
 *       リアルタイムマーケットデータの取得・処理・配信を管理
 * 
 * 責務:
 * - cTrader 認証・接続管理
 * - シンボル購読管理
 * - Tick データの RealtimeTickService への橋渡し
 * - 接続状態の監視・自動再接続
 */

import type { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CTraderAuthService } from '../ctrader/ctraderAuthService';
import type { RealtimeTickService, TickDataInput, OHLCVBarInput } from './realtimeTickService';
import { getRealtimeTickService } from './realtimeTickService';
import { getCloseStats, looksLikeMisScaledBars } from './realtimeSanity';
import { config } from '../../../config';
import type { CTraderConnectionType } from '../ctrader/types/connection';
import type {
  CTraderSymbolInfo,
  CTraderSpotEvent} from '../../../schemas/external/ctrader';
import { 
  CTraderAccount,
  CTraderAccountListResponse,
  CTraderAccountListResponseSchema
} from '../../../schemas/external/ctrader';

// cTrader Layer ライブラリ（型定義なし）
// @reiryoku/ctrader-layer は型定義がないため、型定義は types/connection.ts で提供
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CTraderConnection } = require('@reiryoku/ctrader-layer');

// ========================================
// 型定義
// ========================================

/**
 * cTrader トレンドバー
 */
interface CTraderTrendbar {
  low: string | number;
  deltaOpen: string | number;
  deltaHigh: string | number;
  deltaClose: string | number;
  volume?: string | number;
  utcTimestampInMinutes?: number;
}

/**
 * cTrader API レスポンス（シンボル一覧）
 */
interface CTraderSymbolsListResponse {
  symbol?: CTraderSymbolInfo[];
}

/**
 * cTrader API レスポンス（トレンドバー）
 */
interface CTraderTrendbarsResponse {
  trendbar?: CTraderTrendbar[];
}

/**
 * 接続状態
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error';

/**
 * オーケストレーター設定
 */
interface OrchestratorConfig {
  /** 自動再接続を有効にするか */
  autoReconnect: boolean;
  /** 再接続の最大試行回数 */
  maxReconnectAttempts: number;
  /** 再接続の基本遅延（ミリ秒） */
  reconnectBaseDelay: number;
  /** ハートビート間隔（ミリ秒） */
  heartbeatInterval: number;
  /** バーの時間窓（秒） */
  barIntervalSeconds: number;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  autoReconnect: true,
  maxReconnectAttempts: 10,
  reconnectBaseDelay: 1000,
  heartbeatInterval: 25000,
  barIntervalSeconds: 60, // 1分足がデフォルト
};

// cTrader API の時間足定数（ProtoOATrendbarPeriod）
const TRENDBAR_PERIOD = {
  M1: 1,   // 1分
  M2: 2,   // 2分
  M3: 3,   // 3分
  M4: 4,   // 4分
  M5: 5,   // 5分
  M10: 6,  // 10分
  M15: 7,  // 15分
  M30: 8,  // 30分
  H1: 9,   // 1時間
  H4: 10,  // 4時間
  H12: 11, // 12時間
  D1: 12,  // 1日
} as const;

/**
 * 秒数からcTrader APIの時間足定数に変換
 */
function secondsToTrendbarPeriod(seconds: number): number {
  switch (seconds) {
    case 60: return TRENDBAR_PERIOD.M1;
    case 120: return TRENDBAR_PERIOD.M2;
    case 180: return TRENDBAR_PERIOD.M3;
    case 240: return TRENDBAR_PERIOD.M4;
    case 300: return TRENDBAR_PERIOD.M5;
    case 600: return TRENDBAR_PERIOD.M10;
    case 900: return TRENDBAR_PERIOD.M15;
    case 1800: return TRENDBAR_PERIOD.M30;
    case 3600: return TRENDBAR_PERIOD.H1;
    case 14400: return TRENDBAR_PERIOD.H4;
    case 43200: return TRENDBAR_PERIOD.H12;
    case 86400: return TRENDBAR_PERIOD.D1;
    default: return TRENDBAR_PERIOD.M1; // デフォルトは1分
  }
}

// ========================================
// CTraderRealtimeOrchestrator クラス
// ========================================

export class CTraderRealtimeOrchestrator extends EventEmitter {
  private prisma: PrismaClient;
  private authService: CTraderAuthService;
  private tickService: RealtimeTickService;
  private config: OrchestratorConfig;

  private connection: CTraderConnectionType | null = null;
  private status: ConnectionStatus = 'disconnected';
  private subscribedSymbols: Set<string> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private ctidTraderAccountId: number | null = null;
  private currentUserId: string | null = null; // 再接続用にuserIdを保存
  private tickLogCount = 0;
  // 直近の正常価格（片側欠損Tickの補完/検証に使用）
  private lastGoodMidBySymbol: Map<string, { mid: number; timestampMs: number }> = new Map();
  // ログのスパム防止（異常Tickスキップ用）
  private tickSkipLogBySymbol: Map<string, { lastLoggedAtMs: number; suppressedCount: number }> = new Map();
  
  // シンボル情報のキャッシュ（価格変換用）
  private symbolInfoCache: Map<number, { symbolName: string; digits: number; pipPosition: number }> = new Map();
  // シンボル名 → symbolId のマッピング
  private symbolNameToId: Map<string, number> = new Map();

  /**
   * 異常Tickスキップのログをスパムしないためのヘルパー
   */
  private logSkippedTick(symbol: string, mid: number, referenceMid: number | undefined, reason: string): void {
    const now = Date.now();
    const state = this.tickSkipLogBySymbol.get(symbol) ?? { lastLoggedAtMs: 0, suppressedCount: 0 };

    // 5秒以内の連続ログは抑制
    if (now - state.lastLoggedAtMs < 5000) {
      state.suppressedCount++;
      this.tickSkipLogBySymbol.set(symbol, state);
      return;
    }

    const suppressed = state.suppressedCount;
    state.lastLoggedAtMs = now;
    state.suppressedCount = 0;
    this.tickSkipLogBySymbol.set(symbol, state);

    const refText = referenceMid !== undefined && Number.isFinite(referenceMid) ? referenceMid.toFixed(5) : 'N/A';
    const suffix = suppressed > 0 ? `（直近5秒で ${suppressed} 件のスキップログを抑制）` : '';
    console.warn(`[CTraderOrchestrator] Tickをスキップ: ${symbol} mid=${mid.toFixed(5)} ref=${refText} ${reason} ${suffix}`);
  }

  constructor(prisma: PrismaClient, config: Partial<OrchestratorConfig> = {}) {
    super();
    this.prisma = prisma;
    this.authService = new CTraderAuthService(prisma);
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tickService = getRealtimeTickService(prisma, {
      barIntervalSeconds: this.config.barIntervalSeconds,
    });

    // TickService のイベントを転送
    this.tickService.on('tick', (tick: TickDataInput) => this.emit('tick', tick));
    this.tickService.on('bar', (bar: OHLCVBarInput) => this.emit('bar', bar));
    this.tickService.on('pendingBar', (bar: unknown) => this.emit('pendingBar', bar));
  }

  /**
   * 現在の接続状態を取得
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * 購読中のシンボルを取得
   */
  getSubscribedSymbols(): string[] {
    return Array.from(this.subscribedSymbols);
  }

  /**
   * cTrader に接続してリアルタイムデータ受信を開始
   *
   * @param userId - 接続するユーザーID
   */
  async connect(userId: string): Promise<boolean> {
    if (this.status === 'connected' || this.status === 'connecting') {
      console.log('[CTraderOrchestrator] 既に接続中または接続済みです');
      return this.status === 'connected';
    }

    // 再接続用に userId を保存
    this.currentUserId = userId;
    this.setStatus('connecting');

    try {
      // 1. userId から CTraderToken を取得
      const token = await this.prisma.cTraderToken.findFirst({
        where: { userId },
        orderBy: { lastConnectedAt: 'desc' },
      });

      if (!token) {
        throw new Error('cTraderトークンが見つかりません。認証が必要です。');
      }

      // トークンの有効性をチェック
      if (new Date(token.expiresAt) < new Date()) {
        throw new Error('cTraderトークンの有効期限が切れています。再認証が必要です。');
      }

      console.log('[CTraderOrchestrator] トークン取得成功');

      // 2. まずLive環境で接続を試みる（アカウント情報を取得するため）
      // アカウントがDemoの場合は、後でDemo環境に再接続する
      let connectionHost = config.ctrader.wsLiveHost;
      let isLiveEnvironment = true;

      // 2-1. Live環境でWebSocket接続
      this.connection = new CTraderConnection({
        host: connectionHost,
        port: config.ctrader.wsPort,
      }) as CTraderConnectionType;

      await this.connection.open();
      console.log('[CTraderOrchestrator] WebSocket 接続成功 (Live環境)');

      this.setStatus('authenticating');

      // 2-2. アプリケーション認証
      await this.connection.sendCommand('ProtoOAApplicationAuthReq', {
        clientId: config.ctrader.clientId,
        clientSecret: config.ctrader.clientSecret,
      });
      console.log('[CTraderOrchestrator] アプリケーション認証成功');

      // 2-3. アカウント一覧を取得して環境を確認（Zodバリデーション付き）
      const accountListRaw = await this.connection.sendCommand('ProtoOAGetAccountListByAccessTokenReq', {
        accessToken: token.accessToken,
      });

      const parseResult = CTraderAccountListResponseSchema.safeParse(accountListRaw);
      if (!parseResult.success) {
        console.error('[CTraderOrchestrator] APIレスポンスのバリデーションエラー:', parseResult.error.format());
        throw new Error(`cTrader APIレスポンスが不正です: ${parseResult.error.message}`);
      }

      const accountListRes = parseResult.data;
      const accounts = accountListRes.ctidTraderAccount || [];
      if (accounts.length === 0) {
        throw new Error('cTrader アカウントが見つかりません');
      }

      // 最初のアカウントを使用
      const selectedAccount = accounts[0];
      this.ctidTraderAccountId = selectedAccount.ctidTraderAccountId;
      isLiveEnvironment = selectedAccount.isLive === true;

      console.log('[CTraderOrchestrator] アカウント取得:', {
        ctidTraderAccountId: this.ctidTraderAccountId,
        isLive: isLiveEnvironment,
        traderLogin: selectedAccount.traderLogin,
      });

      // 2-4. アカウントがDemo環境の場合は、Demo環境に再接続
      if (!isLiveEnvironment) {
        console.log('[CTraderOrchestrator] Demoアカウントを検出。Demo環境に再接続します...');
        await this.connection.close();
        connectionHost = config.ctrader.wsDemoHost;
        
        this.connection = new CTraderConnection({
          host: connectionHost,
          port: config.ctrader.wsPort,
        }) as CTraderConnectionType;

        await this.connection.open();
        console.log('[CTraderOrchestrator] WebSocket 接続成功 (Demo環境)');

        // Demo環境でもアプリケーション認証が必要
        await this.connection.sendCommand('ProtoOAApplicationAuthReq', {
          clientId: config.ctrader.clientId,
          clientSecret: config.ctrader.clientSecret,
        });
        console.log('[CTraderOrchestrator] アプリケーション認証成功 (Demo環境)');
      }

      // 5. アカウント認証
      await this.connection.sendCommand('ProtoOAAccountAuthReq', {
        ctidTraderAccountId: this.ctidTraderAccountId,
        accessToken: token.accessToken,
      });
      console.log('[CTraderOrchestrator] アカウント認証成功');

      // 6. イベントハンドラ設定
      this.setupEventHandlers();

      // 7. ハートビート開始
      this.startHeartbeat();

      // 8. TickService 開始
      this.tickService.start();

      this.setStatus('connected');
      this.reconnectAttempts = 0;

      // 最終接続日時を更新
      await this.prisma.cTraderToken.updateMany({
        where: { accountId: token.accountId },
        data: { lastConnectedAt: new Date() },
      });

      console.log('[CTraderOrchestrator] 接続完了');
      return true;

    } catch (error) {
      console.error('[CTraderOrchestrator] 接続エラー:', error);
      this.setStatus('error');
      this.scheduleReconnect();
      return false;
    }
  }

  /**
   * 切断
   */
  async disconnect(): Promise<void> {
    this.clearTimers();

    if (this.connection) {
      try {
        await this.connection.close();
      } catch (error) {
        console.error('[CTraderOrchestrator] 切断エラー:', error);
      }
      this.connection = null;
    }

    await this.tickService.stop();
    this.subscribedSymbols.clear();
    this.lastGoodMidBySymbol.clear();
    this.tickSkipLogBySymbol.clear();
    this.setStatus('disconnected');
    console.log('[CTraderOrchestrator] 切断完了');
  }

  /**
   * シンボルを購読
   */
  async subscribe(symbols: string[]): Promise<void> {
    if (this.status !== 'connected' || !this.connection || !this.ctidTraderAccountId) {
      throw new Error('cTrader に接続されていません');
    }

    for (const symbol of symbols) {
      if (this.subscribedSymbols.has(symbol)) {
        continue;
      }

      try {
        // シンボル情報を取得
        const symbolsRes = await this.connection.sendCommand('ProtoOASymbolsListReq', {
          ctidTraderAccountId: this.ctidTraderAccountId,
        }) as CTraderSymbolsListResponse;

        const symbols = (symbolsRes.symbol || []);
        const symbolInfo = symbols.find((s) => 
          s.symbolName === symbol || s.symbolName === symbol.replace('/', '')
        );

        if (!symbolInfo) {
          console.warn(`[CTraderOrchestrator] シンボルが見つかりません: ${symbol}`);
          continue;
        }

        // シンボル情報をキャッシュ（価格変換用）
        // digits: 価格の小数点以下桁数
        // pipPosition: pip の位置（例: XAUUSD は 2）
        const digits = symbolInfo.digits || 5;
        const pipPosition = symbolInfo.pipPosition || digits - 1;
        
        this.symbolInfoCache.set(symbolInfo.symbolId, {
          symbolName: symbol,
          digits,
          pipPosition,
        });
        this.symbolNameToId.set(symbol, symbolInfo.symbolId);
        
        console.log(`[CTraderOrchestrator] シンボル情報: ${symbol} ID=${symbolInfo.symbolId} digits=${digits} pipPosition=${pipPosition}`);

        // Tick 購読
        await this.connection.sendCommand('ProtoOASubscribeSpotsReq', {
          ctidTraderAccountId: this.ctidTraderAccountId,
          symbolId: [symbolInfo.symbolId],
        });

        this.subscribedSymbols.add(symbol);
        console.log(`[CTraderOrchestrator] ${symbol} (ID: ${symbolInfo.symbolId}) を購読開始`);

      } catch (error) {
        console.error(`[CTraderOrchestrator] ${symbol} 購読エラー:`, error);
      }
    }
  }

  /**
   * シンボルの購読を解除
   */
  async unsubscribe(symbols: string[]): Promise<void> {
    if (this.status !== 'connected' || !this.connection) {
      return;
    }

    for (const symbol of symbols) {
      if (!this.subscribedSymbols.has(symbol)) {
        continue;
      }

      // 購読解除処理（簡略化）
      this.subscribedSymbols.delete(symbol);
      console.log(`[CTraderOrchestrator] ${symbol} の購読を解除`);
    }
  }

  /**
   * 最新の OHLCV バーを取得（cTrader API から取得）
   */
  async getRecentBars(symbol: string, limit: number = 60): Promise<OHLCVBarInput[]> {
    // まずTickServiceから取得を試みる（リアルタイムで蓄積したデータ）
    const timeframe = `${this.config.barIntervalSeconds}s`;
    const pending = this.tickService.getPendingBar(symbol, timeframe);
    const referencePrice = pending?.close;
    const tickBars = await this.tickService.getRecentBars(symbol, timeframe, limit, referencePrice);
    
    // 十分なデータがあればそれを返す
    if (tickBars.length >= 10 && !looksLikeMisScaledBars(tickBars)) {
      return tickBars;
    }
    
    // 接続されていなければ空配列
    if (!this.connection || !this.ctidTraderAccountId) {
      return tickBars;
    }

    // DB側が怪しい場合はログしておく（スケール汚染の可能性）
    if (tickBars.length > 0) {
      const stats = getCloseStats(tickBars);
      if (looksLikeMisScaledBars(tickBars)) {
        console.warn(
          `[CTraderOrchestrator] DBバーが価格スケール異常の可能性: ${symbol} ${timeframe} ` +
          `close(median=${stats.median.toFixed(5)}, min=${stats.min.toFixed(5)}, max=${stats.max.toFixed(5)}) ` +
          `→ Trendbar にフォールバックします`
        );
      } else if (tickBars.length < 10) {
        console.log(
          `[CTraderOrchestrator] DBバー不足: ${symbol} ${timeframe} ${tickBars.length}本 ` +
          `→ Trendbar で補完します`
        );
      }
    }
    
    // cTrader API から過去データを取得
    try {
      const symbolId = this.symbolNameToId.get(symbol);
      if (!symbolId) {
        console.warn(`[CTraderOrchestrator] シンボルIDが見つかりません: ${symbol}`);
        return tickBars;
      }
      
      const period = secondsToTrendbarPeriod(this.config.barIntervalSeconds);
      const toTimestamp = Date.now();
      const fromTimestamp = toTimestamp - (limit * this.config.barIntervalSeconds * 1000);
      
      const res = await this.connection.sendCommand('ProtoOAGetTrendbarsReq', {
        ctidTraderAccountId: this.ctidTraderAccountId,
        symbolId,
        period,
        fromTimestamp,
        toTimestamp,
      }) as CTraderTrendbarsResponse;
      
      // cTrader Open API 仕様:
      // Trendbar の価格データも "1/100000 of unit of a price" 形式
      // low: int64 - Low price
      // deltaOpen: open = low + deltaOpen
      // deltaClose: close = low + deltaClose  
      // deltaHigh: high = low + deltaHigh
      const PRICE_DIVISOR = 100000;
      
      // デバッグ: 生データを確認
      if (res.trendbar && res.trendbar.length > 0) {
        const sample = res.trendbar[0];
        const sampleLow = Number(sample.low) / PRICE_DIVISOR;
        console.log(`[CTraderOrchestrator] Trendbar生データ: low=${sample.low}(=${sampleLow}), deltaOpen=${sample.deltaOpen}, deltaHigh=${sample.deltaHigh}, deltaClose=${sample.deltaClose}`);
      }
      
      const symbolInfo = this.symbolInfoCache.get(symbolId);
      const digits = symbolInfo?.digits || 2; // 表示用のdigits
      
      const trendbars = (res.trendbar || []);
      const bars: OHLCVBarInput[] = trendbars.map((bar) => {
        const low = Number(bar.low) / PRICE_DIVISOR;
        const open = (Number(bar.low) + Number(bar.deltaOpen)) / PRICE_DIVISOR;
        const high = (Number(bar.low) + Number(bar.deltaHigh)) / PRICE_DIVISOR;
        const close = (Number(bar.low) + Number(bar.deltaClose)) / PRICE_DIVISOR;
        
        return {
          symbol,
          timeframe,
          timestamp: new Date(Number(bar.utcTimestampInMinutes) * 60000),
          open,
          high,
          low,
          close,
          volume: Number(bar.volume) || 0,
          tickCount: 0,
        };
      });
      
      console.log(`[CTraderOrchestrator] cTrader API から ${bars.length} 本のバーを取得`);
      return bars;
    } catch (error) {
      console.error('[CTraderOrchestrator] 過去データ取得エラー:', error);
      return tickBars;
    }
  }

  /**
   * 進行中のバーを取得
   */
  getPendingBar(symbol: string): unknown {
    const timeframe = `${this.config.barIntervalSeconds}s`;
    return this.tickService.getPendingBar(symbol, timeframe);
  }

  /**
   * 進行中バーをクリア
   */
  clearPendingBar(symbol: string): void {
    const timeframe = `${this.config.barIntervalSeconds}s`;
    this.tickService.clearPendingBar(symbol, timeframe);
  }

  /**
   * 全ての進行中バーをクリア
   */
  clearAllPendingBars(): void {
    this.tickService.clearAllPendingBars();
  }

  /**
   * DBから異常バーを削除
   */
  async deleteAnomalousBars(symbol: string): Promise<number> {
    const timeframe = `${this.config.barIntervalSeconds}s`;
    return this.tickService.deleteAnomalousBarsFromDB(symbol, timeframe);
  }

  // ========================================
  // 内部メソッド
  // ========================================

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.emit('statusChange', status);
  }

  private setupEventHandlers(): void {
    if (!this.connection) return;

    console.log('[CTraderOrchestrator] イベントハンドラを設定中...');

    if (!this.connection) {
      throw new Error('[CTraderOrchestrator] 接続が確立されていません');
    }

    // 接続が確実に存在することをTypeScriptに伝える
    const connection = this.connection;

    // Tick イベント
    // ctrader-layer は CTraderLayerEvent オブジェクトを渡す
    // 実際のデータは event.descriptor に格納されている
    connection.on('ProtoOASpotEvent', (...args: unknown[]) => {
      // 型ガード: イベントデータを取得
      const rawEvent = args[0];
      if (!rawEvent || typeof rawEvent !== 'object') {
        return;
      }
      
      // CTraderLayerEvent の descriptor プロパティからデータを取得
      const eventWithDescriptor = rawEvent as { descriptor?: CTraderSpotEvent };
      const data = (eventWithDescriptor.descriptor || rawEvent) as CTraderSpotEvent;
      
      // デバッグログ（最初の数回のみ）
      if (this.tickLogCount < 5) {
        console.log(`[CTraderOrchestrator] SpotEvent descriptor: ${JSON.stringify(data).slice(0, 500)}`);
      }
      
      // symbolId からシンボル情報を取得
      const symbolId = data.symbolId;
      
      // symbolId が存在しない場合はスキップ
      if (symbolId === undefined) {
        return;
      }
      
      const symbolInfo = this.symbolInfoCache.get(symbolId);
      
      // シンボル情報がない場合はスキップ（シンボル名不明のため）
      if (!symbolInfo) {
        console.warn(`[CTraderOrchestrator] symbolId=${symbolId} のシンボル情報が見つかりません。スキップします。cache keys: [${Array.from(this.symbolInfoCache.keys()).join(', ')}]`);
        return;
      }
      
      const symbol = symbolInfo.symbolName;
      const digits = symbolInfo.digits;
      
      // cTrader Open API 仕様:
      // bid/ask は "Specified in 1/100000 of unit of a price"
      // 例: 123000 means 1.23, 53423782 means 534.23782
      // 常に 100000 (10^5) で除算する（digitsに関係なく）
      const PRICE_DIVISOR = 100000;
      
      // bid/ask は number の想定だが、ライブラリ都合で string 等の可能性もあるため Number() で正規化
      // さらに、cTrader/ライブラリ都合で「未更新」を 0 として送ってくるケースがあるため、0 は欠損扱いにする
      const rawBid0 = data.bid !== undefined ? Number(data.bid) : undefined;
      const rawAsk0 = data.ask !== undefined ? Number(data.ask) : undefined;
      
      // bid または ask が存在しない場合はスキップ
      if (rawBid0 === undefined && rawAsk0 === undefined) {
        return;
      }
      
      // 数値変換に失敗した場合はスキップ（NaN を弾く）
      if (
        (rawBid0 !== undefined && !Number.isFinite(rawBid0)) ||
        (rawAsk0 !== undefined && !Number.isFinite(rawAsk0))
      ) {
        console.warn(
          `[CTraderOrchestrator] Tick 価格の数値変換に失敗: ${symbol} rawBid=${String(data.bid)} rawAsk=${String(data.ask)}`
        );
        return;
      }

      // 0（または 0 以下）は価格として不正なので欠損扱いにする
      const rawBid = rawBid0 !== undefined && rawBid0 > 0 ? rawBid0 : undefined;
      const rawAsk = rawAsk0 !== undefined && rawAsk0 > 0 ? rawAsk0 : undefined;

      // 両方欠損ならスキップ
      if (rawBid === undefined && rawAsk === undefined) {
        return;
      }

      // sessionClose は「直近終値」相当の参照値として使える（価格スケール汚染の初期防止）
      const rawSessionClose0 = data.sessionClose !== undefined ? Number(data.sessionClose) : undefined;
      const rawSessionClose = rawSessionClose0 !== undefined && Number.isFinite(rawSessionClose0) && rawSessionClose0 > 0
        ? rawSessionClose0
        : undefined;
      const sessionCloseMid = rawSessionClose !== undefined ? rawSessionClose / PRICE_DIVISOR : undefined;

      // 価格変換: raw / 100000
      // 片側が欠損の場合は、もう片側で補完して「半値(mid=(x+0)/2)」が発生しないようにする
      const bid = rawBid !== undefined ? rawBid / PRICE_DIVISOR : (rawAsk as number) / PRICE_DIVISOR;
      const ask = rawAsk !== undefined ? rawAsk / PRICE_DIVISOR : (rawBid as number) / PRICE_DIVISOR;

      // 念のためスプレッドが負になる場合は補正（欠損補完や一時的な逆転を吸収）
      const safeBid = Math.min(bid, ask);
      const safeAsk = Math.max(bid, ask);
      const mid = (safeBid + safeAsk) / 2;

      // 片側欠損（補完Tick）かどうか
      const isSynthetic = rawBid === undefined || rawAsk === undefined;

      // 参照価格（優先: 直近の正常Tick、無ければ sessionClose）
      const lastGood = this.lastGoodMidBySymbol.get(symbol)?.mid;
      const referenceMid = lastGood ?? sessionCloseMid;

      // 初回で参照が無い補完Tickは受理しない（ここで受理すると誤値がバーに入って連鎖する）
      if (isSynthetic && referenceMid === undefined) {
        this.logSkippedTick(symbol, mid, referenceMid, '片側欠損Tick（参照価格未確立のためスキップ）');
        return;
      }

      // 参照価格がある場合、大きすぎる乖離は受理しない（初期汚染/突発0混入を防止）
      if (referenceMid !== undefined && Number.isFinite(referenceMid) && referenceMid > 0) {
        const deviation = Math.abs(mid - referenceMid) / referenceMid;
        // 30%以上のジャンプは、今回の用途（XAUUSD/FX短期）では異常として扱う
        if (deviation >= 0.3) {
          this.logSkippedTick(
            symbol,
            mid,
            referenceMid,
            `異常値っぽいTickをスキップ（乖離率=${(deviation * 100).toFixed(1)}%）`
          );
          return;
        }
      }
      
      // デバッグログ（最初の数回のみ）
      if (this.tickLogCount < 5) {
        const ts = Number(data.timestamp) || Date.now();
        console.log(
          `[CTraderOrchestrator] Tick: ${symbol} (symbolId=${symbolId} digits=${digits} pipPos=${symbolInfo.pipPosition}) ` +
          `raw=(${rawBid0}/${rawAsk0}) divisor=${PRICE_DIVISOR} ` +
          `→ bid=${safeBid.toFixed(digits)} ask=${safeAsk.toFixed(digits)} mid=${mid.toFixed(digits)} ` +
          `ts=${new Date(ts).toISOString()}`
        );
        this.tickLogCount++;
      }
      
      const tick: TickDataInput = {
        symbol,
        timestamp: new Date(Number(data.timestamp) || Date.now()),
        bid: safeBid,
        ask: safeAsk,
        mid,
        spread: safeAsk - safeBid,
      };

      this.tickService.processTick(tick).catch(err => {
        console.error('[CTraderOrchestrator] Tick 処理エラー:', err);
      });

      // 正常Tick（両側揃っている）のみを参照価格として更新する
      if (!isSynthetic && Number.isFinite(mid) && mid > 0) {
        this.lastGoodMidBySymbol.set(symbol, { mid, timestampMs: tick.timestamp.getTime() });
      }
    });

    // 切断イベント
    connection.on('close', () => {
      console.log('[CTraderOrchestrator] 接続が切断されました');
      this.setStatus('disconnected');
      this.scheduleReconnect();
    });

    // エラーイベント
    connection.on('error', (...args: unknown[]) => {
      const rawError = args[0];
      const error = rawError instanceof Error 
        ? rawError 
        : (typeof rawError === 'object' && rawError !== null 
          ? rawError as { message?: string; code?: string }
          : new Error(String(rawError)));
      console.error('[CTraderOrchestrator] WebSocket エラー:', error);
      this.setStatus('error');
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.connection) {
        try {
          this.connection.sendHeartbeat?.();
        } catch (error) {
          console.error('[CTraderOrchestrator] ハートビートエラー:', error);
        }
      }
    }, this.config.heartbeatInterval);
  }

  private scheduleReconnect(): void {
    if (!this.config.autoReconnect) return;
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[CTraderOrchestrator] 最大再接続試行回数に達しました');
      return;
    }

    const delay = Math.min(
      this.config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts),
      60000
    );

    console.log(`[CTraderOrchestrator] ${delay}ms 後に再接続を試行 (${this.reconnectAttempts + 1}/${this.config.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      // 保存された userId を使用して再接続
      if (this.currentUserId) {
        this.connect(this.currentUserId).catch(err => {
          console.error('[CTraderOrchestrator] 再接続エラー:', err);
        });
      } else {
        console.error('[CTraderOrchestrator] 再接続失敗: userId が保存されていません');
      }
    }, delay);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// 時間足ごとのインスタンス管理
const orchestratorInstances: Map<number, CTraderRealtimeOrchestrator> = new Map();
let defaultPrisma: PrismaClient | null = null;

/**
 * CTraderRealtimeOrchestrator を取得（時間足ごとに管理）
 * 
 * @param prisma - PrismaClient（初回のみ必要）
 * @param config - 設定（barIntervalSeconds で時間足を指定）
 */
export function getCTraderRealtimeOrchestrator(
  prisma?: PrismaClient,
  config?: Partial<OrchestratorConfig>
): CTraderRealtimeOrchestrator {
  // PrismaClient を保存
  if (prisma) {
    defaultPrisma = prisma;
  }

  const barInterval = config?.barIntervalSeconds || 60;

  // 既存インスタンスがあれば返す
  let instance = orchestratorInstances.get(barInterval);
  if (instance) {
    return instance;
  }

  // 新規作成
  const p = prisma || defaultPrisma;
  if (!p) {
    throw new Error('CTraderRealtimeOrchestrator の初期化には PrismaClient が必要です');
  }

  instance = new CTraderRealtimeOrchestrator(p, config);
  orchestratorInstances.set(barInterval, instance);
  return instance;
}

