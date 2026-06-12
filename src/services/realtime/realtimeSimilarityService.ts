/**
 * Realtime Similarity Service (Phase δ-1: レンズエンジン統一)
 *
 * 目的: リアルタイムのバー確定をトリガーに、ノート類似マッチングを実行する。
 *
 * 設計 (NOTE_SIMILARITY_FOUNDATION.md §13.2、2026-06-13 実装):
 * - **本サービスは評価ロジックを持たない**。バー確定ごとに正規マッチングパイプライン
 *   (`MatchingService.runMatchingPipeline`) を対象シンボルにスコープして起動する
 *   「薄いトリガー」である。これにより:
 *   - 特徴量はレンズ基盤 (LensSnapshot + compareLensSnapshots) に完全統一
 *     (旧実装の簡易 12 次元ベクトル + cosine は廃止 = §13.2 の二重特徴表現を解消)
 *   - MatchResult / EvaluationLog / Notification の永続化、通知粒度
 *     (NotificationPreference)、Web Push、通知 SSE (δ-3) まで全て正規経路に乗る
 *     (= 設計 δ-1 の「callback → evaluateWithPersistence」)
 * - 15 分 cron と同じコードが走るため、cron とリアルタイムで評価結果が食い違わない
 *
 * 運用上の位置づけ: 常駐ワーカー (δ-5) は 15 分 cron 維持の決定 (2026-06-13) により
 * 当面未デプロイ。本サービスは δ-5 再判断時にワーカーがそのまま使える状態を保つ。
 * データ源の cTrader → EODHD 差し替えは δ-5 本番化時の必須作業 (§13.4 注意書き)。
 */

import { z } from 'zod';
import type { OHLCVBar } from '../../infrastructure/market/IMarketDataProvider';
import type { RollingWindowService, BarCompleteCallback } from './rollingWindowService';
import { MatchingService } from '../matchingService';
import type { MatchingPipelineRunResult, PipelineRunTrigger } from '../matchingService';

// ========================================
// 型定義
// ========================================

/**
 * サービス設定
 */
export const RealtimeSimilarityConfigSchema = z.object({
  // 同一シンボルの評価間の最小インターバル（秒）。
  // 1m 足等でバー確定が密な場合にパイプラインの連続起動を抑制する
  minEvaluationIntervalSeconds: z.number().min(0).default(60),
  // デバッグモード
  debug: z.boolean().default(false),
});

export type RealtimeSimilarityConfig = z.infer<typeof RealtimeSimilarityConfigSchema>;

/**
 * リアルタイム評価 1 回分の結果（正規パイプラインの実行サマリー）
 */
export interface RealtimeEvaluationResult {
  symbol: string;
  startedAt: Date;
  /** パイプラインが検出したマッチ総数 */
  totalMatches: number;
  /** 実際に通知されたマッチ数 */
  notified: number;
  errors: string[];
}

/**
 * 評価完了コールバック（観測用。永続化・通知はパイプライン側の責務）
 */
export type RealtimeEvaluationCallback = (result: RealtimeEvaluationResult) => void;

/** パイプライン起動関数の契約（テストで差し替えるための DI） */
export type RunMatchingPipelineFn = (options: {
  trigger?: PipelineRunTrigger;
  symbolFilter?: string;
}) => Promise<MatchingPipelineRunResult>;

// ========================================
// RealtimeSimilarityService クラス
// ========================================

export class RealtimeSimilarityService {
  private config: RealtimeSimilarityConfig;
  private rollingWindow: RollingWindowService;
  private runPipelineFn: RunMatchingPipelineFn;
  private lastEvaluationTime: Map<string, Date> = new Map();
  private inFlightSymbols: Set<string> = new Set();
  private evaluationCallbacks: RealtimeEvaluationCallback[] = [];
  private barCallback: BarCompleteCallback;
  private isRunning = false;

  constructor(
    rollingWindow: RollingWindowService,
    config?: Partial<RealtimeSimilarityConfig>,
    deps?: { runPipelineFn?: RunMatchingPipelineFn }
  ) {
    const result = RealtimeSimilarityConfigSchema.safeParse(config || {});
    if (!result.success) {
      throw new Error(`RealtimeSimilarityService 設定エラー: ${result.error.message}`);
    }
    this.config = result.data;
    this.rollingWindow = rollingWindow;
    // 既定は正規パイプライン (cron と同一コード)。テストではモックを注入する
    this.runPipelineFn =
      deps?.runPipelineFn ??
      ((options) => new MatchingService().runMatchingPipeline(options));

    // バー完了時のコールバック
    this.barCallback = (bar: OHLCVBar) => this.onBarComplete(bar);

    console.log(
      `[RealtimeSimilarity] 初期化 (レンズ統一): 最小評価間隔=${this.config.minEvaluationIntervalSeconds}s`
    );
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
   * 評価完了コールバックを登録（観測用）
   */
  onEvaluation(callback: RealtimeEvaluationCallback): void {
    this.evaluationCallbacks.push(callback);
  }

  /**
   * コールバックを解除
   */
  offEvaluation(callback: RealtimeEvaluationCallback): void {
    this.evaluationCallbacks = this.evaluationCallbacks.filter((cb) => cb !== callback);
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
    console.log(
      `[RealtimeSimilarity] 設定更新: 最小評価間隔=${this.config.minEvaluationIntervalSeconds}s`
    );
  }

  /**
   * 統計情報を取得
   */
  getStats(): {
    isRunning: boolean;
    symbolCount: number;
    inFlightCount: number;
    minEvaluationIntervalSeconds: number;
  } {
    return {
      isRunning: this.isRunning,
      symbolCount: this.lastEvaluationTime.size,
      inFlightCount: this.inFlightSymbols.size,
      minEvaluationIntervalSeconds: this.config.minEvaluationIntervalSeconds,
    };
  }

  /**
   * 指定シンボルをレンズエンジンで評価し、結果を永続化する (δ-1 の evaluateWithPersistence)。
   *
   * 実体は正規マッチングパイプラインのシンボルスコープ起動。
   * MatchResult / EvaluationLog / Notification の生成、通知粒度・クールダウン・Push は
   * 全てパイプライン側 (cron と同一コード) が行う。
   */
  async evaluateWithPersistence(symbol: string): Promise<RealtimeEvaluationResult> {
    const startedAt = new Date();
    const run = await this.runPipelineFn({ trigger: 'realtime', symbolFilter: symbol });
    const result: RealtimeEvaluationResult = {
      symbol,
      startedAt,
      totalMatches: run.totalMatches,
      notified: run.notified,
      errors: [...run.errors],
    };
    for (const callback of this.evaluationCallbacks) {
      try {
        callback(result);
      } catch (callbackError) {
        console.warn('[RealtimeSimilarity] コールバックエラー (継続):', callbackError);
      }
    }
    return result;
  }

  // ========================================
  // 内部処理
  // ========================================

  /**
   * バー確定時: クールダウンと多重起動を抑制した上でシンボル評価を起動する
   */
  private onBarComplete(bar: OHLCVBar): void {
    const symbol = bar.symbol;
    if (!symbol) {
      console.warn('[RealtimeSimilarity] シンボルが未設定のバーをスキップ');
      return;
    }

    // 同一シンボルの評価が走行中なら多重起動しない
    if (this.inFlightSymbols.has(symbol)) {
      if (this.config.debug) {
        console.log(`[RealtimeSimilarity] ${symbol}: 評価走行中のためスキップ`);
      }
      return;
    }

    // クールダウン (1m 足等での連続起動を抑制)
    const last = this.lastEvaluationTime.get(symbol);
    const intervalMs = this.config.minEvaluationIntervalSeconds * 1000;
    if (last && Date.now() - last.getTime() < intervalMs) {
      if (this.config.debug) {
        console.log(`[RealtimeSimilarity] ${symbol}: クールダウン中のためスキップ`);
      }
      return;
    }

    this.inFlightSymbols.add(symbol);
    this.lastEvaluationTime.set(symbol, new Date());
    void this.evaluateWithPersistence(symbol)
      .then((result) => {
        if (this.config.debug || result.totalMatches > 0) {
          console.log(
            `[RealtimeSimilarity] ${symbol}: matches=${result.totalMatches} notified=${result.notified}` +
              (result.errors.length > 0 ? ` errors=${result.errors.length}` : '')
          );
        }
      })
      .catch((error) => {
        // 評価失敗は次のバー確定で自己回復する (サービスは止めない)
        console.error(`[RealtimeSimilarity] ${symbol}: 評価失敗 (継続):`, error);
      })
      .finally(() => {
        this.inFlightSymbols.delete(symbol);
      });
  }
}

export default RealtimeSimilarityService;
