/**
 * EODHD リアルタイムオーケストレーター (Phase A A-13、2026-05-21)
 *
 * 目的: EODHD WebSocket 接続と RealtimeTickService を統合し、
 *       リアルタイムマーケットデータの取得・配信を管理する。
 *
 * 旧 CTraderRealtimeOrchestrator の置き換え (Side-A 経路のみ)。
 * 認証は EODHD_API_KEY 1 トークン共通のため userId は無関係
 * (互換性のため引数は受け取るが内部で参照しない)。
 *
 * 関連: docs/architecture/EODHD_PHASE_A_WBS.md PR #3 A-13
 */

import type { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import type {
  RealtimeTickService,
  TickDataInput,
  OHLCVBarInput,
  PendingBar,
} from './realtimeTickService';
import { getRealtimeTickService } from './realtimeTickService';
import { EodhdProvider } from '../../../infrastructure/market/EodhdProvider';
import type {
  ConnectionState,
  TickData,
} from '../../../infrastructure/market/IMarketDataProvider';

/**
 * 接続状態 (旧 CTraderRealtimeOrchestrator と shape を揃えて呼び出し側互換を保つ)
 */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'error';

interface OrchestratorConfig {
  /** バーの時間窓 (秒)。フロント側 timeframe (10/60/300 等) と一致 */
  barIntervalSeconds: number;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  barIntervalSeconds: 60,
};

function mapProviderState(state: ConnectionState): ConnectionStatus {
  switch (state) {
    case 'connecting':
    case 'reconnecting':
      return 'connecting';
    case 'connected':
      return 'connected';
    case 'error':
      return 'error';
    case 'disconnected':
    default:
      return 'disconnected';
  }
}

export class EodhdRealtimeOrchestrator extends EventEmitter {
  private prisma: PrismaClient;
  private provider: EodhdProvider;
  private tickService: RealtimeTickService;
  private config: OrchestratorConfig;
  private status: ConnectionStatus = 'disconnected';
  private subscribedSymbols: Set<string> = new Set();

  constructor(prisma: PrismaClient, config: Partial<OrchestratorConfig> = {}) {
    super();
    this.prisma = prisma;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.provider = new EodhdProvider({ feed: 'forex' });
    this.tickService = getRealtimeTickService(this.prisma);

    // RealtimeTickService の event を re-emit (旧 ctrader 版と同じ contract)
    this.tickService.on('tick', (tick: TickDataInput) => this.emit('tick', tick));
    this.tickService.on('bar', (bar: OHLCVBarInput) => this.emit('bar', bar));
    this.tickService.on('pendingBar', (bar: PendingBar) => this.emit('pendingBar', bar));

    this.provider.onConnectionStateChange((state) => {
      this.setStatus(mapProviderState(state));
    });
  }

  /**
   * 接続を確立
   *
   * `userId` は旧 CTraderRealtimeOrchestrator との互換性のため受け取るが、
   * EODHD は API トークン共通認証のため内部で参照しない。
   */
  async connect(_userId: string): Promise<boolean> {
    void _userId;
    this.setStatus('connecting');
    const ok = await this.provider.connect();
    if (!ok) {
      this.setStatus('error');
      return false;
    }
    this.setStatus('connected');
    return true;
  }

  async disconnect(): Promise<void> {
    await this.provider.disconnect();
    this.subscribedSymbols.clear();
    this.setStatus('disconnected');
  }

  async subscribe(symbols: string[]): Promise<void> {
    for (const s of symbols) this.subscribedSymbols.add(s);
    await this.provider.subscribeToTicks(symbols, (tick) => {
      this.handleProviderTick(tick).catch((err) => {
        console.error('[EodhdOrchestrator] processTick エラー:', err);
      });
    });
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    for (const s of symbols) this.subscribedSymbols.delete(s);
    await this.provider.unsubscribeFromTicks(symbols);
  }

  /**
   * 直近の確定バーを取得
   *
   * Phase A: tickService からのみ取得 (リアルタイム蓄積分)。
   * Phase B で EODHD Intraday API による補完を予定 (= 別プラン契約後)。
   */
  async getRecentBars(symbol: string, limit = 60): Promise<OHLCVBarInput[]> {
    const timeframe = `${this.config.barIntervalSeconds}s`;
    const pending = this.tickService.getPendingBar(symbol, timeframe);
    const referencePrice = pending?.close;
    return this.tickService.getRecentBars(symbol, timeframe, limit, referencePrice);
  }

  getPendingBar(symbol: string): PendingBar | undefined {
    const timeframe = `${this.config.barIntervalSeconds}s`;
    return this.tickService.getPendingBar(symbol, timeframe);
  }

  clearPendingBar(symbol: string): void {
    const timeframe = `${this.config.barIntervalSeconds}s`;
    this.tickService.clearPendingBar(symbol, timeframe);
  }

  clearAllPendingBars(): void {
    this.tickService.clearAllPendingBars();
  }

  async deleteAnomalousBars(symbol: string): Promise<number> {
    const timeframe = `${this.config.barIntervalSeconds}s`;
    return this.tickService.deleteAnomalousBarsFromDB(symbol, timeframe);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getSubscribedSymbols(): string[] {
    return Array.from(this.subscribedSymbols);
  }

  // ===========================================
  // 内部メソッド
  // ===========================================

  private async handleProviderTick(tick: TickData): Promise<void> {
    // EodhdProvider が forex feed の last price を bid/ask/mid 同値に正規化済 (spread=0)。
    // RealtimeTickService.processTick は positive number と nonnegative spread を Zod で検証する。
    if (
      !Number.isFinite(tick.bid) ||
      !Number.isFinite(tick.ask) ||
      !Number.isFinite(tick.mid) ||
      tick.bid <= 0 ||
      tick.ask <= 0 ||
      tick.mid <= 0
    ) {
      return;
    }
    const tickInput: TickDataInput = {
      symbol: tick.symbol,
      timestamp: tick.timestamp,
      bid: tick.bid,
      ask: tick.ask,
      mid: tick.mid,
      spread: tick.spread,
    };
    await this.tickService.processTick(tickInput);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.emit('statusChange', status);
  }
}

// ===========================================
// Singleton
// ===========================================

let _instance: EodhdRealtimeOrchestrator | null = null;

/**
 * シングルトン取得 (旧 getCTraderRealtimeOrchestrator と shape を揃える)
 */
export function getEodhdRealtimeOrchestrator(
  prisma: PrismaClient,
  config?: Partial<OrchestratorConfig>,
): EodhdRealtimeOrchestrator {
  if (!_instance) {
    _instance = new EodhdRealtimeOrchestrator(prisma, config);
  }
  return _instance;
}

/** テスト用に singleton をリセット */
export function __resetEodhdOrchestratorForTesting(): void {
  _instance = null;
}
