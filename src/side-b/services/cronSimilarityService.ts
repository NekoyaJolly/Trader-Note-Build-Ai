/**
 * Cron監視用 類似度チェックサービス
 * 
 * 目的: Cron監視処理でAIノートとの類似度チェックと自動通知を実行
 * 
 * 主要機能:
 * - 市場データから特徴量ベクトル生成
 * - AITradeNoteとの類似度検索
 * - 閾値判定と通知トリガー
 * - 通知履歴管理（冗長通知の抑制）
 * 
 * フロー:
 * 1. OHLCVデータから特徴量ベクトルを生成
 * 2. crossSimilarityServiceでAIノート検索
 * 3. 閾値以上の類似ノートを抽出
 * 4. notificationTriggerServiceで通知判定・送信
 * 
 * @see src/services/crossSimilarityService.ts
 * @see src/services/notification/notificationTriggerService.ts
 */

import { z } from 'zod';
import { crossSimilarityService } from '../../services/crossSimilarityService';
import { NotificationTriggerService } from '../../services/notification/notificationTriggerService';
import type { OHLCVData } from '../../services/indicators/indicatorService';

// ========================================
// 型定義
// ========================================

/**
 * 類似度チェック設定
 */
export const CronSimilarityConfigSchema = z.object({
  // 類似度閾値（この値以上で通知）
  similarityThreshold: z.number().min(0).max(1).default(0.85),
  // 取得する類似ノートの最大件数
  topK: z.number().min(1).max(50).default(5),
  // 最小類似度（これ以下は検索対象外）
  minSimilarity: z.number().min(0).max(1).default(0.5),
  // TradeNoteも検索対象に含めるか
  searchTradeNotes: z.boolean().default(true),
  // AITradeNoteを検索対象に含めるか
  searchAITradeNotes: z.boolean().default(true),
  // 通知チャネル
  notificationChannel: z.enum(['in_app', 'push', 'webhook']).default('in_app'),
  // デバッグモード
  debug: z.boolean().default(false),
});

export type CronSimilarityConfig = z.infer<typeof CronSimilarityConfigSchema>;

/**
 * 類似度チェック入力
 */
export interface SimilarityCheckInput {
  symbol: string;
  ohlcvData: OHLCVData[];
  timeframe?: string;
}

/**
 * 類似ノート検出結果
 */
export interface SimilarNoteMatch {
  noteId: string;
  noteType: 'tradeNote' | 'aiTradeNote';
  similarity: number;
  symbol: string;
  date: string;
  direction?: 'long' | 'short';
  outcome?: string;
  pnl?: number;
}

/**
 * 通知送信結果
 */
export interface NotificationResult {
  sent: boolean;
  noteId: string;
  similarity: number;
  skipReason?: string;
  notificationLogId?: string;
}

/**
 * 類似度チェック結果
 */
export interface SimilarityCheckResult {
  symbol: string;
  timestamp: Date;
  similarNotesFound: number;
  notificationsSent: number;
  matches: SimilarNoteMatch[];
  notifications: NotificationResult[];
  stats: {
    tradeNotesSearched: number;
    aiTradeNotesSearched: number;
    totalMatched: number;
  };
}

// ========================================
// CronSimilarityService クラス
// ========================================

/**
 * Cron監視用類似度チェックサービス
 */
export class CronSimilarityService {
  private config: CronSimilarityConfig;
  private notificationTrigger: NotificationTriggerService;

  constructor(
    config?: Partial<CronSimilarityConfig>,
    notificationTrigger?: NotificationTriggerService
  ) {
    const result = CronSimilarityConfigSchema.safeParse(config || {});
    if (!result.success) {
      throw new Error(`CronSimilarityService 設定エラー: ${result.error.message}`);
    }
    this.config = result.data;
    this.notificationTrigger = notificationTrigger || new NotificationTriggerService();

    if (this.config.debug) {
      console.log('[CronSimilarity] 初期化:', {
        threshold: this.config.similarityThreshold,
        topK: this.config.topK,
        channel: this.config.notificationChannel,
      });
    }
  }

  /**
   * 市場データから類似ノートを検索し、通知を送信
   * 
   * @param input - 類似度チェック入力（シンボル、OHLCVデータ）
   * @returns チェック結果（マッチ件数、通知送信結果等）
   */
  async checkSimilarityAndNotify(input: SimilarityCheckInput): Promise<SimilarityCheckResult> {
    const startTime = Date.now();
    const { symbol, ohlcvData } = input;

    if (this.config.debug) {
      console.log(`[CronSimilarity] ${symbol} の類似度チェック開始`);
    }

    try {
      // 1. 横断検索を実行（TradeNote + AITradeNote）
      const searchResult = await crossSimilarityService.searchSimilarNotes({
        ohlcvData,
        symbol,
        topK: this.config.topK,
        minSimilarity: this.config.minSimilarity,
        searchTradeNotes: this.config.searchTradeNotes,
        searchAITradeNotes: this.config.searchAITradeNotes,
        // 実行時のライブ照合では「本番運用」選別済み AIノートだけを対象にする
        aiNotesUsedForMatchingOnly: true,
      });

      // 2. 閾値以上の類似ノートを抽出
      const highSimilarityMatches = searchResult.results.filter(
        (note) => note.similarity >= this.config.similarityThreshold
      );

      if (this.config.debug) {
        console.log(`[CronSimilarity] 検索完了: ${searchResult.totalCount}件中${highSimilarityMatches.length}件が閾値超過`);
      }

      // 3. マッチ情報を構築
      const matches: SimilarNoteMatch[] = highSimilarityMatches.map((note) => ({
        noteId: note.noteId,
        noteType: note.noteType,
        similarity: note.similarity,
        symbol: note.symbol,
        date: note.date,
        direction: note.direction,
        outcome: note.outcome,
        pnl: note.pnl,
      }));

      // 4. 各マッチに対して通知送信を試行
      const notifications: NotificationResult[] = [];

      for (const match of matches) {
        try {
          const notificationResult = await this.sendNotification(match, symbol);
          notifications.push(notificationResult);

          if (this.config.debug && notificationResult.sent) {
            console.log(`[CronSimilarity] 通知送信成功: ${match.noteId} (類似度: ${match.similarity.toFixed(3)})`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '不明なエラー';
          console.error(`[CronSimilarity] 通知送信失敗: ${match.noteId}`, errorMessage);
          
          notifications.push({
            sent: false,
            noteId: match.noteId,
            similarity: match.similarity,
            skipReason: `送信エラー: ${errorMessage}`,
          });
        }
      }

      const result: SimilarityCheckResult = {
        symbol,
        timestamp: new Date(),
        similarNotesFound: highSimilarityMatches.length,
        notificationsSent: notifications.filter((n) => n.sent).length,
        matches,
        notifications,
        stats: {
          tradeNotesSearched: searchResult.searchStats.tradeNotesSearched,
          aiTradeNotesSearched: searchResult.searchStats.aiTradeNotesSearched,
          totalMatched: highSimilarityMatches.length,
        },
      };

      const duration = Date.now() - startTime;
      if (this.config.debug) {
        console.log(`[CronSimilarity] チェック完了 (${duration}ms):`, {
          matched: result.similarNotesFound,
          sent: result.notificationsSent,
        });
      }

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      console.error(`[CronSimilarity] ${symbol} の類似度チェック失敗:`, errorMessage);
      
      // エラー時も結果を返す
      return {
        symbol,
        timestamp: new Date(),
        similarNotesFound: 0,
        notificationsSent: 0,
        matches: [],
        notifications: [],
        stats: {
          tradeNotesSearched: 0,
          aiTradeNotesSearched: 0,
          totalMatched: 0,
        },
      };
    }
  }

  /**
   * 複数シンボルに対して一括チェック
   * 
   * @param inputs - 複数のチェック入力
   * @returns 各シンボルのチェック結果
   */
  async checkMultipleSymbols(inputs: SimilarityCheckInput[]): Promise<SimilarityCheckResult[]> {
    const results: SimilarityCheckResult[] = [];

    for (const input of inputs) {
      const result = await this.checkSimilarityAndNotify(input);
      results.push(result);
    }

    return results;
  }

  /**
   * 通知を送信
   * 
   * @param match - 類似ノートマッチ情報
   * @param symbol - シンボル
   * @returns 通知送信結果
   */
  private async sendNotification(
    match: SimilarNoteMatch,
    symbol: string
  ): Promise<NotificationResult> {
    // notificationTriggerService で通知判定
    const triggerResult = await this.notificationTrigger.evaluateWithPersistence({
      matchScore: match.similarity,
      historicalNoteId: match.noteId,
      marketSnapshot: {
        symbol,
        timestamp: new Date(),
        similarity: match.similarity,
        noteType: match.noteType,
      },
      marketSnapshotId: `${symbol}_${Date.now()}`,
      symbol,
      channel: this.config.notificationChannel,
    });

    return {
      sent: triggerResult.shouldNotify && triggerResult.status === 'sent',
      noteId: match.noteId,
      similarity: match.similarity,
      skipReason: triggerResult.skipReason,
      notificationLogId: triggerResult.notificationLogId,
    };
  }

  /**
   * 設定を更新
   */
  updateConfig(newConfig: Partial<CronSimilarityConfig>): void {
    const result = CronSimilarityConfigSchema.safeParse({
      ...this.config,
      ...newConfig,
    });

    if (!result.success) {
      throw new Error(`設定更新エラー: ${result.error.message}`);
    }

    this.config = result.data;

    if (this.config.debug) {
      console.log('[CronSimilarity] 設定更新:', this.config);
    }
  }

  /**
   * 現在の設定を取得
   */
  getConfig(): CronSimilarityConfig {
    return { ...this.config };
  }
}

// ========================================
// エクスポート
// ========================================

/**
 * デフォルトインスタンス（シングルトン）
 */
export const cronSimilarityService = new CronSimilarityService();
