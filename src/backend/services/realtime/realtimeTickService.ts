/**
 * リアルタイム Tick サービス
 * 
 * 目的: cTrader WebSocket から Tick データを受信し、
 *       DB 永続化 → OHLCV 変換 → UI へリアルタイム配信
 * 
 * フロー:
 * 1. cTrader WebSocket で Tick 受信
 * 2. TickData テーブルに永続化
 * 3. RollingWindowService で OHLCV に集約
 * 4. RealtimeOHLCV テーブルに永続化
 * 5. SSE で UI にリアルタイム配信
 * 
 * 参照: docs/realtime_similarity_notification_architecture.md
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { z } from 'zod';

// ========================================
// 型定義
// ========================================

/**
 * Tick データ型
 */
export const TickDataSchema = z.object({
  symbol: z.string(),
  timestamp: z.date(),
  bid: z.number(),
  ask: z.number(),
  mid: z.number(),
  spread: z.number(),
  volume: z.number().optional(),
});

export type TickDataInput = z.infer<typeof TickDataSchema>;

/**
 * OHLCV バー型
 */
export const OHLCVBarSchema = z.object({
  symbol: z.string(),
  timeframe: z.string(),
  timestamp: z.date(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  tickCount: z.number(),
});

export type OHLCVBarInput = z.infer<typeof OHLCVBarSchema>;

/**
 * 進行中のバー（まだ確定していない）
 */
interface PendingBar {
  symbol: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickCount: number;
  startTime: Date;
}

/**
 * サービス設定
 */
interface RealtimeTickServiceConfig {
  /** バーの時間窓（秒） */
  barIntervalSeconds: number;
  /** 最小 Tick 数（これ未満はバー生成しない） */
  minTicksPerBar: number;
  /** Tick 永続化を有効にするか */
  persistTicks: boolean;
  /** OHLCV 永続化を有効にするか */
  persistOHLCV: boolean;
  /** バッチ保存のサイズ */
  tickBatchSize: number;
}

const DEFAULT_CONFIG: RealtimeTickServiceConfig = {
  barIntervalSeconds: 10, // 10秒足
  minTicksPerBar: 1,
  persistTicks: true,
  persistOHLCV: true,
  tickBatchSize: 100,
};

// ========================================
// RealtimeTickService クラス
// ========================================

export class RealtimeTickService extends EventEmitter {
  private prisma: PrismaClient;
  private config: RealtimeTickServiceConfig;
  private pendingBars: Map<string, PendingBar> = new Map();
  private tickBuffer: TickDataInput[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private barTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(prisma: PrismaClient, config: Partial<RealtimeTickServiceConfig> = {}) {
    super();
    this.prisma = prisma;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * サービスを開始
   */
  start(): void {
    if (this.isRunning) {
      console.log('[RealtimeTickService] 既に実行中です');
      return;
    }

    this.isRunning = true;
    console.log('[RealtimeTickService] サービス開始:', {
      barInterval: `${this.config.barIntervalSeconds}秒`,
      persistTicks: this.config.persistTicks,
      persistOHLCV: this.config.persistOHLCV,
    });

    // バー確定タイマー開始
    this.startBarTimer();

    // Tick バッファフラッシュタイマー開始（5秒ごと）
    this.flushTimer = setInterval(() => {
      this.flushTickBuffer().catch(err => {
        console.error('[RealtimeTickService] Tick フラッシュエラー:', err);
      });
    }, 5000);
  }

  /**
   * サービスを停止
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.barTimer) {
      clearInterval(this.barTimer);
      this.barTimer = null;
    }

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // 残りの Tick をフラッシュ
    await this.flushTickBuffer();

    // 残りのバーを確定
    await this.flushAllBars();

    console.log('[RealtimeTickService] サービス停止');
  }

  /**
   * Tick データを処理
   * cTrader WebSocket からのコールバックで呼び出される
   */
  async processTick(tick: TickDataInput): Promise<void> {
    // バリデーション
    const result = TickDataSchema.safeParse(tick);
    if (!result.success) {
      console.error('[RealtimeTickService] Tick バリデーションエラー:', result.error);
      return;
    }

    const validTick = result.data;

    // 1. Tick イベントを発火（リアルタイム配信用）
    this.emit('tick', validTick);

    // 2. Tick バッファに追加（永続化用）
    if (this.config.persistTicks) {
      this.tickBuffer.push(validTick);
      if (this.tickBuffer.length >= this.config.tickBatchSize) {
        await this.flushTickBuffer();
      }
    }

    // 3. 進行中バーを更新
    this.updatePendingBar(validTick);
  }

  /**
   * 進行中のバーを取得（UI 表示用）
   */
  getPendingBar(symbol: string, timeframe: string): PendingBar | undefined {
    const key = `${symbol}:${timeframe}`;
    return this.pendingBars.get(key);
  }

  /**
   * 全ての進行中バーを取得
   */
  getAllPendingBars(): PendingBar[] {
    return Array.from(this.pendingBars.values());
  }

  // ========================================
  // 内部メソッド
  // ========================================

  /**
   * 進行中バーを更新
   */
  private updatePendingBar(tick: TickDataInput): void {
    const timeframe = `${this.config.barIntervalSeconds}s`;
    const key = `${tick.symbol}:${timeframe}`;
    
    // バー開始時刻を計算（時間窓の開始に揃える）
    const intervalMs = this.config.barIntervalSeconds * 1000;
    const barStartMs = Math.floor(tick.timestamp.getTime() / intervalMs) * intervalMs;
    const barStartTime = new Date(barStartMs);

    let pending = this.pendingBars.get(key);

    // 新しいバーを開始するか判定
    if (!pending || pending.startTime.getTime() !== barStartTime.getTime()) {
      // 既存のバーがあれば確定
      if (pending) {
        this.completeBar(pending);
      }

      // 新しいバーを開始
      pending = {
        symbol: tick.symbol,
        timeframe,
        open: tick.mid,
        high: tick.mid,
        low: tick.mid,
        close: tick.mid,
        volume: tick.volume || 0,
        tickCount: 1,
        startTime: barStartTime,
      };
      this.pendingBars.set(key, pending);
    } else {
      // 既存バーを更新
      pending.high = Math.max(pending.high, tick.mid);
      pending.low = Math.min(pending.low, tick.mid);
      pending.close = tick.mid;
      pending.volume += tick.volume || 0;
      pending.tickCount++;
    }

    // 進行中バーイベントを発火
    this.emit('pendingBar', pending);
  }

  /**
   * バーを確定
   */
  private async completeBar(pending: PendingBar): Promise<void> {
    // 最小 Tick 数チェック
    if (pending.tickCount < this.config.minTicksPerBar) {
      console.log(`[RealtimeTickService] ${pending.symbol}: Tick数不足 (${pending.tickCount}/${this.config.minTicksPerBar})`);
      return;
    }

    const bar: OHLCVBarInput = {
      symbol: pending.symbol,
      timeframe: pending.timeframe,
      timestamp: pending.startTime,
      open: pending.open,
      high: pending.high,
      low: pending.low,
      close: pending.close,
      volume: pending.volume,
      tickCount: pending.tickCount,
    };

    console.log(`[RealtimeTickService] バー確定: ${bar.symbol} ${bar.timeframe} O=${bar.open.toFixed(2)} H=${bar.high.toFixed(2)} L=${bar.low.toFixed(2)} C=${bar.close.toFixed(2)} V=${bar.volume} T=${bar.tickCount}`);

    // OHLCV イベントを発火（リアルタイム配信用）
    this.emit('bar', bar);

    // DB に永続化
    if (this.config.persistOHLCV) {
      try {
        await this.prisma.realtimeOHLCV.upsert({
          where: {
            symbol_timeframe_timestamp: {
              symbol: bar.symbol,
              timeframe: bar.timeframe,
              timestamp: bar.timestamp,
            },
          },
          update: {
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            tickCount: bar.tickCount,
          },
          create: {
            symbol: bar.symbol,
            timeframe: bar.timeframe,
            timestamp: bar.timestamp,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            tickCount: bar.tickCount,
          },
        });
      } catch (error) {
        console.error('[RealtimeTickService] OHLCV 永続化エラー:', error);
      }
    }
  }

  /**
   * Tick バッファを DB にフラッシュ
   */
  private async flushTickBuffer(): Promise<void> {
    if (this.tickBuffer.length === 0) return;

    const ticks = [...this.tickBuffer];
    this.tickBuffer = [];

    try {
      await this.prisma.tickData.createMany({
        data: ticks.map(t => ({
          symbol: t.symbol,
          timestamp: t.timestamp,
          bid: t.bid,
          ask: t.ask,
          mid: t.mid,
          spread: t.spread,
          volume: t.volume,
          source: 'ctrader',
        })),
        skipDuplicates: true,
      });
      console.log(`[RealtimeTickService] ${ticks.length} Tick を永続化`);
    } catch (error) {
      console.error('[RealtimeTickService] Tick 永続化エラー:', error);
      // 失敗した Tick をバッファに戻す（リトライ）
      this.tickBuffer.unshift(...ticks);
    }
  }

  /**
   * バー確定タイマーを開始
   */
  private startBarTimer(): void {
    // 1秒ごとに期限切れバーをチェック
    this.barTimer = setInterval(() => {
      const now = Date.now();
      const intervalMs = this.config.barIntervalSeconds * 1000;

      for (const [key, pending] of this.pendingBars.entries()) {
        const barEndMs = pending.startTime.getTime() + intervalMs;
        if (now >= barEndMs) {
          this.completeBar(pending);
          this.pendingBars.delete(key);
        }
      }
    }, 1000);
  }

  /**
   * 全ての進行中バーを確定
   */
  private async flushAllBars(): Promise<void> {
    for (const [key, pending] of this.pendingBars.entries()) {
      await this.completeBar(pending);
      this.pendingBars.delete(key);
    }
  }

  /**
   * 最新の OHLCV データを取得（UI 初期表示用）
   */
  async getRecentBars(symbol: string, timeframe: string, limit: number = 60): Promise<OHLCVBarInput[]> {
    const bars = await this.prisma.realtimeOHLCV.findMany({
      where: { symbol, timeframe },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return bars.map(b => ({
      symbol: b.symbol,
      timeframe: b.timeframe,
      timestamp: b.timestamp,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume),
      tickCount: b.tickCount,
    })).reverse();
  }

  /**
   * 最新の Tick データを取得
   */
  async getRecentTicks(symbol: string, limit: number = 100): Promise<TickDataInput[]> {
    const ticks = await this.prisma.tickData.findMany({
      where: { symbol },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return ticks.map(t => ({
      symbol: t.symbol,
      timestamp: t.timestamp,
      bid: Number(t.bid),
      ask: Number(t.ask),
      mid: Number(t.mid),
      spread: Number(t.spread),
      volume: t.volume ? Number(t.volume) : undefined,
    })).reverse();
  }
}

// 時間足ごとのインスタンス管理
const tickServiceInstances: Map<number, RealtimeTickService> = new Map();
let defaultTickPrisma: PrismaClient | null = null;

/**
 * RealtimeTickService を取得（時間足ごとに管理）
 */
export function getRealtimeTickService(
  prisma?: PrismaClient,
  config?: Partial<RealtimeTickServiceConfig>
): RealtimeTickService {
  // PrismaClient を保存
  if (prisma) {
    defaultTickPrisma = prisma;
  }

  const barInterval = config?.barIntervalSeconds || 10;

  // 既存インスタンスがあれば返す
  let instance = tickServiceInstances.get(barInterval);
  if (instance) {
    return instance;
  }

  // 新規作成
  const p = prisma || defaultTickPrisma;
  if (!p) {
    throw new Error('RealtimeTickService の初期化には PrismaClient が必要です');
  }

  instance = new RealtimeTickService(p, config);
  tickServiceInstances.set(barInterval, instance);
  return instance;
}

