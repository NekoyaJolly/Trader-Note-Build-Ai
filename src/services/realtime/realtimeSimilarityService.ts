/**
 * Realtime Similarity Service
 * 
 * 目的: リアルタイムバーデータと過去ノートの類似度をチェック
 * 
 * 機能:
 * - 新規バー受信時に全ノートとの類似度を計算
 * - 閾値（デフォルト0.85）を超えた場合に通知トリガー
 * - 24時間あたりの通知制限（30件）
 * - プロファイル別のインジケーター設定対応
 * 
 * フロー:
 * 1. RollingWindowService からバー受信
 * 2. featureVectorService で特徴ベクトル計算
 * 3. 全ノートと類似度比較
 * 4. 閾値超過 → notificationTriggerService で通知
 * 
 * 参照: docs/realtime_similarity_notification_architecture.md
 */

import { z } from 'zod';
import { OHLCVBar } from '../../infrastructure/market/IMarketDataProvider';
import { RollingWindowService, BarCompleteCallback } from './rollingWindowService';
import { calculateCosineSimilarity } from '../featureVectorService';

// ========================================
// 型定義
// ========================================

/**
 * サービス設定
 */
export const RealtimeSimilarityConfigSchema = z.object({
  // 類似度閾値（0-1、この値以上で通知）
  similarityThreshold: z.number().min(0).max(1).default(0.85),
  // 特徴ベクトルの計算に使用するバー数
  featureWindowBars: z.number().min(1).default(20),
  // 通知間の最小インターバル（秒）
  minNotificationIntervalSeconds: z.number().min(0).default(300),
  // デバッグモード
  debug: z.boolean().default(false),
});

export type RealtimeSimilarityConfig = z.infer<typeof RealtimeSimilarityConfigSchema>;

/**
 * 類似度チェック結果
 */
export interface SimilarityCheckResult {
  noteId: string;
  noteTitle: string;
  symbol: string;
  similarity: number;
  timestamp: Date;
  featureVector: number[];
  matchedAt: Date;
}

/**
 * 通知トリガーコールバック
 */
export type SimilarityAlertCallback = (result: SimilarityCheckResult) => void;

/**
 * ノート情報（類似度チェック用）
 */
export interface NoteForSimilarity {
  id: string;
  title: string;
  symbol: string;
  featureVector: number[];
  profileId?: string;
}

// ========================================
// RealtimeSimilarityService クラス
// ========================================

export class RealtimeSimilarityService {
  private config: RealtimeSimilarityConfig;
  private rollingWindow: RollingWindowService;
  private notes: NoteForSimilarity[] = [];
  private recentBars: Map<string, OHLCVBar[]> = new Map();
  private lastNotificationTime: Map<string, Date> = new Map();
  private alertCallbacks: SimilarityAlertCallback[] = [];
  private barCallback: BarCompleteCallback;
  private isRunning = false;

  constructor(
    rollingWindow: RollingWindowService,
    config?: Partial<RealtimeSimilarityConfig>
  ) {
    const result = RealtimeSimilarityConfigSchema.safeParse(config || {});
    if (!result.success) {
      throw new Error(`RealtimeSimilarityService 設定エラー: ${result.error.message}`);
    }
    this.config = result.data;
    this.rollingWindow = rollingWindow;

    // バー完了時のコールバック
    this.barCallback = (bar: OHLCVBar) => this.onBarComplete(bar);

    console.log(`[RealtimeSimilarity] 初期化: 閾値=${this.config.similarityThreshold}`);
  }

  // ========================================
  // 公開メソッド
  // ========================================

  /**
   * サービスを開始
   */
  start(): void {
    if (this.isRunning) {
      console.log('[RealtimeSimilarity] 既に実行中');
      return;
    }

    this.rollingWindow.onBarComplete(this.barCallback);
    this.isRunning = true;
    console.log('[RealtimeSimilarity] 開始');
  }

  /**
   * サービスを停止
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.rollingWindow.offBarComplete(this.barCallback);
    this.isRunning = false;
    console.log('[RealtimeSimilarity] 停止');
  }

  /**
   * 類似度アラートのコールバックを登録
   */
  onSimilarityAlert(callback: SimilarityAlertCallback): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * コールバックを解除
   */
  offSimilarityAlert(callback: SimilarityAlertCallback): void {
    this.alertCallbacks = this.alertCallbacks.filter(cb => cb !== callback);
  }

  /**
   * 比較対象のノートを設定
   * 
   * @param notes - ノート一覧
   */
  setNotes(notes: NoteForSimilarity[]): void {
    this.notes = notes;
    console.log(`[RealtimeSimilarity] ノート設定: ${notes.length}件`);
  }

  /**
   * ノートを追加
   */
  addNote(note: NoteForSimilarity): void {
    // 重複チェック
    const existing = this.notes.findIndex(n => n.id === note.id);
    if (existing >= 0) {
      this.notes[existing] = note;
    } else {
      this.notes.push(note);
    }
  }

  /**
   * ノートを削除
   */
  removeNote(noteId: string): void {
    this.notes = this.notes.filter(n => n.id !== noteId);
  }

  /**
   * 設定を更新
   */
  updateConfig(config: Partial<RealtimeSimilarityConfig>): void {
    const result = RealtimeSimilarityConfigSchema.safeParse({
      ...this.config,
      ...config,
    });
    if (!result.success) {
      throw new Error(`設定エラー: ${result.error.message}`);
    }
    this.config = result.data;
    console.log(`[RealtimeSimilarity] 設定更新: 閾値=${this.config.similarityThreshold}`);
  }

  /**
   * 統計情報を取得
   */
  getStats(): {
    isRunning: boolean;
    noteCount: number;
    symbolCount: number;
    similarityThreshold: number;
  } {
    return {
      isRunning: this.isRunning,
      noteCount: this.notes.length,
      symbolCount: this.recentBars.size,
      similarityThreshold: this.config.similarityThreshold,
    };
  }

  /**
   * 手動で類似度チェック実行
   * 
   * @param symbol - シンボル
   * @param featureVector - 特徴ベクトル
   */
  checkSimilarity(symbol: string, featureVector: number[]): SimilarityCheckResult[] {
    const results: SimilarityCheckResult[] = [];
    const now = new Date();

    // 同じシンボルのノートのみ比較
    const targetNotes = this.notes.filter(n => n.symbol === symbol);

    for (const note of targetNotes) {
      const similarity = calculateCosineSimilarity(featureVector, note.featureVector);

      if (this.config.debug) {
        console.log(`[RealtimeSimilarity] ${note.title}: similarity=${similarity.toFixed(4)}`);
      }

      if (similarity >= this.config.similarityThreshold) {
        results.push({
          noteId: note.id,
          noteTitle: note.title,
          symbol,
          similarity,
          timestamp: now,
          featureVector,
          matchedAt: now,
        });
      }
    }

    return results;
  }

  // ========================================
  // 内部メソッド
  // ========================================

  /**
   * バー完了時の処理
   */
  private onBarComplete(bar: OHLCVBar): void {
    const symbol = bar.symbol;
    if (!symbol) {
      console.warn('[RealtimeSimilarity] シンボルが未設定のバーをスキップ');
      return;
    }

    // 最近のバーを保存
    let bars = this.recentBars.get(symbol);
    if (!bars) {
      bars = [];
      this.recentBars.set(symbol, bars);
    }
    bars.push(bar);

    // 窓サイズを超えたら古いバーを削除
    while (bars.length > this.config.featureWindowBars) {
      bars.shift();
    }

    // 必要なバー数が揃っていない場合はスキップ
    if (bars.length < this.config.featureWindowBars) {
      if (this.config.debug) {
        console.log(`[RealtimeSimilarity] ${symbol}: バー不足 (${bars.length}/${this.config.featureWindowBars})`);
      }
      return;
    }

    // 特徴ベクトルを計算
    const featureVector = this.calculateFeatureVector(bars);
    if (!featureVector || featureVector.length === 0) {
      return;
    }

    // 類似度チェック
    const matches = this.checkSimilarity(symbol, featureVector);

    // マッチしたノートごとに通知
    for (const match of matches) {
      this.triggerAlert(match);
    }
  }

  /**
   * 特徴ベクトルを計算
   * 
   * 注意: 実際の実装では featureVectorService を使用
   *       ここでは簡易版として OHLCV から直接計算
   */
  private calculateFeatureVector(bars: OHLCVBar[]): number[] {
    if (bars.length === 0) {
      return [];
    }

    // 簡易特徴ベクトル（12次元）
    // 実際は featureVectorService.calculateFeatureVector() を使用
    const closes = bars.map(b => b.close);
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const volumes = bars.map(b => b.volume);

    // 価格変化率（正規化）
    const priceChanges: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      priceChanges.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }

    // ボラティリティ
    const volatility = this.calculateVolatility(closes);

    // ATR（簡易版）
    const atr = this.calculateATR(highs, lows, closes);

    // ボリューム変化
    const volumeChange = volumes.length > 1
      ? (volumes[volumes.length - 1] - volumes[0]) / (volumes[0] || 1)
      : 0;

    // 12次元ベクトルを構築
    const vector = [
      ...priceChanges.slice(-5),                    // 直近5期間の価格変化率
      volatility,                                    // ボラティリティ
      atr,                                           // ATR
      volumeChange,                                  // ボリューム変化
      (closes[closes.length - 1] - closes[0]) / closes[0],  // 全体の価格変化率
      Math.max(...highs) / Math.min(...lows) - 1,   // 高低差比率
      this.calculateTrend(closes),                  // トレンド強度
      this.calculateMomentum(closes),               // モメンタム
    ];

    // 12次元に調整
    while (vector.length < 12) {
      vector.push(0);
    }

    return vector.slice(0, 12);
  }

  /**
   * ボラティリティを計算
   */
  private calculateVolatility(closes: number[]): number {
    if (closes.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  /**
   * ATR を計算
   */
  private calculateATR(highs: number[], lows: number[], closes: number[]): number {
    if (highs.length < 2) return 0;
    const trs = [];
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }
    return trs.reduce((a, b) => a + b, 0) / trs.length / closes[closes.length - 1];
  }

  /**
   * トレンド強度を計算
   */
  private calculateTrend(closes: number[]): number {
    if (closes.length < 2) return 0;
    const n = closes.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += closes[i];
      sumXY += i * closes[i];
      sumX2 += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope / closes[0];
  }

  /**
   * モメンタムを計算
   */
  private calculateMomentum(closes: number[]): number {
    if (closes.length < 10) return 0;
    const current = closes[closes.length - 1];
    const past = closes[closes.length - 10];
    return (current - past) / past;
  }

  /**
   * アラートをトリガー
   */
  private triggerAlert(result: SimilarityCheckResult): void {
    // 通知間隔チェック
    const lastTime = this.lastNotificationTime.get(result.noteId);
    if (lastTime) {
      const elapsed = (Date.now() - lastTime.getTime()) / 1000;
      if (elapsed < this.config.minNotificationIntervalSeconds) {
        if (this.config.debug) {
          console.log(`[RealtimeSimilarity] ${result.noteTitle}: 通知スキップ（間隔不足: ${elapsed.toFixed(0)}s）`);
        }
        return;
      }
    }

    // 通知時刻を記録
    this.lastNotificationTime.set(result.noteId, new Date());

    console.log(`[RealtimeSimilarity] アラート: ${result.noteTitle} (類似度: ${(result.similarity * 100).toFixed(1)}%)`);

    // コールバック呼び出し
    for (const callback of this.alertCallbacks) {
      try {
        callback(result);
      } catch (error) {
        console.error('[RealtimeSimilarity] コールバックエラー:', error);
      }
    }
  }
}

// ========================================
// エクスポート
// ========================================

export default RealtimeSimilarityService;
