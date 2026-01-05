/**
 * Rolling Window Service
 * 
 * 目的: リアルタイム Tick データを時間窓で OHLCV に集約
 * 
 * 機能:
 * - 設定可能な時間窓（デフォルト60秒）
 * - 複数シンボル対応
 * - 完了したバーのコールバック通知
 * - 部分バー（進行中）の取得
 * 
 * 使用例:
 *   const rolling = new RollingWindowService(60);
 *   rolling.onBarComplete((bar) => console.log(bar));
 *   rolling.addTick(tickData);
 * 
 * 参照: docs/realtime_similarity_notification_architecture.md
 */

import { z } from 'zod';
import { TickData, OHLCVBar, OHLCVBarSchema } from '../../infrastructure/market/IMarketDataProvider';

// ========================================
// 型定義
// ========================================

/**
 * 進行中のバー（まだ確定していない）
 */
interface PendingBar {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickCount: number;
  startTime: Date;
  endTime: Date;
}

/**
 * バー完了時のコールバック
 */
export type BarCompleteCallback = (bar: OHLCVBar) => void;

/**
 * サービス設定
 */
export const RollingWindowConfigSchema = z.object({
  windowSeconds: z.number().min(1).max(3600).default(60),
  // 最小 Tick 数（これ以下の場合はバーを生成しない）
  minTicksPerBar: z.number().min(1).default(1),
  // バー生成を自動で行うか（false の場合は手動で flush() を呼ぶ）
  autoFlush: z.boolean().default(true),
});

export type RollingWindowConfig = z.infer<typeof RollingWindowConfigSchema>;

// ========================================
// RollingWindowService クラス
// ========================================

export class RollingWindowService {
  private config: RollingWindowConfig;
  private pendingBars: Map<string, PendingBar> = new Map();
  private callbacks: BarCompleteCallback[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<RollingWindowConfig>) {
    const result = RollingWindowConfigSchema.safeParse(config || {});
    if (!result.success) {
      throw new Error(`RollingWindowService 設定エラー: ${result.error.message}`);
    }
    this.config = result.data;

    console.log(`[RollingWindow] 初期化: ${this.config.windowSeconds}秒窓`);

    // 自動フラッシュタイマー
    if (this.config.autoFlush) {
      this.startAutoFlush();
    }
  }

  // ========================================
  // 公開メソッド
  // ========================================

  /**
   * バー完了時のコールバックを登録
   */
  onBarComplete(callback: BarCompleteCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * コールバックを解除
   */
  offBarComplete(callback: BarCompleteCallback): void {
    this.callbacks = this.callbacks.filter(cb => cb !== callback);
  }

  /**
   * Tick データを追加
   * 
   * @param tick - Tick データ
   */
  addTick(tick: TickData): void {
    const symbol = tick.symbol;
    const price = tick.mid;  // 中値を価格として使用
    const volume = 1;  // Tick 単位でボリュームをカウント

    // 時間窓の開始時刻を計算
    const windowStart = this.getWindowStartTime(tick.timestamp);

    let pending = this.pendingBars.get(symbol);

    // 新しい窓に入った場合、前のバーを確定
    if (pending && pending.startTime.getTime() !== windowStart.getTime()) {
      this.completeBar(pending);
      pending = undefined;
    }

    // バーを更新または作成
    if (pending) {
      // 既存バーを更新
      pending.high = Math.max(pending.high, price);
      pending.low = Math.min(pending.low, price);
      pending.close = price;
      pending.volume += volume;
      pending.tickCount++;
      pending.endTime = tick.timestamp;
    } else {
      // 新規バーを作成
      pending = {
        symbol,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
        tickCount: 1,
        startTime: windowStart,
        endTime: tick.timestamp,
      };
      this.pendingBars.set(symbol, pending);
    }
  }

  /**
   * 複数の Tick を一括追加
   */
  addTicks(ticks: TickData[]): void {
    for (const tick of ticks) {
      this.addTick(tick);
    }
  }

  /**
   * 特定シンボルの進行中バーを取得
   * 
   * @param symbol - シンボル
   * @returns 進行中のバー（なければ undefined）
   */
  getPendingBar(symbol: string): OHLCVBar | undefined {
    const pending = this.pendingBars.get(symbol);
    if (!pending) {
      return undefined;
    }

    return this.pendingToOHLCV(pending);
  }

  /**
   * 全シンボルの進行中バーを取得
   */
  getAllPendingBars(): OHLCVBar[] {
    return Array.from(this.pendingBars.values()).map(p => this.pendingToOHLCV(p));
  }

  /**
   * 手動で全バーを確定
   * 
   * 注意: 時間窓が完了していなくても強制的にバーを生成
   */
  flushAll(): OHLCVBar[] {
    const bars: OHLCVBar[] = [];
    for (const pending of this.pendingBars.values()) {
      const bar = this.completeBar(pending);
      if (bar) {
        bars.push(bar);
      }
    }
    this.pendingBars.clear();
    return bars;
  }

  /**
   * 特定シンボルのバーを強制確定
   */
  flush(symbol: string): OHLCVBar | undefined {
    const pending = this.pendingBars.get(symbol);
    if (!pending) {
      return undefined;
    }

    const bar = this.completeBar(pending);
    this.pendingBars.delete(symbol);
    return bar;
  }

  /**
   * 期限切れのバーをチェックして確定
   * 
   * 自動フラッシュまたは手動呼び出しで使用
   */
  checkExpiredBars(): void {
    const now = new Date();
    const expiredSymbols: string[] = [];

    for (const [symbol, pending] of this.pendingBars) {
      const expectedEnd = new Date(pending.startTime.getTime() + this.config.windowSeconds * 1000);
      if (now >= expectedEnd) {
        this.completeBar(pending);
        expiredSymbols.push(symbol);
      }
    }

    for (const symbol of expiredSymbols) {
      this.pendingBars.delete(symbol);
    }
  }

  /**
   * サービスを停止
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushAll();
    console.log('[RollingWindow] 停止');
  }

  /**
   * 統計情報を取得
   */
  getStats(): {
    pendingCount: number;
    symbols: string[];
    windowSeconds: number;
  } {
    return {
      pendingCount: this.pendingBars.size,
      symbols: Array.from(this.pendingBars.keys()),
      windowSeconds: this.config.windowSeconds,
    };
  }

  // ========================================
  // 内部メソッド
  // ========================================

  /**
   * 時間窓の開始時刻を計算
   */
  private getWindowStartTime(timestamp: Date): Date {
    const ms = timestamp.getTime();
    const windowMs = this.config.windowSeconds * 1000;
    const alignedMs = Math.floor(ms / windowMs) * windowMs;
    return new Date(alignedMs);
  }

  /**
   * PendingBar を OHLCVBar に変換
   */
  private pendingToOHLCV(pending: PendingBar): OHLCVBar {
    return {
      symbol: pending.symbol,
      timestamp: pending.startTime,
      open: pending.open,
      high: pending.high,
      low: pending.low,
      close: pending.close,
      volume: pending.volume,
    };
  }

  /**
   * バーを確定してコールバック呼び出し
   */
  private completeBar(pending: PendingBar): OHLCVBar | undefined {
    // 最小 Tick 数チェック
    if (pending.tickCount < this.config.minTicksPerBar) {
      console.log(`[RollingWindow] ${pending.symbol}: Tick数不足 (${pending.tickCount}/${this.config.minTicksPerBar})`);
      return undefined;
    }

    const bar = this.pendingToOHLCV(pending);

    // Zod でバリデーション
    const result = OHLCVBarSchema.safeParse(bar);
    if (!result.success) {
      console.error('[RollingWindow] バーバリデーションエラー:', result.error);
      return undefined;
    }

    console.log(`[RollingWindow] ${bar.symbol} バー確定: O=${bar.open} H=${bar.high} L=${bar.low} C=${bar.close} V=${bar.volume}`);

    // コールバック呼び出し
    for (const callback of this.callbacks) {
      try {
        callback(bar);
      } catch (error) {
        console.error('[RollingWindow] コールバックエラー:', error);
      }
    }

    return bar;
  }

  /**
   * 自動フラッシュタイマーを開始
   */
  private startAutoFlush(): void {
    // 1秒ごとに期限切れチェック
    this.flushTimer = setInterval(() => {
      this.checkExpiredBars();
    }, 1000);
  }
}

// ========================================
// エクスポート
// ========================================

export default RollingWindowService;
