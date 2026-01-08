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

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CTraderAuthService } from '../ctrader/ctraderAuthService';
import { RealtimeTickService, getRealtimeTickService, TickDataInput, OHLCVBarInput } from './realtimeTickService';
import { config } from '../../../config';

// cTrader Layer ライブラリ（型定義なし）
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CTraderConnection } = require('@reiryoku/ctrader-layer');

// ========================================
// 型定義
// ========================================

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
  barIntervalSeconds: 10,
};

// ========================================
// CTraderRealtimeOrchestrator クラス
// ========================================

export class CTraderRealtimeOrchestrator extends EventEmitter {
  private prisma: PrismaClient;
  private authService: CTraderAuthService;
  private tickService: RealtimeTickService;
  private config: OrchestratorConfig;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private connection: any = null;
  private status: ConnectionStatus = 'disconnected';
  private subscribedSymbols: Set<string> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private ctidTraderAccountId: number | null = null;
  private tickLogCount = 0;

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
   */
  async connect(): Promise<boolean> {
    if (this.status === 'connected' || this.status === 'connecting') {
      console.log('[CTraderOrchestrator] 既に接続中または接続済みです');
      return this.status === 'connected';
    }

    this.setStatus('connecting');

    try {
      // 1. トークンを取得
      const token = await this.authService.getValidToken();
      if (!token) {
        throw new Error('有効な cTrader トークンがありません。認証が必要です。');
      }

      console.log('[CTraderOrchestrator] トークン取得成功');

      // 2. WebSocket 接続
      this.connection = new CTraderConnection({
        host: 'live.ctraderapi.com',
        port: 5035,
      });

      await this.connection.open();
      console.log('[CTraderOrchestrator] WebSocket 接続成功');

      this.setStatus('authenticating');

      // 3. アプリケーション認証
      await this.connection.sendCommand('ProtoOAApplicationAuthReq', {
        clientId: config.ctrader.clientId,
        clientSecret: config.ctrader.clientSecret,
      });
      console.log('[CTraderOrchestrator] アプリケーション認証成功');

      // 4. アカウント一覧を取得
      const accountListRes = await this.connection.sendCommand('ProtoOAGetAccountListByAccessTokenReq', {
        accessToken: token.accessToken,
      });

      const accounts = accountListRes.ctidTraderAccount || [];
      if (accounts.length === 0) {
        throw new Error('cTrader アカウントが見つかりません');
      }

      // 最初のアカウントを使用
      this.ctidTraderAccountId = accounts[0].ctidTraderAccountId;
      console.log('[CTraderOrchestrator] アカウント取得:', this.ctidTraderAccountId);

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
      await this.authService.updateLastConnected(token.accountId);

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
        });

        const symbolInfo = symbolsRes.symbol?.find((s: { symbolName: string }) => 
          s.symbolName === symbol || s.symbolName === symbol.replace('/', '')
        );

        if (!symbolInfo) {
          console.warn(`[CTraderOrchestrator] シンボルが見つかりません: ${symbol}`);
          continue;
        }

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
   * 最新の OHLCV バーを取得
   */
  async getRecentBars(symbol: string, limit: number = 60): Promise<OHLCVBarInput[]> {
    const timeframe = `${this.config.barIntervalSeconds}s`;
    return this.tickService.getRecentBars(symbol, timeframe, limit);
  }

  /**
   * 進行中のバーを取得
   */
  getPendingBar(symbol: string): unknown {
    const timeframe = `${this.config.barIntervalSeconds}s`;
    return this.tickService.getPendingBar(symbol, timeframe);
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

    // Tick イベント
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.connection.on('ProtoOASpotEvent', (event: any) => {
      // symbolId からシンボル名を解決（簡略化: 購読中のシンボルを使用）
      const symbol = Array.from(this.subscribedSymbols)[0] || 'UNKNOWN';
      
      // cTrader API は bid/ask を pipettes 形式（整数）で返す
      // XAUUSD の場合: 実際の価格 * 100 (例: 2650.50 → 265050)
      // 通貨ペアの場合: 実際の価格 * 100000 (例: 1.08500 → 108500)
      const rawBid = event.bid;
      const rawAsk = event.ask;
      
      // bid または ask が存在しない場合はスキップ
      if (rawBid === undefined && rawAsk === undefined) {
        return;
      }

      // シンボルに応じた変換係数を決定
      // XAUUSD, XAGUSD などの貴金属は小数点2桁
      // 通貨ペアは小数点5桁（JPY ペアは3桁）
      let divisor = 100000; // デフォルト: 通貨ペア
      if (symbol.startsWith('XAU') || symbol.startsWith('XAG')) {
        divisor = 100; // 貴金属
      } else if (symbol.includes('JPY')) {
        divisor = 1000; // JPY ペア
      }

      const bid = (rawBid || rawAsk || 0) / divisor;
      const ask = (rawAsk || rawBid || 0) / divisor;
      
      // デバッグログ（最初の数回のみ）
      if (!this.tickLogCount) this.tickLogCount = 0;
      if (this.tickLogCount < 5) {
        console.log(`[CTraderOrchestrator] Tick: ${symbol} raw=${rawBid}/${rawAsk} → bid=${bid} ask=${ask}`);
        this.tickLogCount++;
      }
      
      const tick: TickDataInput = {
        symbol,
        timestamp: new Date(event.timestamp || Date.now()),
        bid,
        ask,
        mid: (bid + ask) / 2,
        spread: ask - bid,
      };

      this.tickService.processTick(tick).catch(err => {
        console.error('[CTraderOrchestrator] Tick 処理エラー:', err);
      });
    });

    // 切断イベント
    this.connection.on('close', () => {
      console.log('[CTraderOrchestrator] 接続が切断されました');
      this.setStatus('disconnected');
      this.scheduleReconnect();
    });

    // エラーイベント
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.connection.on('error', (error: any) => {
      console.error('[CTraderOrchestrator] WebSocket エラー:', error);
      this.setStatus('error');
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.connection) {
        try {
          this.connection.sendHeartbeat();
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
      this.connect().catch(err => {
        console.error('[CTraderOrchestrator] 再接続エラー:', err);
      });
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

  const barInterval = config?.barIntervalSeconds || 10;

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

