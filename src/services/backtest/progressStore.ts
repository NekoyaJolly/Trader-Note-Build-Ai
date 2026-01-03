/**
 * バックテスト進捗管理ストア
 * 
 * 目的:
 * - バックテスト実行中の進捗をメモリに保持
 * - SSEでクライアントに進捗をストリーミング
 * - チャート表示用のOHLCVデータとインジケーター値を保持
 */

import { EventEmitter } from 'events';

// OHLCVデータの型
export interface OHLCVData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// インジケーター値の型
export interface IndicatorValue {
  name: string;
  value: number;
  timestamp: string;
}

// エントリー/エグジットマーカーの型
export interface TradeMarker {
  timestamp: string;
  price: number;
  type: 'entry' | 'exit';
  side: 'buy' | 'sell';
  exitReason?: 'take_profit' | 'stop_loss' | 'timeout' | 'signal';
}

// 進捗状態の型
export interface ProgressState {
  /** ジョブID */
  jobId: string;
  /** 現在のステータス */
  status: 'initializing' | 'processing' | 'completed' | 'error';
  /** 処理済みキャンドル数 */
  processedCandles: number;
  /** 総キャンドル数 */
  totalCandles: number;
  /** 進捗率（0-100） */
  progressPercent: number;
  /** 現在処理中のタイムスタンプ */
  currentTimestamp?: string;
  /** OHLCVデータ（直近N本） */
  ohlcvData: OHLCVData[];
  /** インジケーター値 */
  indicators: Record<string, IndicatorValue[]>;
  /** トレードマーカー */
  tradeMarkers: TradeMarker[];
  /** エラーメッセージ */
  errorMessage?: string;
  /** 開始時刻 */
  startedAt: Date;
  /** 推定残り時間（秒） */
  estimatedTimeRemaining?: number;
}

// 保持するOHLCVデータの最大数
const MAX_OHLCV_DATA = 100;
// 保持するインジケーター値の最大数（各インジケーター）
const MAX_INDICATOR_VALUES = 100;

/**
 * バックテスト進捗ストアクラス
 * EventEmitterを使って進捗更新をブロードキャスト
 */
class BacktestProgressStore extends EventEmitter {
  private progressMap: Map<string, ProgressState> = new Map();
  
  /**
   * 新しいジョブを初期化
   */
  initializeJob(jobId: string, totalCandles: number): void {
    const state: ProgressState = {
      jobId,
      status: 'initializing',
      processedCandles: 0,
      totalCandles,
      progressPercent: 0,
      ohlcvData: [],
      indicators: {},
      tradeMarkers: [],
      startedAt: new Date(),
    };
    this.progressMap.set(jobId, state);
    this.emit(`progress:${jobId}`, state);
  }
  
  /**
   * 進捗を更新
   */
  updateProgress(
    jobId: string,
    processedCandles: number,
    currentTimestamp?: string
  ): void {
    const state = this.progressMap.get(jobId);
    if (!state) return;
    
    state.status = 'processing';
    state.processedCandles = processedCandles;
    state.currentTimestamp = currentTimestamp;
    state.progressPercent = Math.round((processedCandles / state.totalCandles) * 100);
    
    // 推定残り時間を計算
    const elapsed = Date.now() - state.startedAt.getTime();
    if (processedCandles > 0) {
      const avgTimePerCandle = elapsed / processedCandles;
      const remainingCandles = state.totalCandles - processedCandles;
      state.estimatedTimeRemaining = Math.round((avgTimePerCandle * remainingCandles) / 1000);
    }
    
    this.emit(`progress:${jobId}`, state);
  }
  
  /**
   * OHLCVデータを追加
   */
  addOHLCVData(jobId: string, data: OHLCVData): void {
    const state = this.progressMap.get(jobId);
    if (!state) return;
    
    state.ohlcvData.push(data);
    // 最大数を超えたら古いデータを削除
    if (state.ohlcvData.length > MAX_OHLCV_DATA) {
      state.ohlcvData = state.ohlcvData.slice(-MAX_OHLCV_DATA);
    }
  }
  
  /**
   * インジケーター値を追加
   */
  addIndicatorValue(jobId: string, indicatorName: string, value: IndicatorValue): void {
    const state = this.progressMap.get(jobId);
    if (!state) return;
    
    if (!state.indicators[indicatorName]) {
      state.indicators[indicatorName] = [];
    }
    state.indicators[indicatorName].push(value);
    
    // 最大数を超えたら古いデータを削除
    if (state.indicators[indicatorName].length > MAX_INDICATOR_VALUES) {
      state.indicators[indicatorName] = state.indicators[indicatorName].slice(-MAX_INDICATOR_VALUES);
    }
  }
  
  /**
   * トレードマーカーを追加
   */
  addTradeMarker(jobId: string, marker: TradeMarker): void {
    const state = this.progressMap.get(jobId);
    if (!state) return;
    
    state.tradeMarkers.push(marker);
    this.emit(`progress:${jobId}`, state);
  }
  
  /**
   * ジョブを完了状態に
   */
  completeJob(jobId: string): void {
    const state = this.progressMap.get(jobId);
    if (!state) return;
    
    state.status = 'completed';
    state.progressPercent = 100;
    state.estimatedTimeRemaining = 0;
    this.emit(`progress:${jobId}`, state);
  }
  
  /**
   * エラーを設定
   */
  setError(jobId: string, errorMessage: string): void {
    const state = this.progressMap.get(jobId);
    if (!state) return;
    
    state.status = 'error';
    state.errorMessage = errorMessage;
    this.emit(`progress:${jobId}`, state);
  }
  
  /**
   * 進捗状態を取得
   */
  getProgress(jobId: string): ProgressState | undefined {
    return this.progressMap.get(jobId);
  }
  
  /**
   * ジョブを削除（メモリ解放）
   */
  removeJob(jobId: string): void {
    this.progressMap.delete(jobId);
    this.removeAllListeners(`progress:${jobId}`);
  }
  
  /**
   * 古いジョブをクリーンアップ（1時間以上前のジョブ）
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1時間
    
    for (const [jobId, state] of this.progressMap.entries()) {
      if (now - state.startedAt.getTime() > maxAge) {
        this.removeJob(jobId);
      }
    }
  }
}

// シングルトンインスタンス
export const progressStore = new BacktestProgressStore();

// 5分ごとにクリーンアップ
setInterval(() => {
  progressStore.cleanup();
}, 5 * 60 * 1000);
